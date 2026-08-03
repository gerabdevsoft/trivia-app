"""Backend tests for Trivia app - covers auth, admin, questions, answers, prizes, raffles, ranking."""
import base64
import os
import asyncio
from datetime import datetime, timezone, timedelta

import pytest
import requests
from motor.motor_asyncio import AsyncIOMotorClient

from conftest import BASE_URL, MONGO_URL, DB_NAME  # type: ignore


# --- Small PNG (1x1 red) base64 ---
PNG_1x1_B64 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8/5+hHgAHggJ/PchI7wAAAABJRU5ErkJggg=="


# =========================
# Health & Public
# =========================
class TestHealth:
    def test_root(self, api):
        r = api.get(f"{BASE_URL}/api/")
        assert r.status_code == 200
        assert "message" in r.json()

    def test_ranking_public(self, api):
        r = api.get(f"{BASE_URL}/api/ranking/weekly")
        assert r.status_code == 200
        data = r.json()
        assert "top10" in data and isinstance(data["top10"], list)
        assert "week_start" in data and "week_end" in data


# =========================
# Auth
# =========================
class TestAuth:
    def test_legacy_session_endpoint_removed(self, api):
        # /api/auth/session was removed in favor of /api/auth/google (direct Google Sign-In).
        r = api.post(f"{BASE_URL}/api/auth/session", json={"session_id": "invalid_session_id_xyz"})
        assert r.status_code == 404

    def test_invalid_google_id_token(self, api):
        # New endpoint: must reject an invalid id_token with 401.
        r = api.post(f"{BASE_URL}/api/auth/google", json={"id_token": "invalid"})
        assert r.status_code == 401

    def test_me_unauth(self, api):
        r = api.get(f"{BASE_URL}/api/auth/me")
        assert r.status_code == 401

    def test_me_admin(self, api, admin_auth):
        r = api.get(f"{BASE_URL}/api/auth/me", headers=admin_auth["headers"])
        assert r.status_code == 200
        data = r.json()
        assert data["email"] == "admin@usfx.bo"
        assert data["is_admin"] is True


# =========================
# Protected endpoints -> 401 without token
# =========================
class TestProtected401:
    @pytest.mark.parametrize("method,path", [
        ("GET", "/api/auth/me"),
        ("GET", "/api/admin/stats"),
        ("GET", "/api/questions/today"),
        ("GET", "/api/admin/users"),
        ("GET", "/api/admin/questions"),
        ("GET", "/api/admin/prizes"),
        ("POST", "/api/answers"),
    ])
    def test_requires_auth(self, api, method, path):
        r = api.request(method, f"{BASE_URL}{path}", json={} if method == "POST" else None)
        assert r.status_code == 401, f"{path} returned {r.status_code}"


# =========================
# Non-admin -> 403 on admin routes
# =========================
class TestForbiddenNonAdmin:
    def test_non_admin_stats(self, api, user_auth):
        r = api.get(f"{BASE_URL}/api/admin/stats", headers=user_auth["headers"])
        assert r.status_code == 403

    def test_non_admin_users(self, api, user_auth):
        r = api.get(f"{BASE_URL}/api/admin/users", headers=user_auth["headers"])
        assert r.status_code == 403


# =========================
# Admin seed & DB verify
# =========================
class TestAdminSeed:
    def test_admin_exists_in_mongo(self):
        async def _run():
            c = AsyncIOMotorClient(MONGO_URL)
            db = c[DB_NAME]
            u = await db.users.find_one({"email": "admin@usfx.bo"})
            c.close()
            return u
        u = asyncio.new_event_loop().run_until_complete(_run())
        assert u is not None
        assert u.get("is_admin") is True

    def test_at_least_8_seed_questions(self):
        async def _run():
            c = AsyncIOMotorClient(MONGO_URL)
            db = c[DB_NAME]
            count = await db.questions.count_documents({})
            c.close()
            return count
        count = asyncio.new_event_loop().run_until_complete(_run())
        assert count >= 8


