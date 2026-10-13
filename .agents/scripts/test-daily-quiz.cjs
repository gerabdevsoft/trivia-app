// Isolated browser verification: intercepted API requests never touch real users/data.
const fs = require("node:fs");
const path = require("node:path");
const assert = require("node:assert/strict");
const WebSocket = require("../../frontend/node_modules/ws");

const origin = `https://${process.env.REPLIT_DEV_DOMAIN}`;
const out = path.resolve("generated-artifacts/quiz-ui");
fs.mkdirSync(out, { recursive: true });
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const date = new Date().toISOString().slice(0, 10);
const user = { user_id: "isolated-browser-quiz-user", name: "Usuario de prueba", is_admin: false, is_active: true, total_points: 0, correct_count: 0, incorrect_count: 0 };
const questions = [
  { id: "ui-q1", statement: "¿Cuál es la capital constitucional de Bolivia?", options: ["La Paz", "Sucre", "Cochabamba", "Santa Cruz"], category: "Historia", already_answered: false, selected_index: null, was_correct: null, correct_index: null, timed_out: false },
  { id: "ui-q2", statement: "¿En qué departamento se encuentra Sucre?", options: ["Oruro", "Chuquisaca", "Potosí", "Beni"], category: "Geografía", already_answered: false, selected_index: null, was_correct: null, correct_index: null, timed_out: false },
];
const deadlines = new Map();
const answers = new Map();

function grade(qid, selection) {
  if (answers.has(qid)) return answers.get(qid);
  const expired = selection === null || Date.now() >= deadlines.get(qid);
  const correct = !expired && selection === 1;
  user.total_points += correct ? 1 : 0;
  user.correct_count += correct ? 1 : 0;
  user.incorrect_count += correct ? 0 : 1;
  const result = { correct, correct_index: 1, points_awarded: correct ? 1 : 0, total_points: user.total_points, timed_out: expired, selected_index: expired ? null : selection };
  answers.set(qid, result);
  Object.assign(questions.find((q) => q.id === qid), {
    already_answered: true, selected_index: result.selected_index,
    was_correct: result.correct, correct_index: 1, timed_out: result.timed_out,
  });
  return result;
}

function mock(request) {
  const pathname = new URL(request.url).pathname;
  if (pathname === "/api/status") return { idle: false, server_time: new Date().toISOString(), timezone: "America/La_Paz", opens_at: "08:00", closes_at: "22:00" };
  if (pathname === "/api/auth/me") return user;
  if (pathname === "/api/me/wins") return { wins: [] };
  if (pathname === "/api/questions/today") {
    for (const [qid, deadline] of deadlines) if (Date.now() >= deadline && !answers.has(qid)) grade(qid, null);
    return { date, server_now: new Date().toISOString(), questions };
  }
  if (pathname.endsWith("/start")) {
    const qid = pathname.split("/")[3];
    if (answers.has(qid)) return { already_answered: true, answer: answers.get(qid), server_now: new Date().toISOString() };
    if (!deadlines.has(qid)) deadlines.set(qid, Date.now() + 10000);
    const end = new Date(deadlines.get(qid)).toISOString();
    questions.find((q) => q.id === qid).deadline_at = end;
    return { already_answered: false, question_id: qid, deadline_at: end, server_now: new Date().toISOString() };
  }
  if (pathname === "/api/answers") {
    const body = JSON.parse(request.postData);
    return grade(body.question_id, body.selected_index);
  }
  return {};
}

