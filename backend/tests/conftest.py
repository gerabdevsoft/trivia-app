import os
import asyncio
import uuid
from datetime import datetime, timedelta, timezone

import pytest
import requests
from dotenv import load_dotenv
from motor.motor_asyncio import AsyncIOMotorClient

load_dotenv('/app/backend/.env')

BASE_URL = os.environ.get("EXPO_PUBLIC_BACKEND_URL", "https://quiz-points-raffle.preview.emergentagent.com").rstrip("/")
MONGO_URL = os.environ["MONGO_URL"]
DB_NAME = os.environ["DB_NAME"]


@pytest.fixture(scope="session")
def base_url():
    return BASE_URL


@pytest.fixture(scope="session")
def api():
    s = requests.Session()
    s.headers.update({"Content-Type": "application/json"})
    return s


def _seed_session_sync(email: str, name: str = "Test User", make_admin_if_missing: bool = False):
    async def _run():
        c = AsyncIOMotorClient(MONGO_URL)
        db = c[DB_NAME]
        user = await db.users.find_one({"email": email})
        if not user:
            uid = f"user_{uuid.uuid4().hex[:12]}"
            await db.users.insert_one({
                "user_id": uid,
                "email": email,
                "name": name,
                "picture": None,
                "is_admin": make_admin_if_missing,
                "is_active": True,
                "total_points": 0,
                "correct_count": 0,
                "incorrect_count": 0,
                "created_at": datetime.now(timezone.utc),
            })
            user = await db.users.find_one({"email": email})
        token = f"test_{uuid.uuid4().hex}"
        await db.user_sessions.insert_one({
            "session_token": token,
            "user_id": user["user_id"],
            "expires_at": datetime.now(timezone.utc) + timedelta(days=1),
            "created_at": datetime.now(timezone.utc),
        })
        c.close()
        return token, user["user_id"]
    return asyncio.get_event_loop().run_until_complete(_run()) if False else asyncio.new_event_loop().run_until_complete(_run())


@pytest.fixture(scope="session")
def admin_auth():
    token, user_id = _seed_session_sync("admin@usfx.bo", "Administrador")
    return {"token": token, "user_id": user_id, "headers": {"Authorization": f"Bearer {token}", "Content-Type": "application/json"}}


@pytest.fixture(scope="session")
def user_auth():
    email = f"test_user_{uuid.uuid4().hex[:6]}@example.com"
    token, user_id = _seed_session_sync(email, "Test Normal User")
    return {"token": token, "user_id": user_id, "email": email, "headers": {"Authorization": f"Bearer {token}", "Content-Type": "application/json"}}


@pytest.fixture(scope="session")
def user_auth2():
    email = f"test_user2_{uuid.uuid4().hex[:6]}@example.com"
    token, user_id = _seed_session_sync(email, "Test Normal User 2")
    return {"token": token, "user_id": user_id, "email": email, "headers": {"Authorization": f"Bearer {token}", "Content-Type": "application/json"}}


@pytest.fixture(scope="session", autouse=True)
def cleanup_test_data():
    yield
    async def _cleanup():
        c = AsyncIOMotorClient(MONGO_URL)
        db = c[DB_NAME]
        # Remove test users and their sessions/answers
        users = await db.users.find({"email": {"$regex": "^test_user"}}, {"user_id": 1, "_id": 0}).to_list(1000)
        uids = [u["user_id"] for u in users]
        if uids:
            await db.answers.delete_many({"user_id": {"$in": uids}})
            await db.user_sessions.delete_many({"user_id": {"$in": uids}})
            await db.users.delete_many({"user_id": {"$in": uids}})
        # Cleanup admin test tokens
        await db.user_sessions.delete_many({"session_token": {"$regex": "^test_"}})
        # Remove TEST_ prefixed prizes/questions
        await db.prizes.delete_many({"name": {"$regex": "^TEST_"}})
        await db.questions.delete_many({"statement": {"$regex": "^TEST_"}})
        c.close()
    asyncio.new_event_loop().run_until_complete(_cleanup())
