const { test } = require("node:test");
const assert = require("node:assert/strict");
const {
  remainingSeconds, localDeadline, parseQuizSession, quizStorageKey,
} = require("../../generated-artifacts/quiz-time-test/lib/quiz-time.js");

test("countdown is calculated from the deadline, never accumulated ticks", () => {
  assert.equal(remainingSeconds(11000, 1000), 10);
  assert.equal(remainingSeconds(11000, 8500), 3);
  assert.equal(remainingSeconds(11000, 11000), 0);
  assert.equal(remainingSeconds(11000, 90000), 0);
});

test("reopening after expiration does not give another ten seconds", () => {
  const raw = JSON.stringify({
    version: 1, userId: "user-a", quizDate: "2026-10-13", deadline: 11000,
    question: { id: "q1", statement: "Pregunta", options: ["A", "B"] },
  });
  const restored = parseQuizSession(raw, "user-a", "2026-10-13");
  assert.equal(restored.deadline, 11000);
  assert.equal(remainingSeconds(restored.deadline, 15000), 0);
});

test("server remaining time is mapped independently of device timezone or clock", () => {
  const end = localDeadline("2026-10-13T15:00:10Z", "2026-10-13T15:00:00Z", 2000);
  assert.equal(end, 12000);
  assert.equal(remainingSeconds(end, 2000), 10);
  assert.equal(localDeadline("2026-10-13T15:00:00Z", "2026-10-13T15:00:10Z", 5000), 5000);
});

test("stored attempts are isolated by account and day", () => {
  const raw = JSON.stringify({
    version: 1, userId: "user-a", quizDate: "2026-10-13", deadline: 11000,
    question: { id: "q1", statement: "Pregunta", options: ["A", "B"] },
  });
  assert.equal(parseQuizSession(raw, "user-b", "2026-10-13"), null);
  assert.equal(parseQuizSession(raw, "user-a", "2026-10-14"), null);
  assert.notEqual(quizStorageKey("user-a"), quizStorageKey("user-b"));
});

test("damaged local storage cannot create an invalid countdown", () => {
  assert.equal(parseQuizSession("{broken", "user-a", "2026-10-13"), null);
  assert.equal(parseQuizSession(null, "user-a", "2026-10-13"), null);
  assert.equal(parseQuizSession(JSON.stringify({ version: 1 }), "user-a", "2026-10-13"), null);
});
