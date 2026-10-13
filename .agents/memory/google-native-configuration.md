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

Esta app ya se distribuye en producción por Google Play.

**Why:** El usuario confirmó: «ya esta en produccion antes de los ultimos cambios».

**How to apply:** Distinguir la versión instalada desde la tienda del código del
workspace. No asumir que editar el proyecto actualiza las instalaciones existentes,
ni cambiar la identidad o las claves de firma de la app para resolver OAuth.

La configuración de acceso de Google para esta app se gestiona con Firebase y el usuario aporta `google-services.json`.

**Why:** El usuario aclaró que usa Firebase para el error de autenticación de Google.

**How to apply:** Revisar primero el proveedor Google, las huellas SHA-1 y los clientes OAuth del proyecto Firebase antes de sugerir cambios en la consola de Google Cloud.
