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
from pymongo.errors import DuplicateKeyError
from pydantic import BaseModel, EmailStr, Field, field_validator, model_validator

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

FACULTIES = [
    "Derecho, Ciencias Políticas y Sociales",
    "Medicina",
    "Odontología",
    "Ciencias Químico - Farmacéuticas y Bioquímicas",
    "Contaduría Pública y Ciencias Financieras",
    "Ciencias Económicas y Empresariales",
    "Ciencias y Tecnología",
    "Ciencias Agrarias",
    "Humanidades y Ciencias de la Educación",
    "Técnica",
    "Ciencias de Enfermería y Obstetricia",
    "Ciencias y Tecnologías de la Salud",
    "Ingeniería y Ciencias Aplicadas Meca - Electrónicas",
    "Arquitectura y Ciencias del Hábitat",
    "Ingeniería Civil",
    "Integral Defensores del Chaco",
]
FACULTIES_SET = set(FACULTIES)

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

app.add_middleware(
    CORSMiddleware,
    allow_credentials=True,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

api_router = APIRouter(prefix="/api")

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


IDLE_ALLOWED_PATHS = {"/api/", "/api/status", "/api/faculties", "/docs", "/openapi.json", "/redoc"}


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
class RegistrationProfile(BaseModel):
    faculty: str = Field(..., min_length=2, max_length=120)
    ci: Optional[str] = Field(default=None, max_length=30)
    cu: Optional[str] = Field(default=None, max_length=30)

    @field_validator("faculty")
    @classmethod
    def _val_faculty(cls, v: str) -> str:
        v = v.strip()
        if v not in FACULTIES_SET:
            raise ValueError("Facultad no válida")
        return v

    @field_validator("ci", "cu", mode="before")
    @classmethod
    def _clean_doc(cls, v):
        if v is None:
            return None
        v = str(v).strip()
        return v or None

    @model_validator(mode="after")
    def _require_one_doc(self):
        if not self.ci and not self.cu:
            raise ValueError("Debes ingresar al menos un documento (CI o CU) para recoger premios")
        return self


class RegisterBody(RegistrationProfile):
    name: str = Field(..., min_length=2, max_length=80)
    email: EmailStr
    password: str = Field(..., min_length=6, max_length=128)

    @field_validator("name", mode="before")
    @classmethod
    def clean_name(cls, value):
        return value.strip() if isinstance(value, str) else value


class GoogleAuthBody(BaseModel):
    id_token: str
    profile: Optional[RegistrationProfile] = None


class UpdateProfileBody(BaseModel):
    faculty: Optional[str] = None
    ci: Optional[str] = Field(default=None, max_length=30)
    cu: Optional[str] = Field(default=None, max_length=30)

    @field_validator("faculty")
    @classmethod
    def _val_fac(cls, v):
        if v is None:
            return None
        v = v.strip()
        if v not in FACULTIES_SET:
            raise ValueError("Facultad no válida")
        return v

    @field_validator("ci", "cu", mode="before")
    @classmethod
    def _clean(cls, v):
        if v is None:
            return None
        v = str(v).strip()
        return v or None


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
    selected_index: Optional[int] = Field(default=None, ge=0, le=3)


class AnswerResult(BaseModel):
    correct: bool
    correct_index: int
    points_awarded: int
    total_points: int
    timed_out: bool = False
    selected_index: Optional[int] = None


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


class ScheduleDraft(BaseModel):
    selection_count: int = Field(..., ge=1, le=100)


class RegisterPushBody(BaseModel):
    platform: str  # "android" | "ios"
    device_token: str


class SendNotificationBody(BaseModel):
    title: str
    message: str
    audience: str = "all"  # "all" or "active"
    faculty: Optional[str] = None

    @field_validator("faculty")
    @classmethod
    def validate_faculty(cls, value: Optional[str]) -> Optional[str]:
        if value is not None and value not in FACULTIES_SET:
            raise ValueError("Facultad inválida")
        return value

    @field_validator("audience")
    @classmethod
    def validate_audience(cls, value: str) -> str:
        if value not in {"all", "active"}:
            raise ValueError("Audiencia inválida")
        return value


class PushReceiptBody(BaseModel):
    notification_id: str = Field(..., min_length=1, max_length=100)


class PushDispatchError(RuntimeError):
    def __init__(self, message: str, accepted_recipients: List[str]):
        super().__init__(message)
        self.accepted_recipients = accepted_recipients


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


async def send_push(recipients: List[str], data: dict, idempotency_key: Optional[str] = None) -> int:
    if not recipients:
        return 0
    if "title" not in data or "message" not in data:
        raise ValueError("data must include title and message")
    accepted_recipients: List[str] = []
    # The push relay accepts at most 100 recipients per request.
    for i in range(0, len(recipients), 100):
        chunk = recipients[i : i + 100]
        payload: dict = {"recipients": chunk, "data": data}
        if idempotency_key:
            payload["$idempotency_key"] = f"{idempotency_key}-{i}"
        try:
            resp = await push_client.post("/api/v1/push/trigger", json=payload)
            if resp.status_code >= 400:
                logger.error("Push trigger rejected a batch (HTTP %s)", resp.status_code)
                raise PushDispatchError("El servicio de notificaciones rechazó el envío", accepted_recipients)
            accepted_recipients.extend(chunk)
        except Exception as e:
            if isinstance(e, PushDispatchError):
                raise
            logger.exception("Push trigger request failed")
            raise PushDispatchError("No se pudo contactar al servicio de notificaciones", accepted_recipients) from e
    return len(accepted_recipients)


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
        "faculty": u.get("faculty"),
        "ci": u.get("ci"),
        "cu": u.get("cu"),
        "profile_complete": bool(u.get("faculty")) and bool(u.get("ci") or u.get("cu")),
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
    await db.question_attempts.create_index([("user_id", 1), ("question_id", 1)], unique=True)
    await db.question_attempts.create_index([("user_id", 1), ("status", 1), ("deadline_at", 1)])
    await db.answers.create_index("answered_at")
    await db.daily_schedules.create_index("date", unique=True)
    await db.prizes.create_index("prize_type")
    await db.password_resets.create_index("expires_at", expireAfterSeconds=0)
    await db.password_resets.create_index("token_hash", unique=True)

    # Device tokens are owned by the push relay. Remove data retained by older app versions.
    cleared_tokens = await db.push_tokens.delete_many({})
    if cleared_tokens.deleted_count:
        logger.info("Removed %s legacy locally stored push token(s)", cleared_tokens.deleted_count)

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
        if body.profile:
            updates.update(body.profile.model_dump())
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
            **(body.profile.model_dump() if body.profile else {}),
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
        "faculty": body.faculty,
        "ci": body.ci,
        "cu": body.cu,
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
    """Registers the native token with the push relay without persisting it in MongoDB."""
    try:
        resp = await push_client.post(
            "/api/v1/push/users/register",
            json={"user_id": user["user_id"], "platform": body.platform, "device_token": body.device_token},
        )
        if resp.status_code >= 400:
            logger.error("Push registration rejected (HTTP %s)", resp.status_code)
            raise HTTPException(status_code=502, detail="El servicio de notificaciones rechazó el registro del dispositivo")
    except Exception as e:
        if isinstance(e, HTTPException):
            raise
        logger.exception("Push registration request failed")
        raise HTTPException(status_code=502, detail="No se pudo contactar al servicio de notificaciones") from e
    return {"status": "registered"}


@api_router.post("/push/receipt")
async def record_push_receipt(body: PushReceiptBody, user=Depends(get_current_user)):
    """Record a device receipt only when the authenticated user was targeted."""
    delivery = await db.notification_deliveries.find_one({
        "notification_id": body.notification_id,
        "status": {"$in": ["accepted", "partially_accepted"]},
        "provider_accepted_recipients": user["user_id"],
    })
    if not delivery:
        raise HTTPException(status_code=404, detail="Notificación no encontrada para este usuario")
    already_received = user["user_id"] in delivery.get("received_user_ids", [])
    await db.notification_deliveries.update_one(
        {"notification_id": body.notification_id, "provider_accepted_recipients": user["user_id"]},
        {"$addToSet": {"received_user_ids": user["user_id"]}},
    )
    updated = await db.notification_deliveries.find_one(
        {"notification_id": body.notification_id},
        {"_id": 0, "received_user_ids": 1},
    )
    return {
        "received": True,
        "already_received": already_received,
        "received_count": len((updated or {}).get("received_user_ids", [])),
    }


# =========================
# User: Questions & Answers
# =========================
QUESTION_SECONDS = 10


async def answer_result_for_existing(answer: dict, correct_index: int) -> AnswerResult:
    user = await db.users.find_one({"user_id": answer["user_id"]}, {"total_points": 1})
    return AnswerResult(
        correct=answer["correct"],
        correct_index=correct_index,
        points_awarded=answer.get("points", 0),
        total_points=int((user or {}).get("total_points", 0)),
        timed_out=answer.get("timed_out", False),
        selected_index=answer.get("selected_index"),
    )


async def record_timed_answer(attempt: dict, selected_index: Optional[int]) -> AnswerResult:
    """Unique answer insertion makes expiration and answer retries idempotent."""
    uid, qid = attempt["user_id"], attempt["question_id"]
    existing = await db.answers.find_one({"user_id": uid, "question_id": qid})
    if existing:
        return await answer_result_for_existing(existing, attempt["correct_index"])
    deadline = attempt["deadline_at"]
    if deadline.tzinfo is None:
        deadline = deadline.replace(tzinfo=timezone.utc)
    timed_out = selected_index is None or now_utc() >= deadline
    selected_index = None if timed_out else selected_index
    correct = not timed_out and selected_index == attempt["correct_index"]
    points = 1 if correct else 0
    answer = {
        "answer_id": f"a_{uuid.uuid4().hex[:12]}",
        "user_id": uid,
        "question_id": qid,
        "selected_index": selected_index,
        "correct": correct,
        "points": points,
        "timed_out": timed_out,
        "answered_at": now_utc(),
    }
    try:
        await db.answers.insert_one(answer)
    except DuplicateKeyError:
        existing = await db.answers.find_one({"user_id": uid, "question_id": qid})
        return await answer_result_for_existing(existing, attempt["correct_index"])
    updated = await db.users.find_one_and_update(
        {"user_id": uid},
        {"$inc": {"total_points": points, "correct_count": 1 if correct else 0, "incorrect_count": 0 if correct else 1}},
        return_document=True,
        projection={"_id": 0},
    )
    await db.question_attempts.update_one(
        {"user_id": uid, "question_id": qid},
        {"$set": {"status": "answered"}},
    )
    return AnswerResult(
        correct=correct, correct_index=attempt["correct_index"], points_awarded=points,
        total_points=int((updated or {}).get("total_points", 0)),
        timed_out=timed_out, selected_index=selected_index,
    )


async def expire_question_attempts(user_id: str) -> None:
    attempts = await db.question_attempts.find({
        "user_id": user_id, "status": "active", "deadline_at": {"$lte": now_utc()},
    }, {"_id": 0}).to_list(100)
    for attempt in attempts:
        await record_timed_answer(attempt, None)
        await db.question_attempts.update_one(
            {"user_id": user_id, "question_id": attempt["question_id"]},
            {"$set": {"status": "answered"}},
        )


@api_router.post("/questions/{question_id}/start")
async def start_question(question_id: str, user=Depends(get_current_user)):
    await expire_question_attempts(user["user_id"])
    today_str = date_only(now_utc())
    schedule = await db.daily_schedules.find_one({"date": today_str})
    qids = (schedule or {}).get("question_ids", [])
    if question_id not in qids:
        raise HTTPException(status_code=400, detail="Pregunta no programada para hoy")
    question = await db.questions.find_one({"question_id": question_id, "active": True}, {"_id": 0})
    if not question:
        raise HTTPException(status_code=404, detail="Pregunta no disponible")
    attempt = await db.question_attempts.find_one({"user_id": user["user_id"], "question_id": question_id}, {"_id": 0})
    existing = await db.answers.find_one({"user_id": user["user_id"], "question_id": question_id})
    if existing:
        result = await answer_result_for_existing(existing, (attempt or question)["correct_index"])
        return {"already_answered": True, "answer": result.model_dump(), "server_now": to_iso(now_utc())}
    active_questions = await db.questions.find({"question_id": {"$in": qids}, "active": True}, {"question_id": 1}).to_list(100)
    active_ids = {q["question_id"] for q in active_questions}
    answered_ids = set(await db.answers.distinct("question_id", {"user_id": user["user_id"], "question_id": {"$in": qids}}))
    next_id = next((qid for qid in qids if qid in active_ids and qid not in answered_ids), None)
    if next_id != question_id:
        raise HTTPException(status_code=409, detail="Responde primero la pregunta anterior")
    if not attempt:
        started_at = now_utc()
        attempt = {
            "user_id": user["user_id"], "question_id": question_id, "quiz_date": today_str,
            "started_at": started_at, "deadline_at": started_at + timedelta(seconds=QUESTION_SECONDS),
            "correct_index": question["correct_index"], "status": "active",
        }
        try:
            await db.question_attempts.insert_one(attempt)
        except DuplicateKeyError:
            attempt = await db.question_attempts.find_one({"user_id": user["user_id"], "question_id": question_id}, {"_id": 0})
    return {
        "already_answered": False, "question_id": question_id,
        "deadline_at": to_iso(attempt["deadline_at"]), "server_now": to_iso(now_utc()),
    }


@api_router.get("/questions/today")
async def get_today_questions(user=Depends(get_current_user)):
    await expire_question_attempts(user["user_id"])
    today_str = date_only(now_utc())
    schedule = await db.daily_schedules.find_one({"date": today_str}, {"_id": 0})
    if not schedule or not schedule.get("question_ids"):
        return {"date": today_str, "questions": [], "server_now": to_iso(now_utc())}
    qids = schedule["question_ids"]
    questions = await db.questions.find({"question_id": {"$in": qids}, "active": True}, {"_id": 0}).to_list(100)
    # Preserve schedule order
    q_map = {q["question_id"]: q for q in questions}
    ordered = [q_map[qid] for qid in qids if qid in q_map]
    # Fetch answers
    answers = await db.answers.find({"user_id": user["user_id"], "question_id": {"$in": qids}}, {"_id": 0}).to_list(100)
    a_map = {a["question_id"]: a for a in answers}
    attempts = await db.question_attempts.find({"user_id": user["user_id"], "question_id": {"$in": qids}}, {"_id": 0}).to_list(100)
    attempt_map = {a["question_id"]: a for a in attempts}
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
            "timed_out": a.get("timed_out", False) if a else False,
            "deadline_at": to_iso(attempt_map[q["question_id"]]["deadline_at"]) if q["question_id"] in attempt_map else None,
        })
    return {"date": today_str, "questions": out, "server_now": to_iso(now_utc())}


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
    attempt = await db.question_attempts.find_one({"user_id": user["user_id"], "question_id": body.question_id}, {"_id": 0})
    if not attempt:
        raise HTTPException(status_code=409, detail="Inicia la pregunta antes de responder")
    return await record_timed_answer(attempt, body.selected_index)


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
    if schedule and isinstance(schedule.get("published_at"), datetime):
        schedule["published_at"] = to_iso(schedule["published_at"])
    return schedule or {"date": today_str, "question_ids": []}


