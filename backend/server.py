import os
import base64
import hashlib
import logging
import random
import secrets
import time
import uuid
from datetime import datetime, timezone, timedelta
from pathlib import Path
from typing import List, Optional, Dict, Any, Tuple

import httpx
import jwt as pyjwt
from google.oauth2 import id_token as google_id_token
from google.auth.transport import requests as google_requests
from passlib.context import CryptContext
try:
    from zoneinfo import ZoneInfo  # Python 3.9+
except ImportError:  # pragma: no cover
    from backports.zoneinfo import ZoneInfo  # type: ignore
from fastapi import FastAPI, APIRouter, HTTPException, Depends, Header, Request
from fastapi.responses import Response as FastAPIResponse, JSONResponse
from dotenv import load_dotenv
from starlette.middleware.cors import CORSMiddleware
from motor.motor_asyncio import AsyncIOMotorClient
from pydantic import BaseModel, EmailStr, Field

# --- Load env ---
ROOT_DIR = Path(__file__).parent
load_dotenv(ROOT_DIR / ".env")

MONGO_URL = os.environ["MONGO_URL"]
DB_NAME = os.environ["DB_NAME"]
EMERGENT_PUSH_KEY = os.environ.get("EMERGENT_PUSH_KEY", "placeholder")
RESEND_API_KEY = os.environ.get("RESEND_API_KEY", "placeholder")
RESEND_FROM_EMAIL = os.environ.get("RESEND_FROM_EMAIL", "notifications@resend.dev")
ADMIN_EMAIL = os.environ.get("ADMIN_EMAIL", "admin@usfx.bo").lower()
ADMIN_PASSWORD = os.environ.get("ADMIN_PASSWORD", "4dm1n")
JWT_SECRET_KEY = os.environ.get("JWT_SECRET_KEY", "changeme-in-production")
JWT_ALGORITHM = os.environ.get("JWT_ALGORITHM", "HS256")
JWT_EXPIRES_DAYS = int(os.environ.get("JWT_EXPIRES_DAYS", "7"))
FRONTEND_BASE_URL = os.environ.get("FRONTEND_BASE_URL", "")
IDLE_TIMEZONE = os.environ.get("IDLE_TIMEZONE", "America/La_Paz")
IDLE_START_HOUR = int(os.environ.get("IDLE_START_HOUR", "22"))  # 22:00 inclusive
IDLE_END_HOUR = int(os.environ.get("IDLE_END_HOUR", "8"))       # 08:00 exclusive
GOOGLE_WEB_CLIENT_ID = os.environ.get("GOOGLE_WEB_CLIENT_ID", "")
GOOGLE_ANDROID_CLIENT_ID = os.environ.get("GOOGLE_ANDROID_CLIENT_ID", "")
GOOGLE_IOS_CLIENT_ID = os.environ.get("GOOGLE_IOS_CLIENT_ID", "")
ALLOWED_GOOGLE_AUDIENCES = {
    a for a in (GOOGLE_WEB_CLIENT_ID, GOOGLE_ANDROID_CLIENT_ID, GOOGLE_IOS_CLIENT_ID) if a
}

PUSH_BASE_URL = "https://integrations.emergentagent.com"
EMERGENT_AUTH_URL = "https://demobackend.emergentagent.com/auth/v1/env/oauth/session-data"  # legacy (unused)

pwd_ctx = CryptContext(schemes=["bcrypt"], deprecated="auto")

# --- Logging ---
logging.basicConfig(level=logging.INFO, format="%(asctime)s - %(levelname)s - %(message)s")
logger = logging.getLogger(__name__)

# --- Mongo ---
client = AsyncIOMotorClient(MONGO_URL)
db = client[DB_NAME]

# --- HTTP clients ---
push_client = httpx.AsyncClient(
    base_url=PUSH_BASE_URL,
    headers={"X-Push-Key": EMERGENT_PUSH_KEY},
    timeout=10.0,
)
emergent_auth_client = None  # Emergent auth removed; kept var for compatibility

# --- App ---
app = FastAPI()

# =========================
# Idle / Modo Cerrado
# =========================
try:
    IDLE_TZ = ZoneInfo(IDLE_TIMEZONE)
except Exception:
    logger.warning(f"Timezone inválida '{IDLE_TIMEZONE}', usando UTC")
    IDLE_TZ = ZoneInfo("UTC")


def _bolivia_now() -> datetime:
    return datetime.now(IDLE_TZ)


def is_idle_now() -> bool:
    """True si la hora local está en el rango cerrado [IDLE_START_HOUR, IDLE_END_HOUR)."""
    h = _bolivia_now().hour
    start = IDLE_START_HOUR
    end = IDLE_END_HOUR
    if start == end:
        return False
    if start < end:
        return start <= h < end
    # rango cruza medianoche (22 - 8)
    return h >= start or h < end


IDLE_ALLOWED_PATHS = {"/api/", "/api/status", "/docs", "/openapi.json", "/redoc"}


@app.middleware("http")
async def idle_gate(request: Request, call_next):
    path = request.url.path
    if is_idle_now() and path not in IDLE_ALLOWED_PATHS:
        reopens = f"{IDLE_END_HOUR:02d}:00 ({IDLE_TIMEZONE})"
        closes = f"{IDLE_START_HOUR:02d}:00"
        return JSONResponse(
            status_code=503,
            content={
                "detail": "Aplicación cerrada",
                "message": f"El servicio está en reposo. Reabre a las {reopens}.",
                "idle": True,
                "reopens_at": reopens,
                "closes_at": closes,
                "timezone": IDLE_TIMEZONE,
            },
            headers={"Retry-After": "3600"},
        )
    return await call_next(request)


# =========================
# Models
# =========================
class GoogleAuthBody(BaseModel):
    id_token: str


class RegisterBody(BaseModel):
    name: str = Field(..., min_length=2, max_length=80)
    email: EmailStr
    password: str = Field(..., min_length=6, max_length=128)


class LoginBody(BaseModel):
    email: EmailStr
    password: str


class ForgotPasswordBody(BaseModel):
    email: EmailStr


class ResetPasswordBody(BaseModel):
    token: str
    new_password: str = Field(..., min_length=6, max_length=128)


class UserOut(BaseModel):
    user_id: str
    email: str
    name: str
    picture: Optional[str] = None
    is_admin: bool = False
    is_active: bool = True
    total_points: int = 0
    correct_count: int = 0
    incorrect_count: int = 0


class QuestionCreate(BaseModel):
    statement: str
    options: List[str] = Field(..., min_length=4, max_length=4)
    correct_index: int = Field(..., ge=0, le=3)
    category: str = "General"
    active: bool = True


class QuestionUpdate(BaseModel):
    statement: Optional[str] = None
    options: Optional[List[str]] = None
    correct_index: Optional[int] = None
    category: Optional[str] = None
    active: Optional[bool] = None


