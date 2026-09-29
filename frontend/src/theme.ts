import { Platform } from "react-native";
import Constants from "expo-constants";

export const API_BASE_URL: string =
  process.env.EXPO_PUBLIC_BACKEND_URL ||
  (Constants.expoConfig?.extra as any)?.EXPO_PUBLIC_BACKEND_URL ||
  "";

// Paleta de marca (línea gráfica roja)
// Rojo principal #E52233 · Rojo secundario #C91F1F · Coral #FF685E · Coral claro #FFA3AA · Blanco #FFFFFF
export const COLORS = {
  primary: "#E52233",       // Rojo principal
  primaryDark: "#C91F1F",   // Rojo secundario
  primaryLight: "#FF685E",  // Coral
  accent: "#FF685E",        // Coral (destacado / éxito)
  accentDark: "#E52233",
  accentDarker: "#C91F1F",
  background: "#FFFFFF",
  surface: "#FFF5F6",       // Blanco tintado con coral claro
  surfaceAlt: "#FFE1E3",    // Coral claro suavizado
  textPrimary: "#1A1A1A",   // Casi negro para máxima legibilidad
  textSecondary: "#4D4D4D",
  textMuted: "#8A8A8A",
  border: "#F2D9DB",        // Borde suave rosado
  error: "#C91F1F",
  errorBg: "#FFE1E3",
  success: "#FF685E",       // Aciertos con coral
  successBg: "#FFECEE",
  white: "#FFFFFF",
  black: "#000000",
  overlay: "rgba(201, 31, 31, 0.55)",  // Overlay tinte rojo
};

// Pesos tipográficos autorizados
export const FONT_WEIGHTS = {
  bold: "700" as const,        // Nombre, titulares y llamadas
  semiBold: "600" as const,    // Subtítulos y destacados
  medium: "500" as const,      // Etiquetas, botones y pies
  regular: "400" as const,     // Texto corrido y descripciones
};

// Jerarquía de tamaños de letras (referencia)
export const FONT_SIZES = {
  h1: 28,
  h2: 22,
  h3: 18,
  title: 16,
  body: 14,
  label: 12,
  caption: 11,
};

export const ASSETS = {  
  watermark: require('./../assets/images/watermark.jpg'),
  yamile_hayes: require('./../assets/images/logo_yamile_hayes.jpg'),
  yamile_hayes_vice: require('./../assets/images/foto_yamile_hayes.jpg'),  
  yamile_hayes_circulo: require('./../assets/images/foto_circulo_yamile_hayes.jpg'),
};

export const IS_WEB = Platform.OS === "web";
