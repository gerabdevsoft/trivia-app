---
name: Import environment quirks
description: Non-obvious port-forwarding and certificate behavior observed during imported-project setup.
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
