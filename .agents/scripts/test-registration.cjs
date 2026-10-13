// Browser-only API mocks: this test cannot create or change real accounts.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const WebSocket = require("../../frontend/node_modules/ws");
const origin = `https://${process.env.REPLIT_DEV_DOMAIN}`;
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

(async () => {
  const target = await (await fetch("http://127.0.0.1:9222/json/new?about:blank", { method: "PUT" })).json();
  const socket = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((resolve) => socket.once("open", resolve));
  let id = 0, registerCalls = 0, googleCalls = 0;
  const pending = new Map();
  const send = (method, params = {}) => new Promise((resolve, reject) => {
    const key = ++id;
    pending.set(key, { resolve, reject });
    socket.send(JSON.stringify({ id: key, method, params }));
  });
  socket.on("message", async (raw) => {
    const message = JSON.parse(raw);
    if (message.id) {
      const promise = pending.get(message.id);
      pending.delete(message.id);
      if (message.error) promise.reject(new Error(JSON.stringify(message.error)));
      else promise.resolve(message.result);
    } else if (message.method === "Fetch.requestPaused") {
      const { requestId, request } = message.params;
      const pathname = new URL(request.url).pathname;
      let body = {}, responseCode = 200;
      if (pathname === "/api/status") body = { idle: false };
      if (pathname === "/api/auth/me") { body = { detail: "No autenticado" }; responseCode = 401; }
      if (pathname === "/api/faculties") body = { faculties: ["Facultad de prueba"] };
      if (pathname === "/api/auth/google") googleCalls++;
      if (pathname === "/api/auth/register") {
        registerCalls++;
        const payload = JSON.parse(request.postData);
        assert.equal(payload.faculty, "Facultad de prueba");
        assert.equal(payload.ci, "123456");
        responseCode = registerCalls === 1 ? 400 : 422;
        body = registerCalls === 1 ? { detail: "El correo ya está registrado" } :
          { detail: [{ loc: ["body", "faculty"], type: "value_error", msg: "Value error, Facultad no válida" }] };
      }
      await send("Fetch.fulfillRequest", {
        requestId, responseCode, responseHeaders: [{ name: "Content-Type", value: "application/json" }],
        body: Buffer.from(JSON.stringify(body)).toString("base64"),
      });
    }
  });
  async function evaluate(expression) {
    const result = await send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
    if (result.exceptionDetails) throw new Error(result.exceptionDetails.text);
    return result.result.value;
  }
  async function waitFor(expression) {
    const end = Date.now() + 30000;
    while (Date.now() < end) {
      if (await evaluate(expression)) return;
      await delay(150);
    }
    throw new Error(`Timed out: ${expression}`);
  }
  const selector = (testId) => `[data-testid="${testId}"]`;
  const click = (testId) => evaluate(`document.querySelector(${JSON.stringify(selector(testId))}).click()`);
  const fill = (testId, value) => evaluate(`(() => { const input = document.querySelector(${JSON.stringify(selector(testId))}); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set.call(input, ${JSON.stringify(value)}); input.dispatchEvent(new Event("input", { bubbles: true })); })()`);
  const errorContains = (text) => waitFor(`document.querySelector('[data-testid="login-error"]')?.innerText.toLowerCase().includes(${JSON.stringify(text)})`);
  try {
    await send("Page.enable");
    await send("Runtime.enable");
    await send("Fetch.enable", { patterns: [{ urlPattern: "*/api/*" }] });
    await send("Storage.clearDataForOrigin", { origin, storageTypes: "local_storage,indexeddb" });
    await send("Emulation.setDeviceMetricsOverride", { width: 402, height: 874, deviceScaleFactor: 1, mobile: true });
    await send("Page.navigate", { url: `${origin}/login` });
    await waitFor("!!document.querySelector('[data-testid=\"tab-register\"]')");
    await click("tab-register");
    await click("submit-button");
    await errorContains("nombre");
    await fill("name-input", "Persona de prueba");
    await fill("email-input", "mal-correo");
    await click("submit-button");
    await errorContains("correo");
    await fill("email-input", "example@example.com");
    await fill("password-input", "123");
    await click("submit-button");
    await errorContains("6 caracteres");
    await fill("password-input", "test-password");
    await click("submit-button");
    await errorContains("facultad");
    await click("google-signin-button");
    await errorContains("facultad");
    assert.equal(registerCalls, 0);
    assert.equal(googleCalls, 0);
    await evaluate("document.querySelector('[data-testid=\"login-error\"]').scrollIntoView({block: 'center'})");
    await delay(500);
    const screenshot = await send("Page.captureScreenshot", { format: "png" });
    fs.mkdirSync("generated-artifacts/registration", { recursive: true });
    fs.writeFileSync("generated-artifacts/registration/missing-faculty.png", Buffer.from(screenshot.data, "base64"));
    await click("faculty-select");
    await waitFor("!!document.querySelector('[data-testid=\"faculty-option-Facultad de prueba\"]')");
    await click("faculty-option-Facultad de prueba");
    await click("submit-button");
    await errorContains("documento");
    await click("google-signin-button");
    await errorContains("documento");
    await fill("ci-input", " 123456 ");
    await click("submit-button");
    await errorContains("ya está registrado");
    assert.equal(registerCalls, 1);
    await click("submit-button");
    await errorContains("facultad válida");
    assert.equal(registerCalls, 2);
    await click("google-signin-button");
    await waitFor("document.querySelector('[data-testid=\"login-info\"]')?.innerText.includes('En web usa correo y contraseña')");
    assert.equal(googleCalls, 0);
    console.log("PASS: missing name/email/password/faculty/documents, Google prevalidation, valid trimmed submission, readable 422 errors and safe web Google handling.");
  } finally {
    await send("Page.close").catch(() => {});
    socket.close();
  }
})().catch((error) => { console.error(error); process.exitCode = 1; });