(async () => {
  const target = await (await fetch("http://127.0.0.1:9222/json/new?about:blank", { method: "PUT" })).json();
  const socket = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((resolve) => socket.once("open", resolve));
  let nextId = 1;
  const pending = new Map();
  function send(method, params = {}) {
    return new Promise((resolve, reject) => {
      const id = nextId++;
      pending.set(id, { resolve, reject });
      socket.send(JSON.stringify({ id, method, params }));
    });
  }
  socket.on("message", async (raw) => {
    const message = JSON.parse(raw);
    if (message.id) {
      const promise = pending.get(message.id);
      if (!promise) return;
      pending.delete(message.id);
      if (message.error) promise.reject(new Error(JSON.stringify(message.error)));
      else promise.resolve(message.result);
    } else if (message.method === "Fetch.requestPaused") {
      const { requestId, request } = message.params;
      try {
        const result = mock(request);
        await send("Fetch.fulfillRequest", {
          requestId, responseCode: 200,
          responseHeaders: [{ name: "Content-Type", value: "application/json" }],
          body: Buffer.from(JSON.stringify(result)).toString("base64"),
        });
      } catch (error) {
        console.error("Mock failure:", error.message);
        await send("Fetch.failRequest", { requestId, errorReason: "Failed" });
      }
    }
  });
  async function evaluate(expression) {
    const result = await send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
    if (result.exceptionDetails) throw new Error(result.exceptionDetails.text);
    return result.result.value;
  }
  async function waitFor(expression, timeout = 30000) {
    const end = Date.now() + timeout;
    while (Date.now() < end) {
      if (await evaluate(expression)) return;
      await delay(150);
    }
    throw new Error(`Timed out: ${expression}`);
  }
  const testSelector = (id) => `[data-testid="${id}"]`;
  const click = (id) => evaluate(`document.querySelector(${JSON.stringify(testSelector(id))}).click()`);
  async function screenshot(filename) {
    // Wait for slide animations and asset painting, not just DOM insertion.
    await delay(500);
    const result = await send("Page.captureScreenshot", { format: "png", captureBeyondViewport: false });
    fs.writeFileSync(path.join(out, filename), Buffer.from(result.data, "base64"));
  }
  try {
    await send("Page.enable");
    await send("Runtime.enable");
    await send("Storage.clearDataForOrigin", { origin, storageTypes: "local_storage,indexeddb" });
    await send("Fetch.enable", { patterns: [{ urlPattern: "*/api/*" }] });
    await send("Emulation.setDeviceMetricsOverride", { width: 402, height: 874, deviceScaleFactor: 1, mobile: true });
    await send("Page.navigate", { url: origin });
    await waitFor(`!!document.querySelector('${testSelector("start-daily-quiz")}')`);
    await waitFor(`document.querySelector('${testSelector("start-daily-quiz")}').getAttribute('aria-disabled') !== 'true'`);
    assert.equal(await evaluate("document.body.innerText.toLowerCase().replace(/\\s+/g, ' ').includes('compromisos para una universidad mejor')"), true);
    await screenshot("home-mobile.png");
    await click("start-daily-quiz");
    await waitFor(`!!document.querySelector('${testSelector("option-ui-q1-1")}')`);
    assert.equal(await evaluate(`!!document.querySelector('${testSelector("option-ui-q2-1")}')`), false);
    await screenshot("question-mobile.png");
    await click("option-ui-q1-1");
    await waitFor(`!!document.querySelector('${testSelector("question-result")}')`);
    assert.equal(user.total_points, 1);
    await click("next-question");
    await waitFor(`!!document.querySelector('${testSelector("option-ui-q2-1")}')`);
    await evaluate(`window.clockChanges = []; window.clockText = document.querySelector('${testSelector("question-countdown")}').innerText; new MutationObserver(() => { const text = document.querySelector('${testSelector("question-countdown")}')?.innerText; if (text && text !== window.clockText) { window.clockText = text; window.clockChanges.push(Date.now()); } }).observe(document.querySelector('${testSelector("question-countdown")}'), {subtree:true, childList:true, characterData:true});`);
    await delay(2300);
    const changes = await evaluate("window.clockChanges");
    assert.ok(changes.length <= 3, "Clock should not update more than once per second");
    for (let i = 1; i < changes.length; i++) assert.ok(changes[i] - changes[i - 1] >= 900);
    const originalDeadline = deadlines.get("ui-q2");
    await send("Page.navigate", { url: "about:blank" });
    await delay(10500);
    await send("Page.navigate", { url: origin });
    await waitFor(`!!document.querySelector('${testSelector("question-timeout")}')`);
    assert.equal(deadlines.get("ui-q2"), originalDeadline);
    assert.equal(user.incorrect_count, 1);
    assert.equal(user.total_points, 1);
    await screenshot("restored-timeout-mobile.png");
    await click("next-question");
    await waitFor(`!!document.querySelector('${testSelector("all-done-card")}')`);
    assert.equal(await evaluate(`!!document.querySelector('${testSelector("question-countdown")}')`), false);
    await evaluate(`document.querySelector('[aria-label="Ver las páginas originales de la propuesta"]').click()`);
    await waitFor("document.body.innerText.includes('DOCUMENTOS ORIGINALES')");
    await evaluate(`document.querySelector('[aria-label="Cerrar páginas originales"]').click()`);
    await send("Emulation.setDeviceMetricsOverride", { width: 1280, height: 800, deviceScaleFactor: 1, mobile: false });
    await send("Page.reload");
    await waitFor(`!!document.querySelector('${testSelector("start-daily-quiz")}')`);
    await delay(500);
    assert.equal(await evaluate("document.documentElement.scrollWidth <= window.innerWidth"), true);
    await screenshot("home-desktop.png");
    console.log(JSON.stringify({ passed: true, tests: ["top button and proposal", "one-question flow", "correct answer scoring", "one-second clock cadence", "deadline persisted across exit/reopen", "automatic timeout", "single incorrect score", "completion", "original-page viewer", "responsive desktop"], screenshots: out }, null, 2));
  } catch (error) {
    await screenshot("failure.png").catch(() => {});
    console.error((await evaluate("document.body.innerText").catch(() => "")).slice(0, 1800));
    throw error;
  } finally {
    await send("Page.close").catch(() => {});
    socket.close();
  }
})().catch((error) => { console.error(error); process.exitCode = 1; });