class QuestionOut(BaseModel):
    id: str
    statement: str
    options: List[str]
    correct_index: int
    category: str
    active: bool


class QuestionForUser(BaseModel):
    id: str
    statement: str
    options: List[str]
    category: str
    already_answered: bool = False
    selected_index: Optional[int] = None
    was_correct: Optional[bool] = None


class AnswerSubmit(BaseModel):
    question_id: str
    selected_index: int


class AnswerResult(BaseModel):
    correct: bool
    correct_index: int
    points_awarded: int
    total_points: int


class PrizeCreate(BaseModel):
    name: str
    description: str = ""
    prize_type: str  # "weekly" | "active"
    draw_date: Optional[str] = None  # ISO date
    image_base64: Optional[str] = None  # data URL or raw base64
    image_content_type: Optional[str] = "image/jpeg"


class PrizeUpdate(BaseModel):
    name: Optional[str] = None
    description: Optional[str] = None
    draw_date: Optional[str] = None
    image_base64: Optional[str] = None
    image_content_type: Optional[str] = None


class PrizeOut(BaseModel):
    id: str
    name: str
    description: str
    prize_type: str
    draw_date: Optional[str] = None
    has_image: bool = False
    executed: bool = False
    created_at: str


class RaffleExecuteWeekly(BaseModel):
    prize_id: str
    n: int = 10  # top N users to include


class RaffleExecuteActive(BaseModel):
    prize_id: str
    start_date: Optional[str] = None  # ISO date; if None, uses last 7 days
    end_date: Optional[str] = None


class RaffleOut(BaseModel):
    id: str
    prize_id: str
    prize_name: str
    prize_type: str
    date: str
    participants: List[Dict[str, Any]]  # {user_id, email, name, points?}
    winner: Dict[str, Any]  # {user_id, email, name}


class SettingsUpdate(BaseModel):
    daily_questions_count: Optional[int] = None


class ScheduleDaily(BaseModel):
    question_ids: List[str]
    date: Optional[str] = None  # ISO date. Default: today


class RegisterPushBody(BaseModel):
    platform: str  # "android" | "ios"
    device_token: str


class SendNotificationBody(BaseModel):
    title: str
    message: str
    audience: str = "all"  # "all" or "active"


# =========================
# Helpers
# =========================
def now_utc() -> datetime:
    return datetime.now(timezone.utc)


def to_iso(dt: datetime) -> str:
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return dt.isoformat()


def week_bounds(dt: Optional[datetime] = None):
    """Returns (start_of_week_utc, end_of_week_utc) - Monday to Sunday."""
    dt = dt or now_utc()
    monday = dt - timedelta(days=dt.weekday())
    start = monday.replace(hour=0, minute=0, second=0, microsecond=0)
    end = start + timedelta(days=7)
    return start, end


def today_bounds():
    now = now_utc()
    start = now.replace(hour=0, minute=0, second=0, microsecond=0)
    end = start + timedelta(days=1)
    return start, end


def date_only(dt: datetime) -> str:
    return dt.strftime("%Y-%m-%d")


async def get_current_user(authorization: Optional[str] = Header(None)) -> Dict[str, Any]:
    if not authorization or not authorization.lower().startswith("bearer "):
        raise HTTPException(status_code=401, detail="Missing authorization")
    token = authorization.split(" ", 1)[1].strip()
    session = await db.user_sessions.find_one({"session_token": token}, {"_id": 0})
    if not session:
        raise HTTPException(status_code=401, detail="Invalid session")
    exp = session.get("expires_at")
    if exp:
        if isinstance(exp, str):
            try:
                exp = datetime.fromisoformat(exp)
            except Exception:
                exp = None
        if exp and exp.tzinfo is None:
            exp = exp.replace(tzinfo=timezone.utc)
        if exp and exp < now_utc():
            raise HTTPException(status_code=401, detail="Session expired")
    user = await db.users.find_one({"user_id": session["user_id"]}, {"_id": 0})
    if not user:
        raise HTTPException(status_code=401, detail="User not found")
    if not user.get("is_active", True):
        raise HTTPException(status_code=403, detail="User deactivated")
    return user


async def require_admin(user: Dict[str, Any] = Depends(get_current_user)) -> Dict[str, Any]:
    if not user.get("is_admin"):
        raise HTTPException(status_code=403, detail="Admin only")
    return user


async def send_push(recipients: List[str], data: dict, idempotency_key: Optional[str] = None) -> None:
    if not recipients:
        return
    if "title" not in data or "message" not in data:
        raise ValueError("data must include title and message")
    # Chunk to 100
    for i in range(0, len(recipients), 100):
        chunk = recipients[i : i + 100]
        payload: dict = {"recipients": chunk, "data": data}
        if idempotency_key:
            payload["$idempotency_key"] = f"{idempotency_key}-{i}"
        try:
            resp = await push_client.post("/api/v1/push/trigger", json=payload)
            if resp.status_code == 401:
                logger.warning("Emergent Push: invalid/missing key (401). Placeholder in dev is expected.")
                return
            if resp.status_code >= 400:
                logger.warning(f"Push trigger failed {resp.status_code}: {resp.text[:200]}")
        except Exception as e:
            logger.warning(f"Push exception (non-blocking): {e}")


async def send_email_resend(to_emails: List[str], subject: str, html: str) -> None:
    if RESEND_API_KEY == "placeholder" or not RESEND_API_KEY:
        logger.info(f"[EMAIL MOCK] to={to_emails} subject={subject}")
        return
    try:
        import resend  # type: ignore
        resend.api_key = RESEND_API_KEY
        for to in to_emails:
            resend.Emails.send({
                "from": f"Trivia GerabDevSoft <{RESEND_FROM_EMAIL}>",
                "to": [to],
                "subject": subject,
                "html": html,
            })
    except Exception as e:
        logger.warning(f"Resend email failed: {e}")


def user_public(u: Dict[str, Any]) -> Dict[str, Any]:
    return {
        "user_id": u.get("user_id"),
        "email": u.get("email"),
        "name": u.get("name"),
        "picture": u.get("picture"),
        "is_admin": bool(u.get("is_admin", False)),
        "is_active": bool(u.get("is_active", True)),
        "total_points": int(u.get("total_points", 0)),
        "correct_count": int(u.get("correct_count", 0)),
        "incorrect_count": int(u.get("incorrect_count", 0)),
        "provider": u.get("provider", "local"),
    }


# =========================
# Local Auth Helpers
# =========================
def hash_password(pw: str) -> str:
    return pwd_ctx.hash(pw)


def verify_password(pw: str, hashed: str) -> bool:
    try:
        return pwd_ctx.verify(pw, hashed)
    except Exception:
        return False


def create_jwt(user_id: str, email: str, is_admin: bool) -> str:
    now = int(time.time())
    payload = {
        "user_id": user_id,
        "email": email,
        "is_admin": is_admin,
        "iat": now,
        "exp": now + JWT_EXPIRES_DAYS * 86400,
        "jti": uuid.uuid4().hex,
    }
    return pyjwt.encode(payload, JWT_SECRET_KEY, algorithm=JWT_ALGORITHM)


