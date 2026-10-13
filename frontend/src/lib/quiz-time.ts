import type { StoredQuizSession } from "../types/quiz";

export const remainingSeconds = (deadline: number, now = Date.now()): number =>
  Math.max(0, Math.ceil((deadline - now) / 1000));

/** Map the server's remaining duration onto this device's wall clock. */
export const localDeadline = (deadlineAt: string, serverNow: string, now = Date.now()): number =>
  now + Math.max(0, Date.parse(deadlineAt) - Date.parse(serverNow));

export const quizStorageKey = (userId: string): string => `daily-quiz:v1:${userId}`;

export function parseQuizSession(raw: string | null, userId: string, quizDate: string): StoredQuizSession | null {
  if (!raw) return null;
  try {
    const value = JSON.parse(raw);
    if (
      value.version !== 1 || value.userId !== userId || value.quizDate !== quizDate ||
      !Number.isFinite(value.deadline) || typeof value.question?.id !== "string" ||
      typeof value.question?.statement !== "string" || !Array.isArray(value.question?.options)
    ) return null;
    return value as StoredQuizSession;
  } catch {
    return null;
  }
}
