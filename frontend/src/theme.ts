import { Platform } from "react-native";
import Constants from "expo-constants";

export const API_BASE_URL: string =
  process.env.EXPO_PUBLIC_BACKEND_URL ||
  (Constants.expoConfig?.extra as any)?.EXPO_PUBLIC_BACKEND_URL ||
  "";

export const COLORS = {
  primary: "#0460c3",
  primaryDark: "#002954",
  primaryLight: "#00b8e2",
  accent: "#57cc02",
  accentDark: "#419902",
  accentDarker: "#347a01",
  background: "#FFFFFF",
  surface: "#F5F8FA",
  surfaceAlt: "#E6EFF9",
  textPrimary: "#002954",
  textSecondary: "#4A6583",
  textMuted: "#7A8FA3",
  border: "#E1E8F0",
  error: "#FF3B30",
  errorBg: "#FFECEB",
  success: "#57cc02",
  successBg: "#EEFADF",
  white: "#FFFFFF",
  black: "#000000",
  overlay: "rgba(0, 41, 84, 0.6)",
};

export const ASSETS = {
  watermark: "https://customer-assets.emergentagent.com/job_quiz-points-raffle/artifacts/871qvire_Fondo.jpg",
  logos: "https://customer-assets.emergentagent.com/job_quiz-points-raffle/artifacts/uv069adk_Logos.jpg",
  gerabDevSoft: "https://customer-assets.emergentagent.com/job_quiz-points-raffle/artifacts/u0pqzdlp_Logo%20GerabDevSoft.jpg",
};

export const IS_WEB = Platform.OS === "web";
