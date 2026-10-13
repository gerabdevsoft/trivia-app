const { test } = require("node:test");
const assert = require("node:assert/strict");
const { registrationError, googleErrorMessage, apiErrorMessage } = require("../../generated-artifacts/auth-test/auth-validation.js");
const valid = { name: "Persona de prueba", email: "example@example.com", password: "password-test", faculty: "Facultad de prueba", ci: "123456", cu: "" };
const faculties = [valid.faculty];

for (const [field, value, expected] of [
  ["name", " ", /nombre/i], ["email", "correo-mal", /correo/i],
  ["password", "123", /6 caracteres/], ["faculty", "", /facultad/i],
  ["faculty", "Inválida", /válida/], ["ci", "", /documento/],
  ["ci", "x".repeat(31), /30 caracteres/],
]) {
  test(`register validates ${field}: ${value.length} characters`, () => {
    assert.match(registrationError({ ...valid, [field]: value }, faculties), expected);
  });
}
test("Google requires faculty and document, not a second password or email", () => {
  const google = { ...valid, name: "", email: "", password: "" };
  assert.equal(registrationError(google, faculties, true), null);
  assert.match(registrationError({ ...google, faculty: "" }, faculties, true), /facultad/);
  assert.match(registrationError({ ...google, ci: " " }, faculties, true), /documento/);
});
test("either CI or CU is sufficient", () => {
  assert.equal(registrationError({ ...valid, ci: "", cu: "CU123" }, faculties), null);
});
test("Google configuration errors have a clear nontechnical message", () => {
  for (const error of [{ code: 10 }, { code: "DEVELOPER_ERROR" }, { message: "DEVELOPER_ERROR follow troubleshooting" }]) {
    const message = googleErrorMessage(error);
    assert.match(message, /no está configurado/);
    assert.doesNotMatch(message, /DEVELOPER_ERROR|github/);
  }
  assert.equal(googleErrorMessage({ code: "SIGN_IN_CANCELLED" }), null);
});
test("FastAPI field errors never appear as object Object", () => {
  const message = apiErrorMessage({ detail: [{ loc: ["body", "profile", "faculty"], type: "missing" }] });
  assert.equal(message, "Facultad: completa este campo.");
  assert.equal(apiErrorMessage({ detail: "El correo ya está registrado" }), "El correo ya está registrado");
  assert.match(apiErrorMessage({ detail: [{ loc: ["body"], msg: "Value error, Ingresa CI o CU" }] }), /Ingresa CI o CU/);
});