@api_router.get("/admin/schedule/history")
async def admin_schedule_history(_admin=Depends(require_admin)):
    schedules = await db.daily_schedules.find({"published_at": {"$exists": True}}, {"_id": 0}).to_list(500)
    all_qids: set = set()
    for s in schedules:
        for qid in s.get("question_ids", []):
            all_qids.add(qid)
    questions = []
    if all_qids:
        questions = await db.questions.find({"question_id": {"$in": list(all_qids)}}, {"_id": 0}).to_list(len(all_qids))
    q_map: Dict[str, Any] = {}
    for q in questions:
        if isinstance(q.get("created_at"), datetime):
            q["created_at"] = to_iso(q["created_at"])
        qid = q.get("question_id")
        q["id"] = qid
        if qid:
            q_map[qid] = q
    weekday_names = ["Lunes", "Martes", "Miércoles", "Jueves", "Viernes", "Sábado", "Domingo"]
    out = []
    for s in schedules:
        try:
            d = datetime.strptime(s["date"], "%Y-%m-%d")
        except Exception:
            continue
        weekday = d.weekday()
        qs = [dict(q_map[qid]) for qid in s.get("question_ids", []) if qid in q_map]
        published_at = s.get("published_at")
        if isinstance(published_at, datetime):
            published_at = to_iso(published_at)
        out.append({
            "date": s["date"],
            "weekday": weekday,
            "weekday_name": weekday_names[weekday],
            "published_at": published_at,
            "count": len(qs),
            "questions": qs,
        })
    out.sort(key=lambda x: x["date"], reverse=True)
    return {"schedules": out}


