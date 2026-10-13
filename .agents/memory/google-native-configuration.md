---
name: Native Google configuration
description: Distinguish native Google OAuth configuration failures from registration validation.
---

Do not interpret native Google DEVELOPER_ERROR / code 10 as an incomplete
registration form, or claim that improving validation fixes native Google login.

**Why:** The SDK's official troubleshooting documentation identifies this as an
app/server configuration mismatch. The user reported it while omitting a faculty,
but form validation and native OAuth setup are separate problems.

**How to apply:** Ask where the failing installed build came from before changing
Google configuration. Check the actual application's package/signing certificate
against Android OAuth registration and ensure the SDK uses a web-type client ID.
Play distribution/internal sharing can use a different signing certificate.
Web or mocked-token tests do not verify Google authentication on that installed build.
