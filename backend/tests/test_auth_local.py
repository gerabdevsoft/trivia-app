# Tests for local email/password auth (register, login, forgot/reset password, rate limiting)
# Coexists with existing Emergent Google OAuth flow.
import os
import re
import time
import uuid
import hashlib
import asyncio
from datetime import datetime, timedelta, timezone

import pytest
import requests
from motor.motor_asyncio import AsyncIOMotorClient

BASE_URL = os.environ.get(
    "EXPO_PUBLIC_BACKEND_URL",
    "https://quiz-points-raffle.preview.emergentagent.com",
).rstrip("/")
MONGO_URL = os.environ["MONGO_URL"]
DB_NAME = os.environ["DB_NAME"]

ADMIN_EMAIL = "admin@usfx.bo"
ADMIN_PASSWORD = "4dm1n"


# ---------- helpers ----------
def _run(coro):
    return asyncio.new_event_loop().run_until_complete(coro)


def _uniq_ip_headers():
    """Return X-Forwarded-For with a per-call unique IP so per-IP rate buckets
    on /register do not collide across independent tests. The backend fix
    (`_client_ip`) now honours X-Forwarded-For, so this correctly gives each
    setup-registration a distinct client-IP bucket. The rate-limit test
    intentionally does NOT use this (it wants the 6 attempts to share one IP)."""
    return {"X-Forwarded-For": f"10.{uuid.uuid4().int % 250}.{uuid.uuid4().int % 250}.{uuid.uuid4().int % 250}"}


async def _clear_rate_state_for_email(email: str):
    """Cleanup after test to avoid bleeding into next tests."""
    # We cannot reach in-memory rate bucket, but we can wait it out or use fresh emails.
    pass


async def _seed_reset_token(email: str, ttl_hours: int = 1) -> str:
    """Insert a password_resets doc directly, return the raw token."""
    raw = uuid.uuid4().hex + uuid.uuid4().hex
    token_hash = hashlib.sha256(raw.encode("utf-8")).hexdigest()
    c = AsyncIOMotorClient(MONGO_URL)
    db = c[DB_NAME]
    user = await db.users.find_one({"email": email})
    assert user is not None, f"user {email} not found"
    await db.password_resets.insert_one({
        "token_hash": token_hash,
        "user_id": user["user_id"],
        "expires_at": datetime.now(timezone.utc) + timedelta(hours=ttl_hours),
        "used": False,
        "created_at": datetime.now(timezone.utc),
    })
    c.close()
    return raw


@pytest.fixture(scope="module", autouse=True)
def cleanup_module():
    yield
    async def _cleanup():
        c = AsyncIOMotorClient(MONGO_URL)
        db = c[DB_NAME]
        users = await db.users.find({"email": {"$regex": "^test_auth_"}}, {"user_id": 1, "_id": 0}).to_list(1000)
        uids = [u["user_id"] for u in users]
        if uids:
            await db.user_sessions.delete_many({"user_id": {"$in": uids}})
            await db.password_resets.delete_many({"user_id": {"$in": uids}})
            await db.users.delete_many({"user_id": {"$in": uids}})
        c.close()
    _run(_cleanup())


# ---------- Register ----------
class TestRegister:
    def test_register_success(self):
        email = f"test_auth_reg_{uuid.uuid4().hex[:8]}@example.com"
        r = requests.post(f"{BASE_URL}/api/auth/register",
                          json={"name": "Reg User", "email": email, "password": "secret123"},
                          headers=_uniq_ip_headers())
        assert r.status_code == 200, r.text
        data = r.json()
        assert "session_token" in data and data["session_token"]
        assert data["user"]["email"] == email
        assert data["user"]["is_admin"] is False
        assert data["user"].get("provider") == "local"

        # session_token should work on /api/auth/me
        me = requests.get(f"{BASE_URL}/api/auth/me",
                         headers={"Authorization": f"Bearer {data['session_token']}"})
        assert me.status_code == 200, me.text
        assert me.json()["email"] == email

    def test_register_duplicate_email_400(self):
        email = f"test_auth_dup_{uuid.uuid4().hex[:8]}@example.com"
        ip_hdr = _uniq_ip_headers()
        r1 = requests.post(f"{BASE_URL}/api/auth/register",
                           json={"name": "First", "email": email, "password": "secret123"},
                           headers=ip_hdr)
        assert r1.status_code == 200
        r2 = requests.post(f"{BASE_URL}/api/auth/register",
                           json={"name": "Second", "email": email, "password": "secret456"},
                           headers=ip_hdr)
        assert r2.status_code == 400
        assert "ya" in r2.json().get("detail", "").lower() or "regist" in r2.json().get("detail", "").lower()

    def test_register_short_password_422(self):
        email = f"test_auth_short_{uuid.uuid4().hex[:8]}@example.com"
        r = requests.post(f"{BASE_URL}/api/auth/register",
                          json={"name": "Short", "email": email, "password": "abc"},
                          headers=_uniq_ip_headers())
        # pydantic min_length=6 -> 422
        assert r.status_code == 422, r.text