# Rate limit for login/forgot-password: in-memory
_rate_bucket: Dict[Tuple[str, str], List[float]] = {}
LOGIN_WINDOW_SEC = 60
LOGIN_MAX_ATTEMPTS = 5
FORGOT_WINDOW_SEC = 3600
FORGOT_MAX_ATTEMPTS = 5


def _client_ip(request: Request) -> str:
    """Get real client IP, respecting X-Forwarded-For / X-Real-IP from the ingress."""
    xff = request.headers.get("x-forwarded-for") or request.headers.get("X-Forwarded-For")
    if xff:
        # leftmost = original client
        return xff.split(",")[0].strip()
    xri = request.headers.get("x-real-ip") or request.headers.get("X-Real-IP")
    if xri:
        return xri.strip()
    return request.client.host if request.client else "unknown"


def _rate_check(key: Tuple[str, str], window: int, max_attempts: int) -> None:
    now = time.time()
    arr = [t for t in _rate_bucket.get(key, []) if now - t < window]
    if len(arr) >= max_attempts:
        raise HTTPException(status_code=429, detail="Demasiados intentos. Inténtalo más tarde.")
    arr.append(now)
    _rate_bucket[key] = arr


def _hash_reset_token(raw: str) -> str:
    return hashlib.sha256(raw.encode("utf-8")).hexdigest()


async def send_reset_email(to_email: str, name: str, raw_token: str) -> None:
    reset_link = f"{FRONTEND_BASE_URL}/reset-password?token={raw_token}" if FRONTEND_BASE_URL else raw_token
    if RESEND_API_KEY == "placeholder" or not RESEND_API_KEY:
        logger.info(f"[EMAIL MOCK] Reset link para {to_email}: {reset_link}")
        return
    try:
        import resend  # type: ignore
        resend.api_key = RESEND_API_KEY
        resend.Emails.send({
            "from": f"Trivia GerabDevSoft <{RESEND_FROM_EMAIL}>",
            "to": [to_email],
            "subject": "Recuperación de contraseña",
            "html": (
                f"<p>Hola {name or ''},</p>"
                f"<p>Solicitaste restablecer tu contraseña. Ingresa este código o abre el enlace:</p>"
                f"<p style='font-size:20px;font-weight:bold;'>{raw_token}</p>"
                f"<p><a href='{reset_link}'>Restablecer contraseña</a></p>"
                f"<p>Este código expira en 1 hora. Si no solicitaste esto, ignora este correo.</p>"
            ),
        })
    except Exception as e:
        logger.warning(f"Resend send failed: {e}")


# =========================
# Startup
# =========================
@app.on_event("startup")
async def on_startup():
    await db.users.create_index("email", unique=True)
    await db.users.create_index("user_id", unique=True)
    await db.user_sessions.create_index("session_token", unique=True)
    await db.user_sessions.create_index("expires_at", expireAfterSeconds=0)
    await db.questions.create_index("category")
    await db.answers.create_index([("user_id", 1), ("question_id", 1)], unique=True)
    await db.answers.create_index("answered_at")
    await db.daily_schedules.create_index("date", unique=True)
    await db.prizes.create_index("prize_type")
    await db.push_tokens.create_index("user_id")
    await db.password_resets.create_index("expires_at", expireAfterSeconds=0)
    await db.password_resets.create_index("token_hash", unique=True)

    # Seed admin (with password for email/password login). Google login on admin@usfx.bo also grants admin.
    existing = await db.users.find_one({"email": ADMIN_EMAIL})
    admin_hash = hash_password(ADMIN_PASSWORD)
    if not existing:
        await db.users.insert_one({
            "user_id": f"user_{uuid.uuid4().hex[:12]}",
            "email": ADMIN_EMAIL,
            "name": "Administrador",
            "picture": None,
            "is_admin": True,
            "is_active": True,
            "total_points": 0,
            "correct_count": 0,
            "incorrect_count": 0,
            "created_at": now_utc(),
            "provider": "local",
            "password_hash": admin_hash,
        })
        logger.info(f"Seeded admin {ADMIN_EMAIL} with local password")
    else:
        # Idempotent: ensure admin has password_hash and is_admin flag
        updates: Dict[str, Any] = {"is_admin": True}
        if not existing.get("password_hash"):
            updates["password_hash"] = admin_hash
            updates["provider"] = existing.get("provider") or "local"
        if updates:
            await db.users.update_one({"email": ADMIN_EMAIL}, {"$set": updates})

    # Settings
    settings = await db.settings.find_one({"key": "main"})
    if not settings:
        await db.settings.insert_one({"key": "main", "daily_questions_count": 5})

    # Seed sample questions if empty
    q_count = await db.questions.count_documents({})
    if q_count == 0:
        sample = [
            {"statement": "¿Cuál es la capital de Bolivia?", "options": ["Sucre", "La Paz", "Cochabamba", "Santa Cruz"], "correct_index": 0, "category": "Geografía"},
            {"statement": "¿Cuánto es 7 x 8?", "options": ["54", "56", "64", "48"], "correct_index": 1, "category": "Matemáticas"},
            {"statement": "¿Quién escribió Don Quijote?", "options": ["Cervantes", "Shakespeare", "Borges", "García Márquez"], "correct_index": 0, "category": "Literatura"},
            {"statement": "¿En qué año llegó el hombre a la Luna?", "options": ["1965", "1969", "1972", "1959"], "correct_index": 1, "category": "Historia"},
            {"statement": "¿Cuál es el símbolo químico del oro?", "options": ["Or", "Au", "Ag", "Go"], "correct_index": 1, "category": "Ciencia"},
            {"statement": "¿Qué planeta es el más grande del sistema solar?", "options": ["Saturno", "Marte", "Júpiter", "Neptuno"], "correct_index": 2, "category": "Ciencia"},
            {"statement": "¿Cuántos continentes hay?", "options": ["5", "6", "7", "8"], "correct_index": 2, "category": "Geografía"},
            {"statement": "¿Idioma más hablado del mundo (nativos)?", "options": ["Inglés", "Español", "Mandarín", "Hindi"], "correct_index": 2, "category": "Cultura"},
        ]
        docs = []
        for s in sample:
            docs.append({
                "question_id": f"q_{uuid.uuid4().hex[:12]}",
                **s,
                "active": True,
                "created_at": now_utc(),
            })
        await db.questions.insert_many(docs)
        logger.info(f"Seeded {len(docs)} sample questions")


@app.on_event("shutdown")
async def on_shutdown():
    await push_client.aclose()
    client.close()


