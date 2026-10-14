import asyncio
import unittest
from types import SimpleNamespace
from unittest.mock import patch

from fastapi import HTTPException
from test_timed_quiz import Collection, server


class FakeAnswers:
    def __init__(self, user_ids):
        self.user_ids = user_ids

    async def distinct(self, key, query):
        return list(self.user_ids)


class ActiveRaffleTests(unittest.TestCase):
    def setUp(self):
        self.faculty_a, self.faculty_b = server.FACULTIES[:2]
        self.prize = {
            "prize_id": "prize-test",
            "prize_type": "active",
            "name": "Premio de prueba",
            "executed": False,
        }
        self.users = [
            {"user_id": "active-a", "email": "a@example.com", "name": "A", "faculty": self.faculty_a, "is_active": True},
            {"user_id": "active-b", "email": "b@example.com", "name": "B", "faculty": self.faculty_b, "is_active": True},
            {"user_id": "inactive-a", "email": "inactive@example.com", "name": "Inactive", "faculty": self.faculty_a, "is_active": False},
        ]
        self.db = SimpleNamespace(
            prizes=Collection([dict(self.prize)]),
            answers=FakeAnswers([user["user_id"] for user in self.users]),
            users=Collection(self.users),
            raffles=Collection(),
        )

    def execute(self, faculty=None):
        async def fake_send_push(*args, **kwargs):
            return 1

        body = server.RaffleExecuteActive(prize_id=self.prize["prize_id"], faculty=faculty)
        with patch.object(server, "db", self.db), \
             patch.object(server, "send_push", fake_send_push), \
             patch.object(server.random, "choice", side_effect=lambda values: values[0]):
            return asyncio.run(server.admin_execute_active(body, None))

    def test_selected_faculty_limits_participants_and_is_saved(self):
        raffle = self.execute(self.faculty_a)

        self.assertEqual(raffle.faculty, self.faculty_a)
        self.assertEqual([participant["user_id"] for participant in raffle.participants], ["active-a"])
        self.assertEqual(self.db.raffles.documents[0]["faculty"], self.faculty_a)

    def test_all_faculties_includes_all_active_users_but_not_inactive_accounts(self):
        raffle = self.execute()

        self.assertIsNone(raffle.faculty)
        self.assertEqual(
            {participant["user_id"] for participant in raffle.participants},
            {"active-a", "active-b"},
        )

    def test_unknown_faculty_is_rejected(self):
        body = server.RaffleExecuteActive(prize_id=self.prize["prize_id"], faculty="Facultad inexistente")
        with patch.object(server, "db", SimpleNamespace()):
            with self.assertRaises(HTTPException) as raised:
                asyncio.run(server.admin_execute_active(body, None))

        self.assertEqual(raised.exception.status_code, 400)
