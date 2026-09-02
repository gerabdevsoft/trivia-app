import { API_BASE_URL } from "@/src/theme";
import { storage } from "@/src/utils/storage";

const SESSION_KEY = "session_token";

async function getToken(): Promise<string | null> {
  return await storage.secureGet<string>(SESSION_KEY, "");
}

export async function setToken(token: string) {
  await storage.secureSet(SESSION_KEY, token);
}

export async function clearToken() {
  await storage.secureRemove(SESSION_KEY);
}

async function request<T = any>(
  path: string,
  init: RequestInit = {},
): Promise<T> {
  const token = await getToken();
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    "Accept": "application/json",
    ...(init.headers as Record<string, string> | undefined),
  };
  if (token) headers["Authorization"] = `Bearer ${token}`;
  const url = `${API_BASE_URL}${path}`;
  const res = await fetch(url, { ...init, headers });
  const contentType = res.headers.get("content-type") || "";
  const body = contentType.includes("application/json") ? await res.json() : await res.text();
  if (!res.ok) {
    const msg = typeof body === "string" ? body : body?.detail || "Request failed";
    const err = new Error(msg) as any;
    err.status = res.status;
    err.body = body;
    if (res.status === 503 && typeof body === "object" && body?.idle) {
      err.idle = true;
      err.reopens_at = body.reopens_at;
    }
    throw err;
  }
  return body as T;
}

export const api = {
  status: () => request<{ idle: boolean; server_time: string; message: string; opens_at: string; closes_at: string; timezone: string }>("/status"),
  // Auth
  googleSignIn: (id_token: string) =>
    request<{ session_token: string; user: any }>("/auth/google", {
      method: "POST",
      body: JSON.stringify({ id_token }),
    }),
  register: (name: string, email: string, password: string) =>
    request<{ session_token: string; user: any }>("/auth/register", {
      method: "POST",
      body: JSON.stringify({ name, email, password }),
    }),
  login: (email: string, password: string) =>
    request<{ session_token: string; user: any }>("/auth/login", {
      method: "POST",
      body: JSON.stringify({ email, password }),
    }),
  forgotPassword: (email: string) =>
    request<{ message: string }>("/auth/forgot-password", {
      method: "POST",
      body: JSON.stringify({ email }),
    }),
  resetPassword: (token: string, new_password: string) =>
    request<{ ok: boolean; message: string }>("/auth/reset-password", {
      method: "POST",
      body: JSON.stringify({ token, new_password }),
    }),
  me: () => request<any>("/auth/me"),
  logout: () => request("/auth/logout", { method: "POST" }),

  // Push
  registerPush: (platform: string, device_token: string) =>
    request("/register-push", {
      method: "POST",
      body: JSON.stringify({ platform, device_token }),
    }),

  // User
  todayQuestions: () => request<{ date: string; questions: any[] }>("/questions/today"),
  submitAnswer: (question_id: string, selected_index: number) =>
    request<{ correct: boolean; correct_index: number; points_awarded: number; total_points: number }>(
      "/answers",
      { method: "POST", body: JSON.stringify({ question_id, selected_index }) },
    ),
  history: () => request<{ history: any[] }>("/me/history"),
  myWins: () => request<{ wins: any[] }>("/me/wins"),
  ackWin: (raffle_id: string) =>
    request("/me/wins/ack", { method: "POST", body: JSON.stringify({ raffle_id }) }),
  rankingWeekly: () => request<{ top10: any[]; week_start: string; week_end: string }>("/ranking/weekly"),
  prizes: () => request<{ prizes: any[] }>("/prizes"),
  prizeImageUrl: (id: string) => `${API_BASE_URL}/api/prizes/${id}/image`,

  // Admin
  adminStats: () => request<any>("/admin/stats"),
  adminUsers: () => request<{ users: any[] }>("/admin/users"),
  adminToggleUser: (uid: string) =>
    request(`/admin/users/${uid}/toggle-active`, { method: "POST" }),
  adminDeleteUser: (uid: string) =>
    request(`/admin/users/${uid}`, { method: "DELETE" }),

  adminListQuestions: () => request<{ questions: any[] }>("/admin/questions"),
  adminCreateQuestion: (payload: any) =>
    request<{ id: string }>("/admin/questions", { method: "POST", body: JSON.stringify(payload) }),
  adminUpdateQuestion: (qid: string, payload: any) =>
    request(`/admin/questions/${qid}`, { method: "PUT", body: JSON.stringify(payload) }),
  adminDeleteQuestion: (qid: string) =>
    request(`/admin/questions/${qid}`, { method: "DELETE" }),

  adminGetSchedule: () => request<any>("/admin/schedule/today"),
  adminSetSchedule: (question_ids: string[]) =>
    request<any>("/admin/schedule", { method: "POST", body: JSON.stringify({ question_ids }) }),

  adminGetSettings: () => request<any>("/admin/settings"),
  adminUpdateSettings: (payload: any) =>
    request<any>("/admin/settings", { method: "PUT", body: JSON.stringify(payload) }),

  adminListPrizes: () => request<{ prizes: any[] }>("/admin/prizes"),
  adminCreatePrize: (payload: any) =>
    request<{ id: string }>("/admin/prizes", { method: "POST", body: JSON.stringify(payload) }),
  adminUpdatePrize: (pid: string, payload: any) =>
    request(`/admin/prizes/${pid}`, { method: "PUT", body: JSON.stringify(payload) }),
  adminDeletePrize: (pid: string) =>
    request(`/admin/prizes/${pid}`, { method: "DELETE" }),

  adminExecuteWeekly: (prize_id: string, n: number) =>
    request<any>("/admin/raffles/weekly", {
      method: "POST",
      body: JSON.stringify({ prize_id, n }),
    }),
  adminExecuteActive: (prize_id: string, start_date?: string, end_date?: string) =>
    request<any>("/admin/raffles/active", {
      method: "POST",
      body: JSON.stringify({ prize_id, start_date, end_date }),
    }),
  adminRaffleHistory: () => request<{ raffles: any[] }>("/admin/raffles/history"),

  adminSendNotification: (title: string, message: string, audience = "all") =>
    request("/admin/send-notification", {
      method: "POST",
      body: JSON.stringify({ title, message, audience }),
    }),
};