# =========================
# Auth
# =========================
@api_router.post("/auth/google")
async def auth_google(body: GoogleAuthBody):
    """Verify Google ID token and issue JWT session_token."""
    if not ALLOWED_GOOGLE_AUDIENCES:
        raise HTTPException(status_code=500, detail="Google OAuth no está configurado en el servidor")
    try:
        # Passing audience=None allows us to accept multiple valid client IDs (mobile + web)
        payload = google_id_token.verify_oauth2_token(
            body.id_token,
            google_requests.Request(),
            audience=None,
        )
    except ValueError as e:
        raise HTTPException(status_code=401, detail=f"ID token inválido: {e}")

    iss = payload.get("iss")
    if iss not in ("accounts.google.com", "https://accounts.google.com"):
        raise HTTPException(status_code=401, detail="Emisor inválido")

    aud = payload.get("aud")
    if aud not in ALLOWED_GOOGLE_AUDIENCES:
        raise HTTPException(status_code=401, detail="Audiencia no permitida")

    email = (payload.get("email") or "").lower().strip()
    if not email or not payload.get("email_verified", False):
        raise HTTPException(status_code=401, detail="Email no verificado por Google")
    name = payload.get("name") or email.split("@")[0]
    picture = payload.get("picture")
    sub = payload.get("sub")

    existing = await db.users.find_one({"email": email})
    if existing:
        user_id = existing["user_id"]
        updates: Dict[str, Any] = {
            "name": existing.get("name") or name,
            "picture": picture,
            "google_sub": sub,
            "is_admin": existing.get("is_admin", False) or (email == ADMIN_EMAIL),
            "provider": existing.get("provider") or "google",
        }
        await db.users.update_one({"user_id": user_id}, {"$set": updates})
    else:
        user_id = f"user_{uuid.uuid4().hex[:12]}"
        await db.users.insert_one({
            "user_id": user_id,
            "email": email,
            "name": name,
            "picture": picture,
            "google_sub": sub,
            "is_admin": email == ADMIN_EMAIL,
            "is_active": True,
            "total_points": 0,
            "correct_count": 0,
            "incorrect_count": 0,
            "created_at": now_utc(),
            "provider": "google",
        })

    user = await db.users.find_one({"user_id": user_id}, {"_id": 0})
    if not user.get("is_active", True):
        raise HTTPException(status_code=403, detail="Usuario desactivado")

    session_token = create_jwt(user_id, email, bool(user.get("is_admin")))
    expires_at = now_utc() + timedelta(days=JWT_EXPIRES_DAYS)
    await db.user_sessions.insert_one({
        "session_token": session_token,
        "user_id": user_id,
        "expires_at": expires_at,
        "created_at": now_utc(),
    })
    return {"session_token": session_token, "user": user_public(user)}


@api_router.get("/auth/me")
async def me(user=Depends(get_current_user)):
    return user_public(user)


@api_router.post("/auth/register")
async def register(body: RegisterBody, request: Request):
    email = body.email.lower().strip()
    ip = _client_ip(request)
    _rate_check(("register", ip), LOGIN_WINDOW_SEC, LOGIN_MAX_ATTEMPTS)

    existing = await db.users.find_one({"email": email})
    if existing:
        # If admin seed placeholder exists without provider set, allow linking? Only if no password yet and email matches.
        raise HTTPException(status_code=400, detail="El correo ya está registrado")

    user_id = f"user_{uuid.uuid4().hex[:12]}"
    await db.users.insert_one({
        "user_id": user_id,
        "email": email,
        "name": body.name.strip(),
        "picture": None,
        "is_admin": email == ADMIN_EMAIL,
        "is_active": True,
        "total_points": 0,
        "correct_count": 0,
        "incorrect_count": 0,
        "created_at": now_utc(),
        "provider": "local",
        "password_hash": hash_password(body.password),
    })

    user = await db.users.find_one({"user_id": user_id}, {"_id": 0})
    token = create_jwt(user_id, email, bool(user.get("is_admin")))
    expires_at = now_utc() + timedelta(days=JWT_EXPIRES_DAYS)
    await db.user_sessions.insert_one({
        "session_token": token,
        "user_id": user_id,
        "expires_at": expires_at,
        "created_at": now_utc(),
    })
    return {"session_token": token, "user": user_public(user)}


@api_router.post("/auth/login")
async def login(body: LoginBody, request: Request):
    email = body.email.lower().strip()
    ip = _client_ip(request)
    _rate_check((email, ip), LOGIN_WINDOW_SEC, LOGIN_MAX_ATTEMPTS)

    user = await db.users.find_one({"email": email})
    if not user or not user.get("password_hash"):
        raise HTTPException(status_code=400, detail="Credenciales inválidas")
    if not verify_password(body.password, user["password_hash"]):
        raise HTTPException(status_code=400, detail="Credenciales inválidas")
    if not user.get("is_active", True):
        raise HTTPException(status_code=403, detail="Usuario desactivado")

    token = create_jwt(user["user_id"], email, bool(user.get("is_admin")))
    expires_at = now_utc() + timedelta(days=JWT_EXPIRES_DAYS)
    await db.user_sessions.insert_one({
        "session_token": token,
        "user_id": user["user_id"],
        "expires_at": expires_at,
        "created_at": now_utc(),
    })
    return {"session_token": token, "user": user_public(user)}


@api_router.post("/auth/forgot-password")
async def forgot_password(body: ForgotPasswordBody, request: Request):
    email = body.email.lower().strip()
    ip = _client_ip(request)
    _rate_check(("forgot", ip), FORGOT_WINDOW_SEC, FORGOT_MAX_ATTEMPTS)

    generic = {"message": "Si el correo existe, recibirás un enlace de recuperación."}
    user = await db.users.find_one({"email": email})
    if not user or not user.get("password_hash"):
        # Do not reveal if it exists; also skip Google-only users
        return generic

    raw = secrets.token_urlsafe(24)
    token_hash = _hash_reset_token(raw)
    expires_at = now_utc() + timedelta(hours=1)
    await db.password_resets.insert_one({
        "token_hash": token_hash,
        "user_id": user["user_id"],
        "expires_at": expires_at,
        "used": False,
        "created_at": now_utc(),
    })
    await send_reset_email(email, user.get("name", ""), raw)
    return generic


@api_router.post("/auth/reset-password")
async def reset_password(body: ResetPasswordBody):
    token_hash = _hash_reset_token(body.token.strip())
    entry = await db.password_resets.find_one({"token_hash": token_hash})
    if not entry or entry.get("used"):
        raise HTTPException(status_code=400, detail="Código inválido o expirado")
    exp = entry.get("expires_at")
    if isinstance(exp, datetime) and exp.tzinfo is None:
        exp = exp.replace(tzinfo=timezone.utc)
    if not exp or exp < now_utc():
        raise HTTPException(status_code=400, detail="Código inválido o expirado")
    user = await db.users.find_one({"user_id": entry["user_id"]})
    if not user:
        raise HTTPException(status_code=400, detail="Código inválido o expirado")
    await db.users.update_one({"user_id": user["user_id"]}, {"$set": {"password_hash": hash_password(body.new_password)}})
    await db.password_resets.update_one({"_id": entry["_id"]}, {"$set": {"used": True, "used_at": now_utc()}})
    # Revoke existing sessions
    await db.user_sessions.delete_many({"user_id": user["user_id"]})
    return {"ok": True, "message": "Contraseña actualizada. Vuelve a iniciar sesión."}


