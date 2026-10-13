import asyncio
import os
import sys
import unittest
from datetime import datetime, timedelta, timezone
from pathlib import Path
from types import SimpleNamespace

from fastapi import HTTPException
from pymongo.errors import DuplicateKeyError

os.environ.setdefault("MONGO_URL", "mongodb://127.0.0.1:27017")
os.environ.setdefault("DB_NAME", "quiz_unit_tests")
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import server


def matches(document, query):
    for key, expected in query.items():
        value = document.get(key)
        if isinstance(expected, dict):
            if "$in" in expected and value not in expected["$in"]:
                return False
            if "$lte" in expected and (value is None or value > expected["$lte"]):
                return False
        elif value != expected:
            return False
    return True


class Cursor:
    def __init__(self, documents):
        self.documents = documents

    async def to_list(self, length):
        return [dict(document) for document in self.documents[:length]]


class Collection:
    def __init__(self, documents=None, unique=None):
        self.documents = documents or []
        self.unique = unique

    def find(self, query, projection=None):
        return Cursor([document for document in self.documents if matches(document, query)])

    async def find_one(self, query, projection=None):
        await asyncio.sleep(0)
        return next((dict(document) for document in self.documents if matches(document, query)), None)

    async def distinct(self, key, query):
        return list({document[key] for document in self.documents if matches(document, query)})

    async def insert_one(self, document):
        await asyncio.sleep(0)
        if self.unique and any(
            all(existing.get(key) == document.get(key) for key in self.unique)
            for existing in self.documents
        ):
            raise DuplicateKeyError("duplicate test key")
        self.documents.append(dict(document))

    async def update_one(self, query, update):
        for document in self.documents:
            if matches(document, query):
                document.update(update.get("$set", {}))
                return

    async def find_one_and_update(self, query, update, **kwargs):
        for document in self.documents:
            if matches(document, query):
                for key, value in update.get("$inc", {}).items():
                    document[key] = document.get(key, 0) + value
                return dict(document)


class TimedQuizTests(unittest.TestCase):
    def setUp(self):
        self.now = datetime(2026, 10, 13, 15, 0, tzinfo=timezone.utc)
        self.user = {"user_id": "quiz-user"}
        self.db = SimpleNamespace(
            users=Collection([{"user_id": "quiz-user", "total_points": 0, "correct_count": 0, "incorrect_count": 0}]),
            questions=Collection([
                {"question_id": qid, "statement": qid, "options": ["A", "B", "C", "D"],
                 "correct_index": 1, "active": True}
                for qid in ["q1", "q2"]
            ]),
            daily_schedules=Collection([{"date": "2026-10-13", "question_ids": ["q1", "q2"]}]),
            answers=Collection(unique=["user_id", "question_id"]),
            question_attempts=Collection(unique=["user_id", "question_id"]),
        )
        old_db, old_now = server.db, server.now_utc
        server.db = self.db
        server.now_utc = lambda: self.now
        self.addCleanup(setattr, server, "db", old_db)
        self.addCleanup(setattr, server, "now_utc", old_now)

    def run_async(self, coro):
        return asyncio.run(coro)

    def start(self, qid="q1"):
        return self.run_async(server.start_question(qid, user=self.user))

    def answer(self, index, qid="q1"):
        return self.run_async(server.submit_answer(server.AnswerSubmit(question_id=qid, selected_index=index), user=self.user))

    def test_start_is_ten_seconds_and_resume_never_resets_deadline(self):
        first = self.start()
        self.assertEqual(first["deadline_at"], server.to_iso(self.now + timedelta(seconds=10)))
        self.now += timedelta(seconds=4)
        resumed = self.start()
        self.assertEqual(first["deadline_at"], resumed["deadline_at"])
        self.assertEqual(len(self.db.question_attempts.documents), 1)

    def test_questions_must_be_started_in_order(self):
        with self.assertRaises(HTTPException) as error:
            self.start("q2")
        self.assertEqual(error.exception.status_code, 409)
        self.assertEqual(self.db.question_attempts.documents, [])

    def test_correct_answer_before_deadline_awards_one_point(self):
        self.start()
        self.now += timedelta(seconds=9)
        result = self.answer(1)
        self.assertTrue(result.correct)
        self.assertFalse(result.timed_out)
        self.assertEqual(result.points_awarded, 1)
        self.assertEqual(self.db.users.documents[0]["correct_count"], 1)

    def test_correct_choice_at_deadline_is_wrong_and_retry_is_idempotent(self):
        self.start()
        self.now += timedelta(seconds=10)
        first = self.answer(1)
        second = self.answer(1)
        self.assertTrue(first.timed_out)
        self.assertFalse(first.correct)
        self.assertIsNone(first.selected_index)
        self.assertEqual(first.points_awarded, 0)
        self.assertEqual(second.points_awarded, 0)
        self.assertEqual(self.db.users.documents[0]["incorrect_count"], 1)
        self.assertEqual(len(self.db.answers.documents), 1)

    def test_reopening_expires_only_started_question(self):
        self.start()
        self.now += timedelta(seconds=35)
        today = self.run_async(server.get_today_questions(user=self.user))
        self.assertTrue(today["questions"][0]["already_answered"])
        self.assertTrue(today["questions"][0]["timed_out"])
        self.assertFalse(today["questions"][1]["already_answered"])
        self.assertEqual(self.db.users.documents[0]["incorrect_count"], 1)

    def test_expired_attempt_is_scored_even_after_day_changes(self):
        self.start()
        self.now += timedelta(days=1)
        today = self.run_async(server.get_today_questions(user=self.user))
        self.assertEqual(today["questions"], [])
        self.assertEqual(self.db.users.documents[0]["incorrect_count"], 1)

    def test_resuming_expired_question_returns_result_not_fresh_deadline(self):
        first = self.start()
        self.now += timedelta(seconds=11)
        resumed = self.start()
        self.assertTrue(resumed["already_answered"])
        self.assertTrue(resumed["answer"]["timed_out"])
        self.assertEqual(self.db.question_attempts.documents[0]["deadline_at"], datetime.fromisoformat(first["deadline_at"]))

    def test_answer_without_start_is_rejected(self):
        with self.assertRaises(HTTPException) as error:
            self.answer(1)
        self.assertEqual(error.exception.status_code, 409)

    def test_timeout_submission_counts_as_incorrect(self):
        self.start()
        self.now += timedelta(seconds=12)
        result = self.answer(None)
        self.assertTrue(result.timed_out)
        self.assertEqual(result.total_points, 0)
        self.assertEqual(self.db.users.documents[0]["incorrect_count"], 1)

    def test_invalid_options_are_rejected_by_schema(self):
        for option in [-1, 4]:
            with self.subTest(option=option):
                with self.assertRaises(ValueError):
                    server.AnswerSubmit(question_id="q1", selected_index=option)

    def test_concurrent_answer_and_timeout_do_not_double_score(self):
        self.start()
        self.now += timedelta(seconds=12)
        attempt = self.db.question_attempts.documents[0]

        async def race():
            return await asyncio.gather(
                server.record_timed_answer(attempt, None),
                server.record_timed_answer(attempt, 1),
            )

        results = self.run_async(race())
        self.assertEqual(len(results), 2)
        self.assertEqual(len(self.db.answers.documents), 1)
        self.assertEqual(self.db.users.documents[0]["incorrect_count"], 1)
