# Running the imported project on Replit

The original structure and stack are preserved: Expo SDK 54 / React Native in
`frontend/`, FastAPI in `backend/`, and MongoDB.

## Start

Click **Run**. The `Start application` workflow runs:

```sh
node scripts/replit-dev.cjs
```

This starts private local MongoDB on port 27017, FastAPI on port 8000, and
Expo Metro serving the web preview on `0.0.0.0:5000`. Replit-only Metro
middleware forwards `/api` to FastAPI. The environment retains a public
port-80 mapping to 8081, so the runner also relays 8081 to the same Expo server.
Port 5000 is the workflow preview target; both web addresses serve the same app.
Do not expose MongoDB or FastAPI directly. The script stops all services when
the workflow stops.
Replit development dynamically sets the Expo Router CORS origin for the
port-5000 preview; that allowance is not enabled in native builds or elsewhere.

## Dependencies

The Replit environment provides Node.js 20, Python 3.12, and MongoDB 7.
Install existing frontend dependencies with the checked-in npm lockfile:

```sh
cd frontend && npm ci
```

Install the backend's runtime-only dependency set:

```sh
python -m pip install -r backend/requirements-replit.txt
```

The original `backend/requirements.txt` remains unchanged. It includes a large
toolset beyond what this server imports. The frontend's `shell-quote` override
uses a patched version because the imported version was blocked by the package
security policy.

## Secrets and local database

Required Replit Secrets:

- `SESSION_SECRET`: used as the backend's JWT signing key by the development runner.
- `ADMIN_PASSWORD`: password chosen for the seeded administrator.

The local database is named `trivia_replit_dev`. Its files persist across workflow
restarts in `.local/dev-mongo/`, excluded from Git and deployment. This is a
development database, not a production database or a backup solution.

The backend seeds an administrator (`admin@usfx.bo`), eight sample questions,
and initial settings. Sign in using that email and the password entered in
Secrets, or create a regular user account. The administrator must schedule
questions before regular users will see a daily quiz.

Changing `ADMIN_PASSWORD` does not update an administrator password already
saved in MongoDB; the imported backend only sets the password on initial seeding.
Do not delete the database to reset a password without the user's approval.

## Existing behavior and limits

- The web frontend uses relative `/api` requests. Native builds still use
  `EXPO_PUBLIC_BACKEND_URL`.
- Google sign-in is native-build-only in the imported app; use email/password
  in the web preview.
- The app closes daily from 22:00 to 08:00 in `America/La_Paz`, as implemented
  in the imported backend. That behavior has not been changed.
- Email delivery and push services have not been configured. The existing
  backend's email mock path does not send password-reset emails.
- This local development setup is not ready for publishing. Production needs
  a managed MongoDB database, production secrets, and a production web build
  and serving configuration.