@api_router.post("/auth/logout")
async def logout(user=Depends(get_current_user), authorization: Optional[str] = Header(None)):
    if authorization:
        token = authorization.split(" ", 1)[1].strip()
        await db.user_sessions.delete_one({"session_token": token})
    return {"ok": True}


# =========================
# Push
# =========================
@api_router.post("/register-push", status_code=201)
async def register_push(body: RegisterPushBody, user=Depends(get_current_user)):
    await db.push_tokens.update_one(
        {"user_id": user["user_id"], "device_token": body.device_token},
        {"$set": {
            "user_id": user["user_id"],
            "platform": body.platform,
            "device_token": body.device_token,
            "updated_at": now_utc(),
        }},
        upsert=True,
    )
    # Relay to Emergent Push
    try:
        resp = await push_client.post(
            "/api/v1/push/users/register",
            json={"user_id": user["user_id"], "platform": body.platform, "device_token": body.device_token},
        )
        if resp.status_code == 401:
            logger.warning("Push register: 401 (placeholder key expected in dev)")
        elif resp.status_code >= 400:
            logger.warning(f"Push register failed: {resp.status_code} {resp.text[:200]}")
    except Exception as e:
        logger.warning(f"Push register exception: {e}")
    return {"status": "registered"}


# =========================
# User: Questions & Answers
# =========================
@api_router.get("/questions/today")
async def get_today_questions(user=Depends(get_current_user)):
    today_str = date_only(now_utc())
    schedule = await db.daily_schedules.find_one({"date": today_str}, {"_id": 0})
    if not schedule or not schedule.get("question_ids"):
        return {"date": today_str, "questions": []}
    qids = schedule["question_ids"]
    questions = await db.questions.find({"question_id": {"$in": qids}, "active": True}, {"_id": 0}).to_list(100)
    # Preserve schedule order
    q_map = {q["question_id"]: q for q in questions}
    ordered = [q_map[qid] for qid in qids if qid in q_map]
    # Fetch answers
    answers = await db.answers.find({"user_id": user["user_id"], "question_id": {"$in": qids}}, {"_id": 0}).to_list(100)
    a_map = {a["question_id"]: a for a in answers}
    out = []
    for q in ordered:
        a = a_map.get(q["question_id"])
        out.append({
            "id": q["question_id"],
            "statement": q["statement"],
            "options": q["options"],
            "category": q.get("category", "General"),
            "already_answered": a is not None,
            "selected_index": a.get("selected_index") if a else None,
            "was_correct": a.get("correct") if a else None,
            "correct_index": q["correct_index"] if a else None,
        })
    return {"date": today_str, "questions": out}


@api_router.post("/answers", response_model=AnswerResult)
async def submit_answer(body: AnswerSubmit, user=Depends(get_current_user)):
    q = await db.questions.find_one({"question_id": body.question_id, "active": True}, {"_id": 0})
    if not q:
        raise HTTPException(status_code=404, detail="Question not found")
    # Must be in today's schedule
    today_str = date_only(now_utc())
    schedule = await db.daily_schedules.find_one({"date": today_str})
    if not schedule or body.question_id not in schedule.get("question_ids", []):
        raise HTTPException(status_code=400, detail="Question not scheduled for today")
    # Prevent duplicate
    existing = await db.answers.find_one({"user_id": user["user_id"], "question_id": body.question_id})
    if existing:
        raise HTTPException(status_code=400, detail="Already answered")
    if body.selected_index < 0 or body.selected_index > 3:
        raise HTTPException(status_code=400, detail="Invalid option")
    correct = body.selected_index == q["correct_index"]
    points = 1 if correct else 0
    await db.answers.insert_one({
        "answer_id": f"a_{uuid.uuid4().hex[:12]}",
        "user_id": user["user_id"],
        "question_id": body.question_id,
        "selected_index": body.selected_index,
        "correct": correct,
        "points": points,
        "answered_at": now_utc(),
    })
    inc = {"total_points": points, "correct_count": 1 if correct else 0, "incorrect_count": 0 if correct else 1}
    updated = await db.users.find_one_and_update(
        {"user_id": user["user_id"]},
        {"$inc": inc},
        return_document=True,
        projection={"_id": 0},
    )
    return AnswerResult(
        correct=correct,
        correct_index=q["correct_index"],
        points_awarded=points,
        total_points=int(updated.get("total_points", 0)),
    )


@api_router.get("/me/history")
async def get_history(user=Depends(get_current_user), limit: int = 50):
    answers = await db.answers.find({"user_id": user["user_id"]}, {"_id": 0}).sort("answered_at", -1).to_list(limit)
    if not answers:
        return {"history": []}
    qids = list({a["question_id"] for a in answers})
    questions = await db.questions.find({"question_id": {"$in": qids}}, {"_id": 0}).to_list(len(qids))
    q_map = {q["question_id"]: q for q in questions}
    out = []
    for a in answers:
        q = q_map.get(a["question_id"], {})
        out.append({
            "answer_id": a["answer_id"],
            "question_id": a["question_id"],
            "statement": q.get("statement", ""),
            "options": q.get("options", []),
            "category": q.get("category", ""),
            "selected_index": a["selected_index"],
            "correct_index": q.get("correct_index", -1),
            "correct": a["correct"],
            "points": a["points"],
            "answered_at": to_iso(a["answered_at"]) if isinstance(a["answered_at"], datetime) else a["answered_at"],
        })
    return {"history": out}


@api_router.get("/me/wins")
async def my_wins(user=Depends(get_current_user)):
    """Return raffles won by the current user, both unseen and seen."""
    rows = await db.raffles.find({"winner.user_id": user["user_id"]}, {"_id": 0}).sort("date", -1).to_list(100)
    out = []
    for r in rows:
        out.append({
            "raffle_id": r["raffle_id"],
            "prize_id": r["prize_id"],
            "prize_name": r["prize_name"],
            "prize_type": r["prize_type"],
            "date": to_iso(r["date"]) if isinstance(r.get("date"), datetime) else r.get("date"),
            "acknowledged": bool(r.get("acknowledged_by_winner", False)),
        })
    return {"wins": out}


class AckBody(BaseModel):
    raffle_id: str


@api_router.post("/me/wins/ack")
async def ack_win(body: AckBody, user=Depends(get_current_user)):
    res = await db.raffles.update_one(
        {"raffle_id": body.raffle_id, "winner.user_id": user["user_id"]},
        {"$set": {"acknowledged_by_winner": True, "acknowledged_at": now_utc()}},
    )
    if res.matched_count == 0:
        raise HTTPException(404, "Win not found")
    return {"ok": True}