# ---------- Login ----------
class TestLogin:
    def test_login_admin_success(self):
        r = requests.post(f"{BASE_URL}/api/auth/login",
                          json={"email": ADMIN_EMAIL, "password": ADMIN_PASSWORD})
        assert r.status_code == 200, r.text
        data = r.json()
        assert "session_token" in data
        assert data["user"]["email"] == ADMIN_EMAIL
        assert data["user"]["is_admin"] is True

        # JWT compat: verify admin endpoint works with returned token
        stats = requests.get(f"{BASE_URL}/api/admin/stats",
                             headers={"Authorization": f"Bearer {data['session_token']}"})
        assert stats.status_code == 200, stats.text
        body = stats.json()
        assert "total_users" in body and "top10" in body

    def test_login_wrong_password_400(self):
        # use a fresh user, not admin, to avoid rate-limit on admin@ before/after
        email = f"test_auth_wp_{uuid.uuid4().hex[:8]}@example.com"
        requests.post(f"{BASE_URL}/api/auth/register",
                      json={"name": "WP", "email": email, "password": "goodpass1"},
                      headers=_uniq_ip_headers())
        r = requests.post(f"{BASE_URL}/api/auth/login",
                          json={"email": email, "password": "wrongpass"})
        assert r.status_code == 400, r.text
        assert "credenciales" in r.json().get("detail", "").lower() or "invalid" in r.json().get("detail", "").lower()

    def test_login_nonexistent_email_400(self):
        email = f"test_auth_nope_{uuid.uuid4().hex[:8]}@example.com"
        r = requests.post(f"{BASE_URL}/api/auth/login",
                          json={"email": email, "password": "anything123"})
        assert r.status_code == 400, r.text


# ---------- Rate limit ----------
class TestRateLimit:
    def test_login_rate_limit_429_on_sixth(self):
        # rate limit: LOGIN_MAX_ATTEMPTS=5 in LOGIN_WINDOW_SEC=60, per (email, ip)
        email = f"test_auth_rl_{uuid.uuid4().hex[:8]}@example.com"
        # register the user first so 400 for wrong password (not 429) up to the 5th
        # NOTE: register uses a distinct IP header so it doesn't consume the login bucket
        requests.post(f"{BASE_URL}/api/auth/register",
                      json={"name": "RL", "email": email, "password": "correctpass"},
                      headers=_uniq_ip_headers())
        # For the login loop we DO share one IP: pin an X-Forwarded-For so the bucket
        # key is stable and 6th attempt reliably trips the limit through the ingress.
        login_ip = {"X-Forwarded-For": f"10.99.99.{uuid.uuid4().int % 250}"}
        codes = []
        for i in range(6):
            r = requests.post(f"{BASE_URL}/api/auth/login",
                              json={"email": email, "password": "wrongpass"},
                              headers=login_ip)
            codes.append(r.status_code)
        # First 5 attempts consume the bucket; on the 6th, the bucket blocks BEFORE checking password
        assert codes[:5] == [400, 400, 400, 400, 400], f"unexpected codes: {codes}"
        assert codes[5] == 429, f"expected 429 on 6th, got {codes}"


# ---------- Forgot password ----------
class TestForgotPassword:
    def test_forgot_password_registered_creates_reset_entry(self):
        email = f"test_auth_fp_{uuid.uuid4().hex[:8]}@example.com"
        requests.post(f"{BASE_URL}/api/auth/register",
                      json={"name": "FP", "email": email, "password": "somepass1"},
                      headers=_uniq_ip_headers())

        r = requests.post(f"{BASE_URL}/api/auth/forgot-password", json={"email": email},
                          headers=_uniq_ip_headers())
        assert r.status_code == 200, r.text
        msg = r.json().get("message", "")
        assert "recib" in msg.lower() or "correo" in msg.lower()

        # verify a password_resets entry was created for this user
        async def _check():
            c = AsyncIOMotorClient(MONGO_URL)
            db = c[DB_NAME]
            user = await db.users.find_one({"email": email})
            entry = await db.password_resets.find_one({"user_id": user["user_id"], "used": False})
            c.close()
            return entry
        entry = _run(_check())
        assert entry is not None, "password_resets entry not created"
        assert "token_hash" in entry

    def test_forgot_password_unregistered_same_message(self):
        email_unreg = f"test_auth_ghost_{uuid.uuid4().hex[:8]}@example.com"
        r_unreg = requests.post(f"{BASE_URL}/api/auth/forgot-password", json={"email": email_unreg},
                                headers=_uniq_ip_headers())
        assert r_unreg.status_code == 200, r_unreg.text
        # Register another and hit forgot to compare
        email_reg = f"test_auth_ghost2_{uuid.uuid4().hex[:8]}@example.com"
        requests.post(f"{BASE_URL}/api/auth/register",
                      json={"name": "G", "email": email_reg, "password": "somepass1"},
                      headers=_uniq_ip_headers())
        r_reg = requests.post(f"{BASE_URL}/api/auth/forgot-password", json={"email": email_reg},
                              headers=_uniq_ip_headers())
        assert r_reg.status_code == 200
        # Both must return the same generic message (no enumeration)
        assert r_unreg.json().get("message") == r_reg.json().get("message")