# =========================
# Admin: Stats, Users, Settings
# =========================
class TestAdminBasic:
    def test_stats(self, api, admin_auth):
        r = api.get(f"{BASE_URL}/api/admin/stats", headers=admin_auth["headers"])
        assert r.status_code == 200
        d = r.json()
        for k in ("total_users", "active_users", "answers_total", "total_prizes"):
            assert k in d

    def test_list_users(self, api, admin_auth):
        r = api.get(f"{BASE_URL}/api/admin/users", headers=admin_auth["headers"])
        assert r.status_code == 200
        assert isinstance(r.json()["users"], list)

    def test_get_settings(self, api, admin_auth):
        r = api.get(f"{BASE_URL}/api/admin/settings", headers=admin_auth["headers"])
        assert r.status_code == 200
        assert "daily_questions_count" in r.json()

    def test_update_settings(self, api, admin_auth):
        r = api.put(f"{BASE_URL}/api/admin/settings", headers=admin_auth["headers"], json={"daily_questions_count": 6})
        assert r.status_code == 200
        assert r.json()["daily_questions_count"] == 6
        # reset
        api.put(f"{BASE_URL}/api/admin/settings", headers=admin_auth["headers"], json={"daily_questions_count": 5})

    def test_get_schedule_today(self, api, admin_auth):
        r = api.get(f"{BASE_URL}/api/admin/schedule/today", headers=admin_auth["headers"])
        assert r.status_code == 200
        assert "date" in r.json()


# =========================
# Admin: Questions CRUD
# =========================
class TestQuestionsCRUD:
    def test_full_crud(self, api, admin_auth):
        h = admin_auth["headers"]
        # create
        payload = {
            "statement": "TEST_ ¿2+2?",
            "options": ["1", "2", "3", "4"],
            "correct_index": 3,
            "category": "TEST_Math",
        }
        r = api.post(f"{BASE_URL}/api/admin/questions", headers=h, json=payload)
        assert r.status_code == 200
        qid = r.json()["id"]

        # list
        r = api.get(f"{BASE_URL}/api/admin/questions", headers=h)
        assert r.status_code == 200
        ids = [q["id"] for q in r.json()["questions"]]
        assert qid in ids

        # update
        r = api.put(f"{BASE_URL}/api/admin/questions/{qid}", headers=h, json={"category": "TEST_Math2"})
        assert r.status_code == 200

        # verify persisted
        r = api.get(f"{BASE_URL}/api/admin/questions?category=TEST_Math2", headers=h)
        assert r.status_code == 200
        assert any(q["id"] == qid for q in r.json()["questions"])

        # delete
        r = api.delete(f"{BASE_URL}/api/admin/questions/{qid}", headers=h)
        assert r.status_code == 200

        # verify deleted
        r = api.get(f"{BASE_URL}/api/admin/questions?category=TEST_Math2", headers=h)
        assert not any(q["id"] == qid for q in r.json()["questions"])


# =========================
# End-to-end: schedule, answer, ranking, points
# =========================
class TestE2EAnswerFlow:
    def test_flow(self, api, admin_auth, user_auth, user_auth2):
        ha = admin_auth["headers"]
        # Create a question
        r = api.post(f"{BASE_URL}/api/admin/questions", headers=ha, json={
            "statement": "TEST_E2E question",
            "options": ["A", "B", "C", "D"],
            "correct_index": 2,
            "category": "TEST_E2E",
        })
        assert r.status_code == 200
        qid = r.json()["id"]

        # Schedule it for today
        r = api.post(f"{BASE_URL}/api/admin/schedule", headers=ha, json={"question_ids": [qid]})
        assert r.status_code == 200
        assert qid in r.json()["question_ids"]

        # user reads today's questions
        hu = user_auth["headers"]
        r = api.get(f"{BASE_URL}/api/questions/today", headers=hu)
        assert r.status_code == 200
        qs = r.json()["questions"]
        assert any(q["id"] == qid for q in qs)

        # user submits answer (correct)
        r = api.post(f"{BASE_URL}/api/answers", headers=hu, json={"question_id": qid, "selected_index": 2})
        assert r.status_code == 200, r.text
        ans = r.json()
        assert ans["correct"] is True
        assert ans["points_awarded"] == 1
        assert ans["total_points"] >= 1

        # duplicate answer -> 400
        r = api.post(f"{BASE_URL}/api/answers", headers=hu, json={"question_id": qid, "selected_index": 2})
        assert r.status_code == 400

        # answer a non-scheduled question -> 400
        # Create another question not scheduled
        r = api.post(f"{BASE_URL}/api/admin/questions", headers=ha, json={
            "statement": "TEST_not_scheduled", "options": ["a", "b", "c", "d"], "correct_index": 0, "category": "TEST_"
        })
        qid2 = r.json()["id"]
        r = api.post(f"{BASE_URL}/api/answers", headers=hu, json={"question_id": qid2, "selected_index": 0})
        assert r.status_code == 400

        # user2 answers incorrectly - still creates activity for active raffle
        hu2 = user_auth2["headers"]
        r = api.post(f"{BASE_URL}/api/answers", headers=hu2, json={"question_id": qid, "selected_index": 0})
        assert r.status_code == 200
        assert r.json()["correct"] is False
        assert r.json()["points_awarded"] == 0

        # ranking should include user1
        r = api.get(f"{BASE_URL}/api/ranking/weekly")
        assert r.status_code == 200
        top_ids = [u["user_id"] for u in r.json()["top10"]]
        assert user_auth["user_id"] in top_ids