# =========================
# Ranking
# =========================
@api_router.get("/ranking/weekly")
async def ranking_weekly():
    start, end = week_bounds()
    pipeline = [
        {"$match": {"answered_at": {"$gte": start, "$lt": end}, "correct": True}},
        {"$group": {"_id": "$user_id", "points": {"$sum": "$points"}}},
        {"$sort": {"points": -1}},
        {"$limit": 10},
    ]
    rows = await db.answers.aggregate(pipeline).to_list(50)
    user_ids = [r["_id"] for r in rows]
    users = await db.users.find({"user_id": {"$in": user_ids}}, {"_id": 0}).to_list(50)
    u_map = {u["user_id"]: u for u in users}
    result = []
    for i, r in enumerate(rows):
        u = u_map.get(r["_id"], {})
        result.append({
            "rank": i + 1,
            "user_id": r["_id"],
            "name": u.get("name", "Usuario"),
            "picture": u.get("picture"),
            "points": r["points"],
        })
    return {"week_start": to_iso(start), "week_end": to_iso(end), "top10": result}


# =========================
# Prizes
# =========================
@api_router.get("/prizes")
async def list_prizes(user=Depends(get_current_user)):
    prizes = await db.prizes.find({}, {"_id": 0, "image_data": 0}).sort("created_at", -1).to_list(100)
    for p in prizes:
        p["has_image"] = bool(p.pop("has_image_flag", p.get("has_image", False)))
        if "created_at" in p and isinstance(p["created_at"], datetime):
            p["created_at"] = to_iso(p["created_at"])
        if "draw_date" in p and isinstance(p.get("draw_date"), datetime):
            p["draw_date"] = to_iso(p["draw_date"])
    return {"prizes": prizes}


@api_router.get("/prizes/{prize_id}/image")
async def get_prize_image(prize_id: str):
    p = await db.prizes.find_one({"prize_id": prize_id})
    if not p or not p.get("image_data"):
        raise HTTPException(status_code=404, detail="Image not found")
    content_type = p.get("image_content_type", "image/jpeg")
    return FastAPIResponse(content=p["image_data"], media_type=content_type)


def _decode_base64_image(b64: str) -> bytes:
    if "," in b64 and b64.strip().startswith("data:"):
        b64 = b64.split(",", 1)[1]
    return base64.b64decode(b64)


# =========================
# Admin: Users
# =========================
@api_router.get("/admin/users")
async def admin_list_users(_admin=Depends(require_admin)):
    users = await db.users.find({}, {"_id": 0}).sort("created_at", -1).to_list(1000)
    for u in users:
        if isinstance(u.get("created_at"), datetime):
            u["created_at"] = to_iso(u["created_at"])
    return {"users": users}


@api_router.post("/admin/users/{user_id}/toggle-active")
async def admin_toggle_active(user_id: str, _admin=Depends(require_admin)):
    u = await db.users.find_one({"user_id": user_id})
    if not u:
        raise HTTPException(404, "User not found")
    if u.get("is_admin"):
        raise HTTPException(400, "Cannot deactivate admin")
    new_state = not bool(u.get("is_active", True))
    await db.users.update_one({"user_id": user_id}, {"$set": {"is_active": new_state}})
    return {"user_id": user_id, "is_active": new_state}


@api_router.delete("/admin/users/{user_id}")
async def admin_delete_user(user_id: str, _admin=Depends(require_admin)):
    u = await db.users.find_one({"user_id": user_id})
    if not u:
        raise HTTPException(404, "User not found")
    if u.get("is_admin"):
        raise HTTPException(400, "Cannot delete admin")
    await db.users.delete_one({"user_id": user_id})
    await db.user_sessions.delete_many({"user_id": user_id})
    return {"ok": True}


# =========================
# Admin: Questions
# =========================
@api_router.get("/admin/questions")
async def admin_list_questions(_admin=Depends(require_admin), category: Optional[str] = None, active: Optional[bool] = None):
    q: Dict[str, Any] = {}
    if category:
        q["category"] = category
    if active is not None:
        q["active"] = active
    docs = await db.questions.find(q, {"_id": 0}).sort("created_at", -1).to_list(1000)
    for d in docs:
        if isinstance(d.get("created_at"), datetime):
            d["created_at"] = to_iso(d["created_at"])
        d["id"] = d.pop("question_id")
    return {"questions": docs}


@api_router.post("/admin/questions")
async def admin_create_question(body: QuestionCreate, _admin=Depends(require_admin)):
    qid = f"q_{uuid.uuid4().hex[:12]}"
    await db.questions.insert_one({
        "question_id": qid,
        "statement": body.statement,
        "options": body.options,
        "correct_index": body.correct_index,
        "category": body.category,
        "active": body.active,
        "created_at": now_utc(),
    })
    return {"id": qid}


@api_router.put("/admin/questions/{qid}")
async def admin_update_question(qid: str, body: QuestionUpdate, _admin=Depends(require_admin)):
    update = {k: v for k, v in body.model_dump().items() if v is not None}
    if not update:
        return {"ok": True}
    res = await db.questions.update_one({"question_id": qid}, {"$set": update})
    if res.matched_count == 0:
        raise HTTPException(404, "Not found")
    return {"ok": True}


@api_router.delete("/admin/questions/{qid}")
async def admin_delete_question(qid: str, _admin=Depends(require_admin)):
    await db.questions.delete_one({"question_id": qid})
    return {"ok": True}


# =========================
# Admin: Daily Schedule
# =========================
@api_router.get("/admin/schedule/today")
async def admin_get_schedule(_admin=Depends(require_admin)):
    today_str = date_only(now_utc())
    schedule = await db.daily_schedules.find_one({"date": today_str}, {"_id": 0})
    return schedule or {"date": today_str, "question_ids": []}


@api_router.post("/admin/schedule")
async def admin_set_schedule(body: ScheduleDaily, _admin=Depends(require_admin)):
    date_str = body.date or date_only(now_utc())
    # Validate qids
    valid = await db.questions.find({"question_id": {"$in": body.question_ids}, "active": True}, {"_id": 0, "question_id": 1}).to_list(1000)
    valid_ids = {v["question_id"] for v in valid}
    ordered = [q for q in body.question_ids if q in valid_ids]
    if not ordered:
        raise HTTPException(400, "No valid active questions provided")
    await db.daily_schedules.update_one(
        {"date": date_str},
        {"$set": {"date": date_str, "question_ids": ordered, "published_at": now_utc()}},
        upsert=True,
    )
    # Trigger push to all active users
    users = await db.users.find({"is_active": True}, {"_id": 0, "user_id": 1}).to_list(10000)
    recipients = [u["user_id"] for u in users]
    try:
        await send_push(
            recipients,
            {"title": "¡Preguntas del día disponibles!", "message": f"Ya puedes responder {len(ordered)} preguntas y sumar puntos.", "action_url": "/(user)/home"},
            idempotency_key=f"daily-{date_str}",
        )
    except Exception as e:
        logger.warning(f"Push (schedule) failed: {e}")
    return {"date": date_str, "question_ids": ordered, "count": len(ordered)}


