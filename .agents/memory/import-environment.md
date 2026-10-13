---
name: Import environment quirks
description: Non-obvious forwarding, certificate and helper-package behavior in this imported project.
---

Do not assume a validated replacement of the Replit port configuration updates
the live public forwarding map in this imported environment.

**Why:** The configuration file temporarily accepted a new map, but the public
domain still used the previous map. Workflow restarts restored the old entries.
The app could render through the workflow preview while the default public
domain reached a different server or returned 502.

**How to apply:** Verify an API response through the public development address,
not just the local server or preview screenshot. Avoid repeatedly replacing the
same configuration when the live mapping does not change; preserve a working
development route until the environment's forwarding can be updated reliably.

Use the system trust store for Python HTTPS checks in this environment.

**Why:** HTTPX's default certificate bundle rejected the development domain's
certificate, whereas the system CA bundle validated it successfully.

**How to apply:** Build an SSL context from the system CA bundle for development
checks. Do not disable TLS verification or change the application's TLS policy
to work around a test-environment trust issue.

The Replit web preview's browser origin may include `:5000`, even when the
forwarded request's `Host` header does not. Expo's development CORS checks can
reject same-preview API requests and the browser reports only “Failed to fetch.”

**Why:** Login's JSON and bearer-token requests trigger browser preflights. If
Expo rejects the preview origin, those requests fail before FastAPI can validate
the user's credentials, so changing a password cannot fix this symptom.

**How to apply:** Reproduce the browser's preflight with its exact preview
origin. In Replit development, allow only that current origin through Expo's
router CORS configuration; keep the exception disabled in native and other
environments, then verify login and authenticated requests through the preview.

Helper dependency installation can incorrectly scaffold an unrelated root Python
project and attempt to install into an immutable Nix runtime.

**Why:** A PDF-processing helper installation did both, despite the imported app
already having a working backend runtime. The helper failed; the app did not need
a new root entry point or replacement project configuration.

**How to apply:** Inspect the existing runtime and scaffold before installing
processing-only helpers. Prefer already available rendering tools for temporary
asset work, and check for unintended scaffold/configuration changes after an
installation failure.