# =========================
# Prizes CRUD + Image
# =========================
class TestPrizesAndImage:
    def test_prize_crud_with_image(self, api, admin_auth):
        h = admin_auth["headers"]
        r = api.post(f"{BASE_URL}/api/admin/prizes", headers=h, json={
            "name": "TEST_Prize_Img",
            "description": "d",
            "prize_type": "weekly",
            "image_base64": PNG_1x1_B64,
            "image_content_type": "image/png",
        })
        assert r.status_code == 200
        pid = r.json()["id"]
        assert r.json()["has_image"] is True

        # GET image
        r = api.get(f"{BASE_URL}/api/prizes/{pid}/image")
        assert r.status_code == 200
        assert r.headers.get("content-type", "").startswith("image/png")
        assert len(r.content) > 0

        # list prizes
        r = api.get(f"{BASE_URL}/api/admin/prizes", headers=h)
        assert r.status_code == 200
        pids = [p["prize_id"] for p in r.json()["prizes"]]
        assert pid in pids

        # update prize
        r = api.put(f"{BASE_URL}/api/admin/prizes/{pid}", headers=h, json={"description": "updated"})
        assert r.status_code == 200

        # delete prize
        r = api.delete(f"{BASE_URL}/api/admin/prizes/{pid}", headers=h)
        assert r.status_code == 200

        # image should now 404
        r = api.get(f"{BASE_URL}/api/prizes/{pid}/image")
        assert r.status_code == 404


# =========================
# Raffles: weekly + active
# =========================
class TestRaffles:
    def test_weekly_raffle(self, api, admin_auth):
        h = admin_auth["headers"]
        # Ensure at least one participant exists this week (E2E test seeded one).
        # Create weekly prize
        r = api.post(f"{BASE_URL}/api/admin/prizes", headers=h, json={
            "name": "TEST_Weekly_Raffle", "description": "", "prize_type": "weekly"
        })
        assert r.status_code == 200
        pid = r.json()["id"]

        # Execute raffle
        r = api.post(f"{BASE_URL}/api/admin/raffles/weekly", headers=h, json={"prize_id": pid, "n": 10})
        assert r.status_code == 200, r.text
        d = r.json()
        assert d["prize_id"] == pid
        assert "winner" in d and d["winner"].get("user_id")

        # Re-execute should fail (already drawn)
        r = api.post(f"{BASE_URL}/api/admin/raffles/weekly", headers=h, json={"prize_id": pid, "n": 10})
        assert r.status_code == 400

        # History should include
        r = api.get(f"{BASE_URL}/api/admin/raffles/history", headers=h)
        assert r.status_code == 200
        assert any(x["prize_id"] == pid for x in r.json()["raffles"])

    def test_active_raffle(self, api, admin_auth):
        h = admin_auth["headers"]
        r = api.post(f"{BASE_URL}/api/admin/prizes", headers=h, json={
            "name": "TEST_Active_Raffle", "description": "", "prize_type": "active"
        })
        assert r.status_code == 200
        pid = r.json()["id"]
        r = api.post(f"{BASE_URL}/api/admin/raffles/active", headers=h, json={"prize_id": pid})
        assert r.status_code == 200, r.text
        assert r.json()["winner"].get("user_id")

        # Re-execute should fail
        r = api.post(f"{BASE_URL}/api/admin/raffles/active", headers=h, json={"prize_id": pid})
        assert r.status_code == 400


# =========================
# Notification
# =========================
class TestNotification:
    def test_send_notification(self, api, admin_auth):
        r = api.post(f"{BASE_URL}/api/admin/send-notification", headers=admin_auth["headers"],
                     json={"title": "TEST", "message": "msg", "audience": "all"})
        assert r.status_code == 200
        assert "sent_to" in r.json()