@api_router.get("/admin/settings")
async def admin_get_settings(_admin=Depends(require_admin)):
    s = await db.settings.find_one({"key": "main"}, {"_id": 0}) or {"daily_questions_count": 5}
    return s


@api_router.put("/admin/settings")
async def admin_update_settings(body: SettingsUpdate, _admin=Depends(require_admin)):
    update = {k: v for k, v in body.model_dump().items() if v is not None}
    if update:
        await db.settings.update_one({"key": "main"}, {"$set": update}, upsert=True)
    s = await db.settings.find_one({"key": "main"}, {"_id": 0})
    return s


# =========================
# Admin: Prizes
# =========================
@api_router.get("/admin/prizes")
async def admin_list_prizes(_admin=Depends(require_admin)):
    prizes = await db.prizes.find({}, {"_id": 0, "image_data": 0}).sort("created_at", -1).to_list(1000)
    for p in prizes:
        if isinstance(p.get("created_at"), datetime):
            p["created_at"] = to_iso(p["created_at"])
        if isinstance(p.get("draw_date"), datetime):
            p["draw_date"] = to_iso(p["draw_date"])
    return {"prizes": prizes}


@api_router.post("/admin/prizes")
async def admin_create_prize(body: PrizeCreate, _admin=Depends(require_admin)):
    if body.prize_type not in ("weekly", "active"):
        raise HTTPException(400, "prize_type must be 'weekly' or 'active'")
    pid = f"prize_{uuid.uuid4().hex[:12]}"
    doc: Dict[str, Any] = {
        "prize_id": pid,
        "name": body.name,
        "description": body.description or "",
        "prize_type": body.prize_type,
        "draw_date": body.draw_date,
        "has_image": False,
        "executed": False,
        "created_at": now_utc(),
    }
    if body.image_base64:
        try:
            image_bytes = _decode_base64_image(body.image_base64)
            doc["image_data"] = image_bytes
            doc["image_content_type"] = body.image_content_type or "image/jpeg"
            doc["has_image"] = True
        except Exception as e:
            raise HTTPException(400, f"Invalid image: {e}")
    await db.prizes.insert_one(doc)
    return {"id": pid, "has_image": doc["has_image"]}


@api_router.put("/admin/prizes/{pid}")
async def admin_update_prize(pid: str, body: PrizeUpdate, _admin=Depends(require_admin)):
    update: Dict[str, Any] = {}
    for k in ("name", "description", "draw_date"):
        v = getattr(body, k)
        if v is not None:
            update[k] = v
    if body.image_base64 is not None:
        try:
            image_bytes = _decode_base64_image(body.image_base64)
            update["image_data"] = image_bytes
            update["image_content_type"] = body.image_content_type or "image/jpeg"
            update["has_image"] = True
        except Exception as e:
            raise HTTPException(400, f"Invalid image: {e}")
    if update:
        res = await db.prizes.update_one({"prize_id": pid}, {"$set": update})
        if res.matched_count == 0:
            raise HTTPException(404, "Not found")
    return {"ok": True}


@api_router.delete("/admin/prizes/{pid}")
async def admin_delete_prize(pid: str, _admin=Depends(require_admin)):
    # Delete prize and its image (stored inline). Raffles are preserved.
    res = await db.prizes.delete_one({"prize_id": pid})
    if res.deleted_count == 0:
        raise HTTPException(404, "Not found")
    return {"ok": True}


# =========================
# Admin: Raffles
# =========================
@api_router.post("/admin/raffles/weekly", response_model=RaffleOut)
async def admin_execute_weekly(body: RaffleExecuteWeekly, _admin=Depends(require_admin)):
    prize = await db.prizes.find_one({"prize_id": body.prize_id, "prize_type": "weekly"})
    if not prize:
        raise HTTPException(404, "Weekly prize not found")
    if prize.get("executed"):
        raise HTTPException(400, "Prize already drawn")
    n = max(1, int(body.n))
    start, end = week_bounds()
    pipeline = [
        {"$match": {"answered_at": {"$gte": start, "$lt": end}, "correct": True}},
        {"$group": {"_id": "$user_id", "points": {"$sum": "$points"}}},
        {"$sort": {"points": -1}},
        {"$limit": n},
    ]
    rows = await db.answers.aggregate(pipeline).to_list(1000)
    if not rows:
        raise HTTPException(400, "No participants this week")
    ids = [r["_id"] for r in rows]
    users = await db.users.find({"user_id": {"$in": ids}, "is_active": True}, {"_id": 0}).to_list(1000)
    u_map = {u["user_id"]: u for u in users}
    participants = []
    for r in rows:
        u = u_map.get(r["_id"])
        if u:
            participants.append({"user_id": u["user_id"], "email": u["email"], "name": u["name"], "points": r["points"]})
    if not participants:
        raise HTTPException(400, "No eligible active participants")
    winner = random.choice(participants)
    raffle_id = f"raffle_{uuid.uuid4().hex[:12]}"
    doc = {
        "raffle_id": raffle_id,
        "prize_id": prize["prize_id"],
        "prize_name": prize["name"],
        "prize_type": "weekly",
        "date": now_utc(),
        "participants": participants,
        "winner": {"user_id": winner["user_id"], "email": winner["email"], "name": winner["name"]},
    }
    await db.raffles.insert_one(doc)
    await db.prizes.update_one({"prize_id": prize["prize_id"]}, {"$set": {"executed": True, "winner_user_id": winner["user_id"]}})

    # Targeted push to the winner
    try:
        await send_push(
            [winner["user_id"]],
            {"title": "🏆 ¡Ganaste el sorteo!", "message": f"Felicidades {winner['name']}, ganaste el premio '{prize['name']}'.", "action_url": "/(user)/prizes"},
            idempotency_key=f"winner-{raffle_id}",
        )
    except Exception as e:
        logger.warning(f"Push (winner) error: {e}")
    try:
        all_users = await db.users.find({"is_active": True}, {"_id": 0, "user_id": 1}).to_list(10000)
        await send_push(
            [u["user_id"] for u in all_users],
            {"title": "🏆 Sorteo semanal ejecutado", "message": f"El ganador del premio '{prize['name']}' es {winner['name']}", "action_url": "/(user)/prizes"},
            idempotency_key=f"raffle-{raffle_id}",
        )
    except Exception as e:
        logger.warning(f"Push (raffle) error: {e}")

    return RaffleOut(
        id=raffle_id, prize_id=prize["prize_id"], prize_name=prize["name"], prize_type="weekly",
        date=to_iso(doc["date"]), participants=participants, winner=doc["winner"],
    )