# ---------- Reset password ----------
class TestResetPassword:
    def _register(self, email, password="oldpass123"):
        r = requests.post(f"{BASE_URL}/api/auth/register",
                          json={"name": "Rst", "email": email, "password": password},
                          headers=_uniq_ip_headers())
        assert r.status_code == 200, r.text
        return r.json()["session_token"]

    def test_reset_password_valid_token_updates_and_revokes_sessions(self):
        email = f"test_auth_reset_{uuid.uuid4().hex[:8]}@example.com"
        old_token = self._register(email, password="oldpass123")

        # Confirm old session works
        me = requests.get(f"{BASE_URL}/api/auth/me",
                         headers={"Authorization": f"Bearer {old_token}"})
        assert me.status_code == 200

        # Seed a valid reset token directly
        raw = _run(_seed_reset_token(email))

        # Reset
        r = requests.post(f"{BASE_URL}/api/auth/reset-password",
                          json={"token": raw, "new_password": "newpass456"})
        assert r.status_code == 200, r.text
        assert r.json().get("ok") is True

        # Old session invalidated
        me2 = requests.get(f"{BASE_URL}/api/auth/me",
                          headers={"Authorization": f"Bearer {old_token}"})
        assert me2.status_code == 401, f"old session should be revoked, got {me2.status_code}"

        # Old password should fail; new password should work
        r_bad = requests.post(f"{BASE_URL}/api/auth/login",
                             json={"email": email, "password": "oldpass123"})
        assert r_bad.status_code == 400
        r_ok = requests.post(f"{BASE_URL}/api/auth/login",
                            json={"email": email, "password": "newpass456"})
        assert r_ok.status_code == 200, r_ok.text

    def test_reset_password_invalid_token_400(self):
        r = requests.post(f"{BASE_URL}/api/auth/reset-password",
                          json={"token": "totally-invalid-token-xyz", "new_password": "newpass789"})
        assert r.status_code == 400

    def test_reset_password_reused_token_400(self):
        email = f"test_auth_reuse_{uuid.uuid4().hex[:8]}@example.com"
        self._register(email, password="oldpass123")
        raw = _run(_seed_reset_token(email))

        # First use OK
        r1 = requests.post(f"{BASE_URL}/api/auth/reset-password",
                           json={"token": raw, "new_password": "newpass111"})
        assert r1.status_code == 200

        # Second use should fail
        r2 = requests.post(f"{BASE_URL}/api/auth/reset-password",
                           json={"token": raw, "new_password": "newpass222"})
        assert r2.status_code == 400


# ---------- Admin JWT retrocompatibility ----------
class TestAdminJWTCompat:
    def test_admin_endpoints_work_with_login_jwt(self):
        r = requests.post(f"{BASE_URL}/api/auth/login",
                          json={"email": ADMIN_EMAIL, "password": ADMIN_PASSWORD})
        assert r.status_code == 200, r.text
        token = r.json()["session_token"]
        headers = {"Authorization": f"Bearer {token}"}

        for path in ["/api/admin/stats", "/api/admin/questions", "/api/admin/users",
                     "/api/admin/prizes", "/api/admin/schedule/today", "/api/admin/settings",
                     "/api/admin/raffles/history"]:
            resp = requests.get(f"{BASE_URL}{path}", headers=headers)
            assert resp.status_code == 200, f"{path} -> {resp.status_code} {resp.text[:200]}"


# ---------- Idempotent admin seed ----------
class TestAdminSeedIdempotent:
    def test_admin_seed_survives_and_login_still_works(self):
        # Admin should always be able to log in (seed idempotent per startup logic)
        r = requests.post(f"{BASE_URL}/api/auth/login",
                          json={"email": ADMIN_EMAIL, "password": ADMIN_PASSWORD})
        assert r.status_code == 200
        assert r.json()["user"]["is_admin"] is True

        # Verify in DB that admin still exists with is_admin true and password_hash present
        async def _check():
            c = AsyncIOMotorClient(MONGO_URL)
            db = c[DB_NAME]
            u = await db.users.find_one({"email": ADMIN_EMAIL})
            c.close()
            return u
        u = _run(_check())
        assert u is not None
        assert u.get("is_admin") is True
        assert bool(u.get("password_hash"))
