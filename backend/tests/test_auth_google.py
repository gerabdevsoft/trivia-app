# Tests for the new Google Sign-In endpoint POST /api/auth/google
# and confirms that the legacy Emergent OAuth endpoint POST /api/auth/session
# no longer exists.
import os
import uuid

import jwt as pyjwt
import pytest
import requests
from dotenv import load_dotenv

load_dotenv("/app/backend/.env")

BASE_URL = os.environ.get(
    "EXPO_PUBLIC_BACKEND_URL",
    "https://quiz-points-raffle.preview.emergentagent.com",
).rstrip("/")

GOOGLE_WEB_CLIENT_ID = os.environ.get("GOOGLE_WEB_CLIENT_ID", "")
GOOGLE_ANDROID_CLIENT_ID = os.environ.get("GOOGLE_ANDROID_CLIENT_ID", "")


# ---------- Legacy endpoint /api/auth/session removed ----------
class TestLegacySessionRemoved:
    def test_post_auth_session_returns_404(self):
        r = requests.post(f"{BASE_URL}/api/auth/session", json={"session_id": "anything"})
        assert r.status_code == 404, f"expected 404, got {r.status_code}: {r.text[:200]}"

    def test_post_auth_session_no_body_still_404(self):
        r = requests.post(f"{BASE_URL}/api/auth/session")
        assert r.status_code == 404


# ---------- Backend env exposes at least one Google audience ----------
class TestGoogleEnvConfigured:
    def test_google_web_client_id_non_empty_in_env(self):
        # This is a sanity check that the backend .env has the WEB client id.
        assert GOOGLE_WEB_CLIENT_ID, "GOOGLE_WEB_CLIENT_ID missing from backend/.env"
        assert GOOGLE_WEB_CLIENT_ID.endswith(".apps.googleusercontent.com")

    def test_google_endpoint_is_reachable(self):
        # The endpoint must exist (not 404). It should reject empty body with 422.
        r = requests.post(f"{BASE_URL}/api/auth/google")
        assert r.status_code == 422, f"expected 422 no-body, got {r.status_code}: {r.text[:200]}"


# ---------- Validation on /api/auth/google ----------
class TestGoogleValidation:
    def test_missing_id_token_422(self):
        r = requests.post(f"{BASE_URL}/api/auth/google", json={})
        assert r.status_code == 422, r.text

    def test_wrong_type_id_token_422(self):
        r = requests.post(f"{BASE_URL}/api/auth/google", json={"id_token": 12345})
        assert r.status_code == 422, r.text

    def test_invalid_id_token_401(self):
        r = requests.post(f"{BASE_URL}/api/auth/google", json={"id_token": "invalid"})
        assert r.status_code == 401, f"expected 401, got {r.status_code}: {r.text[:200]}"
        detail = r.json().get("detail", "")
        assert "ID token inv" in detail or "inv" in detail.lower(), f"unexpected detail: {detail}"

    def test_random_string_401(self):
        r = requests.post(f"{BASE_URL}/api/auth/google",
                          json={"id_token": "abc.def.ghi"})
        assert r.status_code == 401

    def test_jwt_signed_with_other_key_401(self):
        """A JWT that is well-formed but not signed with Google's keys must be rejected."""
        payload = {
            "iss": "accounts.google.com",
            "aud": GOOGLE_WEB_CLIENT_ID or "fake-audience",
            "email": "attacker@example.com",
            "email_verified": True,
            "sub": "1234567890",
            "name": "Attacker",
            "iat": 0,
            "exp": 9999999999,
        }
        fake_token = pyjwt.encode(payload, "attacker-secret-key", algorithm="HS256")
        r = requests.post(f"{BASE_URL}/api/auth/google", json={"id_token": fake_token})
        assert r.status_code == 401, f"expected 401 for foreign-signed JWT, got {r.status_code}: {r.text[:200]}"


# ---------- /api/auth/logout works with any Bearer JWT (Google or local) ----------
class TestLogoutRevokesSessions:
    def test_logout_revokes_local_session(self):
        # Simulate a logged-in local user, log out, verify token is dead
        email = f"test_auth_logout_{uuid.uuid4().hex[:8]}@example.com"
        headers = {"X-Forwarded-For": f"10.55.{uuid.uuid4().int % 250}.{uuid.uuid4().int % 250}"}
        reg = requests.post(f"{BASE_URL}/api/auth/register",
                            json={"name": "LO", "email": email, "password": "logoutpass"},
                            headers=headers)
        assert reg.status_code == 200, reg.text
        token = reg.json()["session_token"]

        me = requests.get(f"{BASE_URL}/api/auth/me",
                          headers={"Authorization": f"Bearer {token}"})
        assert me.status_code == 200

        out = requests.post(f"{BASE_URL}/api/auth/logout",
                            headers={"Authorization": f"Bearer {token}"})
        assert out.status_code == 200
        assert out.json().get("ok") is True

        me2 = requests.get(f"{BASE_URL}/api/auth/me",
                           headers={"Authorization": f"Bearer {token}"})
        assert me2.status_code == 401, f"token should be revoked, got {me2.status_code}"


# ---------- module-level cleanup ----------
@pytest.fixture(scope="module", autouse=True)
def _cleanup_module():
    yield
    import asyncio
    from motor.motor_asyncio import AsyncIOMotorClient
    MONGO_URL = os.environ["MONGO_URL"]
    DB_NAME = os.environ["DB_NAME"]

    async def _cleanup():
        c = AsyncIOMotorClient(MONGO_URL)
        db = c[DB_NAME]
        users = await db.users.find({"email": {"$regex": "^test_auth_logout_"}},
                                    {"user_id": 1, "_id": 0}).to_list(1000)
        uids = [u["user_id"] for u in users]
        if uids:
            await db.user_sessions.delete_many({"user_id": {"$in": uids}})
            await db.users.delete_many({"user_id": {"$in": uids}})
        c.close()
    asyncio.new_event_loop().run_until_complete(_cleanup())
