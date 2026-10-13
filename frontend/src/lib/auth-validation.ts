export type RegistrationFields = {
  name: string; email: string; password: string; faculty: string; ci: string; cu: string;
};

export function registrationError(fields: RegistrationFields, faculties: string[], google = false): string | null {
  if (!google) {
    if (fields.name.trim().length < 2) return "Ingresa tu nombre completo (al menos 2 caracteres).";
    if (fields.name.trim().length > 80) return "El nombre no puede superar los 80 caracteres.";
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(fields.email.trim())) return "Ingresa un correo electrónico válido.";
    if (fields.password.length < 6) return "La contraseña debe tener al menos 6 caracteres.";
    if (fields.password.length > 128) return "La contraseña no puede superar los 128 caracteres.";
  }
  if (!fields.faculty.trim()) return "Selecciona tu facultad.";
  if (faculties.length && !faculties.includes(fields.faculty.trim())) return "Selecciona una facultad válida.";
  if (!fields.ci.trim() && !fields.cu.trim()) return "Ingresa al menos un documento: CI o CU.";
  if (fields.ci.trim().length > 30 || fields.cu.trim().length > 30) return "El CI y el CU no pueden superar los 30 caracteres.";
  return null;
}

export function googleErrorMessage(error: { code?: string | number; message?: string }): string | null {
  const code = String(error?.code ?? "");
  const message = error?.message ?? "";
  if (["SIGN_IN_CANCELLED", "12501"].includes(code) || /cancelled|canceled/i.test(message)) return null;
  if (["DEVELOPER_ERROR", "10"].includes(code) || /DEVELOPER_ERROR|developer console/i.test(message)) {
    return "Google no está configurado correctamente para esta versión de la app. Puedes usar correo y contraseña mientras se corrige.";
  }
  if (["IN_PROGRESS", "12502"].includes(code)) return "Ya hay un inicio con Google en curso. Espera un momento.";
  if (code === "PLAY_SERVICES_NOT_AVAILABLE") return "Actualiza Google Play Services para continuar, o usa correo y contraseña.";
  if (["NETWORK_ERROR", "7"].includes(code)) return "No se pudo conectar con Google. Comprueba tu conexión e intenta de nuevo.";
  return message || "No se pudo iniciar sesión con Google. Intenta de nuevo o usa correo y contraseña.";
}

export function apiErrorMessage(body: unknown): string {
  if (typeof body === "string") return body || "No se pudo completar la solicitud.";
  const detail = (body as { detail?: unknown })?.detail;
  if (typeof detail === "string") return detail;
  if (Array.isArray(detail)) {
    const fields: Record<string, string> = { name: "Nombre", email: "Correo electrónico", password: "Contraseña", faculty: "Facultad", ci: "CI", cu: "CU" };
    const messages = detail.map((item) => {
      const location = Array.isArray(item?.loc) ? item.loc : [];
      const field = location[location.length - 1];
      const label = fields[String(field)];
      if (item?.type === "missing") return `${label || "Dato requerido"}: completa este campo.`;
      if (field === "faculty") return "Selecciona una facultad válida.";
      if (field === "email") return "Ingresa un correo electrónico válido.";
      if (item?.type === "string_too_short" && field === "password") return "La contraseña debe tener al menos 6 caracteres.";
      if (item?.type === "string_too_long") return `${label || "El dato"} supera la longitud permitida.`;
      const message = String(item?.msg || "Revisa los datos ingresados.").replace(/^Value error, /, "");
      return label ? `${label}: ${message}` : message;
    });
    return [...new Set(messages)].join("\n") || "Revisa los datos ingresados.";
  }
  return "No se pudo completar la solicitud. Intenta de nuevo.";
}
