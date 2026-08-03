# Test Credentials

## Admin (Email/Password + JWT)
- **Email**: admin@usfx.bo
- **Password**: 4dm1n
- Login endpoint: `POST /api/auth/login` with body `{"email":"admin@usfx.bo","password":"4dm1n"}`
- Returns: `{ session_token: <JWT>, user: {...is_admin:true} }`

## Admin (Google Sign-In)
- Cualquier cuenta Google con email `admin@usfx.bo` obtiene rol admin automáticamente al iniciar sesión con Google.
- Endpoint: `POST /api/auth/google` con `{"id_token": "<google_id_token>"}` (obtenido nativamente por `@react-native-google-signin/google-signin`).

## Regular users
- Register via `POST /api/auth/register` with `{"name":"...","email":"...","password":"..."}` (min 6 chars).
- Or Google Sign-In via `POST /api/auth/google` (obtain `id_token` en la app nativa).
- All users receive JWT `session_token` stored in Mongo `user_sessions` (7 days TTL).

## Auth endpoints
- `POST /api/auth/register` — new user con name/email/password
- `POST /api/auth/login` — email/password login → JWT
- `POST /api/auth/google` — verifica Google `id_token` (audience whitelist en env), retorna JWT
- `POST /api/auth/forgot-password` — envía token temporal por Resend
- `POST /api/auth/reset-password` — `{token, new_password}` (revoca todas las sesiones del user)
- `POST /api/auth/logout` — revoca la sesión actual (Bearer)
- `GET /api/auth/me` — usuario actual (requiere `Authorization: Bearer <JWT>`)

## Google OAuth Client IDs (env `/app/backend/.env`)
- `GOOGLE_WEB_CLIENT_ID=186316083710-9754lb9fg4r4dgpful5702qe3mmsmsti.apps.googleusercontent.com`
- `GOOGLE_ANDROID_CLIENT_ID=186316083710-5b9sc1nb7dmnqc5mc64f7j18tlejolrs.apps.googleusercontent.com`
- El backend acepta id_tokens con `aud` in {WEB, ANDROID} (iOS no configurado).

## Rate limiting
- Login/register: 5 attempts/60s por (email, X-Forwarded-For) — 429
- Forgot password: 5 requests/hora por IP — 429

## Emergent OAuth (REMOVED)
- El endpoint anterior `POST /api/auth/session` ya no existe (retorna 404). Se reemplazó por `/api/auth/google` con id_token directo de Google.

## Google Sign-In: entorno de ejecución
- **NO funciona** en Expo Go ni en el preview web (muestra un mensaje informativo al pulsar el botón).
- **SÍ funciona** en builds nativos generados con EAS (Emergent Publish) para Android/iOS.
- Requiere que en Google Cloud Console el SHA-1 del Client ID Android coincida con el keystore usado por EAS. Se obtiene con `eas credentials` luego del primer build.