@api_router.post("/admin/raffles/active", response_model=RaffleOut)
async def admin_execute_active(body: RaffleExecuteActive, _admin=Depends(require_admin)):
    prize = await db.prizes.find_one({"prize_id": body.prize_id, "prize_type": "active"})
    if not prize:
        raise HTTPException(404, "Active prize not found")
    if prize.get("executed"):
        raise HTTPException(400, "Prize already drawn")
    end = now_utc()
    start = end - timedelta(days=7)
    if body.start_date:
        try:
            start = datetime.fromisoformat(body.start_date).replace(tzinfo=timezone.utc)
        except Exception:
            pass
    if body.end_date:
        try:
            end = datetime.fromisoformat(body.end_date).replace(tzinfo=timezone.utc)
        except Exception:
            pass
    # Active users: answered at least once in period
    ids = await db.answers.distinct("user_id", {"answered_at": {"$gte": start, "$lt": end}})
    if not ids:
        raise HTTPException(400, "No active users in period")
    users = await db.users.find({"user_id": {"$in": ids}, "is_active": True}, {"_id": 0}).to_list(10000)
    if not users:
        raise HTTPException(400, "No eligible active users")
    participants = [{"user_id": u["user_id"], "email": u["email"], "name": u["name"]} for u in users]
    winner = random.choice(participants)
    raffle_id = f"raffle_{uuid.uuid4().hex[:12]}"
    doc = {
        "raffle_id": raffle_id,
        "prize_id": prize["prize_id"],
        "prize_name": prize["name"],
        "prize_type": "active",
        "date": now_utc(),
        "period_start": start,
        "period_end": end,
        "participants": participants,
        "winner": winner,
    }
    await db.raffles.insert_one(doc)
    await db.prizes.update_one({"prize_id": prize["prize_id"]}, {"$set": {"executed": True, "winner_user_id": winner["user_id"]}})

    # Targeted push to winner
    try:
        await send_push(
            [winner["user_id"]],
            {"title": "🏆 ¡Ganaste el sorteo!", "message": f"Felicidades {winner['name']}, ganaste el premio '{prize['name']}'.", "action_url": "/(user)/prizes"},
            idempotency_key=f"winner-{raffle_id}",
        )
    except Exception as e:
        logger.warning(f"Push (winner active) error: {e}")
    try:
        all_users = await db.users.find({"is_active": True}, {"_id": 0, "user_id": 1}).to_list(10000)
        await send_push(
            [u["user_id"] for u in all_users],
            {"title": "🎉 Sorteo de usuarios activos", "message": f"Ganador de '{prize['name']}': {winner['name']}", "action_url": "/(user)/prizes"},
            idempotency_key=f"raffle-{raffle_id}",
        )
    except Exception as e:
        logger.warning(f"Push (raffle active) error: {e}")

    return RaffleOut(
        id=raffle_id, prize_id=prize["prize_id"], prize_name=prize["name"], prize_type="active",
        date=to_iso(doc["date"]), participants=participants, winner=winner,
    )


@api_router.get("/admin/raffles/history")
async def admin_raffles_history(_admin=Depends(require_admin)):
    raffles = await db.raffles.find({}, {"_id": 0}).sort("date", -1).to_list(500)
    for r in raffles:
        for k in ("date", "period_start", "period_end"):
            if isinstance(r.get(k), datetime):
                r[k] = to_iso(r[k])
    return {"raffles": raffles}


# =========================
# Admin: Stats & Send Notification
# =========================
@api_router.get("/admin/stats")
async def admin_stats(_admin=Depends(require_admin)):
    total_users = await db.users.count_documents({})
    active_users = await db.users.count_documents({"is_active": True})
    start, end = week_bounds()
    weekly_participants = len(await db.answers.distinct("user_id", {"answered_at": {"$gte": start, "$lt": end}}))
    answers_total = await db.answers.count_documents({})
    total_prizes = await db.prizes.count_documents({})
    executed_prizes = await db.prizes.count_documents({"executed": True})
    pending_prizes = total_prizes - executed_prizes
    # Ranking preview
    pipeline = [
        {"$match": {"answered_at": {"$gte": start, "$lt": end}, "correct": True}},
        {"$group": {"_id": "$user_id", "points": {"$sum": "$points"}}},
        {"$sort": {"points": -1}},
        {"$limit": 10},
    ]
    rows = await db.answers.aggregate(pipeline).to_list(50)
    ids = [r["_id"] for r in rows]
    users = await db.users.find({"user_id": {"$in": ids}}, {"_id": 0}).to_list(50)
    u_map = {u["user_id"]: u for u in users}
    top10 = []
    for i, r in enumerate(rows):
        u = u_map.get(r["_id"], {})
        top10.append({"rank": i + 1, "user_id": r["_id"], "name": u.get("name", "Usuario"), "points": r["points"]})
    upcoming = await db.prizes.find({"executed": False}, {"_id": 0, "image_data": 0}).sort("draw_date", 1).to_list(10)
    for p in upcoming:
        if isinstance(p.get("created_at"), datetime):
            p["created_at"] = to_iso(p["created_at"])
    return {
        "total_users": total_users,
        "active_users": active_users,
        "weekly_participants": weekly_participants,
        "answers_total": answers_total,
        "total_prizes": total_prizes,
        "executed_prizes": executed_prizes,
        "pending_prizes": pending_prizes,
        "top10": top10,
        "upcoming": upcoming,
    }


@api_router.post("/admin/send-notification")
async def admin_send_notification(body: SendNotificationBody, _admin=Depends(require_admin)):
    q: Dict[str, Any] = {"is_active": True}
    if body.audience == "active":
        start, _ = week_bounds()
        active_ids = await db.answers.distinct("user_id", {"answered_at": {"$gte": start}})
        q["user_id"] = {"$in": active_ids}
    users = await db.users.find(q, {"_id": 0, "user_id": 1}).to_list(10000)
    recipients = [u["user_id"] for u in users]
    try:
        await send_push(recipients, {"title": body.title, "message": body.message}, idempotency_key=f"manual-{uuid.uuid4().hex[:8]}")
    except Exception as e:
        logger.warning(f"Push (manual) error: {e}")
    return {"sent_to": len(recipients)}


# =========================
# Root & Mount
# =========================
@api_router.get("/")
async def root():
    return {"message": "Trivia GerabDevSoft API"}


@api_router.get("/status")
async def status_endpoint():
    """Estado público del servicio (idle o activo)."""
    idle = is_idle_now()
    now = _bolivia_now()
    return {
        "idle": idle,
        "server_time": now.isoformat(),
        "timezone": IDLE_TIMEZONE,
        "opens_at": f"{IDLE_END_HOUR:02d}:00",
        "closes_at": f"{IDLE_START_HOUR:02d}:00",
        "message": "Aplicación cerrada" if idle else "Aplicación activa",
    }


app.add_middleware(
    CORSMiddleware,
    allow_credentials=True,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)
api_router = APIRouter(prefix="/api")
app.include_router(api_router)