@api_router.post("/admin/schedule/draft")
async def admin_lock_schedule_count(body: ScheduleDraft, _admin=Depends(require_admin)):
    """Locks today's question count before the admin selects the questions to publish."""
    date_str = date_only(now_utc())
    existing = await db.daily_schedules.find_one({"date": date_str}, {"_id": 0})
    if existing and existing.get("published_at"):
        raise HTTPException(400, "Las preguntas de hoy ya fueron publicadas")
    if existing and existing.get("selection_count"):
        raise HTTPException(400, "La cantidad de preguntas para hoy ya está bloqueada")

    await db.daily_schedules.update_one(
        {"date": date_str},
        {
            "$set": {
                "date": date_str,
                "selection_count": body.selection_count,
                "selection_locked_at": now_utc(),
            },
            "$setOnInsert": {"question_ids": []},
        },
        upsert=True,
    )
    await db.settings.update_one(
        {"key": "main"},
        {"$set": {"daily_questions_count": body.selection_count}},
        upsert=True,
    )
    return {"date": date_str, "question_ids": [], "selection_count": body.selection_count}


@api_router.post("/admin/schedule")
async def admin_set_schedule(body: ScheduleDaily, _admin=Depends(require_admin)):
    date_str = body.date or date_only(now_utc())
    draft = await db.daily_schedules.find_one({"date": date_str}, {"_id": 0})
    if draft and draft.get("published_at"):
        raise HTTPException(400, "Las preguntas de este día ya fueron publicadas")
    expected_count = int((draft or {}).get("selection_count") or len(body.question_ids))
    if len(body.question_ids) != expected_count:
        raise HTTPException(400, f"Debes seleccionar exactamente {expected_count} preguntas")
    # Validate: must be active AND not previously used in any schedule
    valid = await db.questions.find(
        {"question_id": {"$in": body.question_ids}, "active": True},
        {"_id": 0, "question_id": 1, "used_in_schedule": 1, "statement": 1},
    ).to_list(1000)
    valid_map = {v["question_id"]: v for v in valid}
    already_used = [v["statement"] for v in valid if v.get("used_in_schedule")]
    if already_used:
        raise HTTPException(
            status_code=400,
            detail=f"Estas preguntas ya fueron usadas en un día previo y no pueden reutilizarse: {'; '.join(already_used[:3])}",
        )
    ordered = [q for q in body.question_ids if q in valid_map]
    if not ordered:
        raise HTTPException(400, "No valid active questions provided")
    # Mark them as used so they cannot be scheduled again
    await db.questions.update_many(
        {"question_id": {"$in": ordered}},
        {"$set": {"used_in_schedule": True, "used_in_date": date_str}},
    )
    await db.daily_schedules.update_one(
        {"date": date_str},
        {"$set": {"date": date_str, "question_ids": ordered, "selection_count": expected_count, "published_at": now_utc()}},
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
    if body.faculty:
        q["faculty"] = body.faculty
    users = await db.users.find(q, {"_id": 0, "user_id": 1}).to_list(10000)
    recipients = [u["user_id"] for u in users]
    notification_id = f"notification-{uuid.uuid4().hex}"
    delivery = {
        "notification_id": notification_id,
        "title": body.title,
        "message": body.message,
        "faculty": body.faculty,
        "recipients": recipients,
        "received_user_ids": [],
        "status": "sending",
        "created_at": now_utc(),
    }
    await db.notification_deliveries.insert_one(delivery)
    try:
        accepted = await send_push(
            recipients,
            {"title": body.title, "message": body.message, "notification_id": notification_id},
            idempotency_key=notification_id,
        )
    except PushDispatchError as exc:
        await db.notification_deliveries.update_one(
            {"notification_id": notification_id},
            {"$set": {
                "status": "partially_accepted" if exc.accepted_recipients else "failed",
                "provider_accepted_recipients": exc.accepted_recipients,
                "accepted_count": len(exc.accepted_recipients),
            }},
        )
        raise HTTPException(status_code=502, detail=str(exc)) from exc
    await db.notification_deliveries.update_one(
        {"notification_id": notification_id},
        {"$set": {
            "status": "accepted",
            "accepted_count": accepted,
            "provider_accepted_recipients": recipients,
        }},
    )
    return {
        "sent_to": accepted,
        "targeted_users": len(recipients),
        "accepted_by_provider": accepted,
        "faculty": body.faculty,
        "notification_id": notification_id,
    }


@api_router.get("/admin/notifications/{notification_id}")
async def admin_notification_status(notification_id: str, _admin=Depends(require_admin)):
    delivery = await db.notification_deliveries.find_one(
        {"notification_id": notification_id},
        {"_id": 0, "notification_id": 1, "faculty": 1, "status": 1, "recipients": 1,
         "received_user_ids": 1, "accepted_count": 1, "created_at": 1},
    )
    if not delivery:
        raise HTTPException(status_code=404, detail="Notificación no encontrada")
    return {
        "notification_id": delivery["notification_id"],
        "faculty": delivery.get("faculty"),
        "status": delivery["status"],
        "targeted_users": len(delivery.get("recipients", [])),
        "accepted_by_provider": delivery.get("accepted_count", 0),
        "received_count": len(delivery.get("received_user_ids", [])),
        "created_at": to_iso(delivery["created_at"]),
    }


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


@api_router.get("/faculties")
async def list_faculties():
    return {"faculties": FACULTIES}


@api_router.put("/me/profile")
async def update_profile(body: UpdateProfileBody, user=Depends(get_current_user)):
    update: Dict[str, Any] = {}
    for k in ("faculty", "ci", "cu"):
        v = getattr(body, k)
        if v is not None:
            update[k] = v
    # Validate: at least one doc must remain
    final_ci = update.get("ci", user.get("ci"))
    final_cu = update.get("cu", user.get("cu"))
    if not final_ci and not final_cu:
        raise HTTPException(status_code=400, detail="Debes tener al menos un documento (CI o CU)")
    if update:
        await db.users.update_one({"user_id": user["user_id"]}, {"$set": update})
    fresh = await db.users.find_one({"user_id": user["user_id"]}, {"_id": 0})
    return user_public(fresh)


app.include_router(api_router)

