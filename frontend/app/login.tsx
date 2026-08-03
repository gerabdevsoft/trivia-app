import { useEffect, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Image,
  ActivityIndicator,
  Platform,
  TextInput,
  ScrollView,
  KeyboardAvoidingView,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import Constants from "expo-constants";
import { Ionicons } from "@expo/vector-icons";

import { COLORS, ASSETS } from "@/src/theme";
import { useAuth } from "@/src/context/auth";
import { api } from "@/src/lib/api";

type Mode = "login" | "register";

const WEB_CLIENT_ID = process.env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID || "";

// Only native builds ship Google's native SDK. Expo Go and web preview cannot run it.
const isExpoGo = Constants.appOwnership === "expo";
const IS_WEB = Platform.OS === "web";
const GOOGLE_NATIVE_AVAILABLE = !isExpoGo && !IS_WEB;

export default function LoginScreen() {
  const router = useRouter();
  const { user, applySessionResponse, loading: authLoading } = useAuth();
  const [busy, setBusy] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [infoMsg, setInfoMsg] = useState<string | null>(null);
  const [mode, setMode] = useState<Mode>("login");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPass, setShowPass] = useState(false);

  useEffect(() => {
    if (!authLoading && user) {
      if (user.is_admin) router.replace("/(admin)/dashboard");
      else router.replace("/(user)/home");
    }
  }, [authLoading, user, router]);

  useEffect(() => {
    // Configure Google Sign-In only in native builds (not Expo Go, not web)
    if (!GOOGLE_NATIVE_AVAILABLE) return;
    (async () => {
      try {
        const mod = await import("@react-native-google-signin/google-signin");
        mod.GoogleSignin.configure({
          webClientId: WEB_CLIENT_ID,
          offlineAccess: false,
        });
      } catch (e) {
        console.log("Google Signin configure error:", e);
      }
    })();
  }, []);

  const handleGoogleLogin = async () => {
    setErrorMsg(null);
    setInfoMsg(null);
    if (!GOOGLE_NATIVE_AVAILABLE) {
      setInfoMsg(
        IS_WEB
          ? "Google Sign-In sólo funciona en la app instalada (Android/iOS). En web usa correo y contraseña."
          : "Google Sign-In requiere un build nativo. En Expo Go usa correo y contraseña; genera un build de la app para habilitarlo.",
      );
      return;
    }
    setBusy(true);
    try {
      const mod = await import("@react-native-google-signin/google-signin");
      const { GoogleSignin } = mod;
      await GoogleSignin.hasPlayServices({ showPlayServicesUpdateDialog: true });
      const info: any = await GoogleSignin.signIn();
      // v14+ returns { type: 'success', data: { idToken, user } }, older returns { idToken, user }
      const idToken: string | undefined = info?.data?.idToken || info?.idToken;
      if (!idToken) {
        setErrorMsg("No se recibió ID token de Google");
        setBusy(false);
        return;
      }
      const res = await api.googleSignIn(idToken);
      const u = await applySessionResponse(res);
      if (u?.is_admin) router.replace("/(admin)/dashboard");
      else router.replace("/(user)/home");
    } catch (e: any) {
      if (e?.code === "SIGN_IN_CANCELLED" || e?.message?.includes("cancel")) {
        // silent
      } else {
        setErrorMsg(e?.message || "Error al iniciar con Google");
      }
    } finally {
      setBusy(false);
    }
  };

  const handleSubmit = async () => {
    setErrorMsg(null);
    setInfoMsg(null);
    if (!email.trim() || !password) {
      setErrorMsg("Ingresa email y contraseña");
      return;
    }
    if (mode === "register" && name.trim().length < 2) {
      setErrorMsg("Ingresa tu nombre");
      return;
    }
    setBusy(true);
    try {
      const res = mode === "login"
        ? await api.login(email.trim(), password)
        : await api.register(name.trim(), email.trim(), password);
      const u = await applySessionResponse(res);
      if (u?.is_admin) router.replace("/(admin)/dashboard");
      else router.replace("/(user)/home");
    } catch (e: any) {
      setErrorMsg(e?.message || "Error");
    } finally {
      setBusy(false);
    }
  };

  return (
    <SafeAreaView style={styles.container} edges={["top", "bottom"]}>
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
      >
        <ScrollView
          contentContainerStyle={styles.scroll}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          <View style={styles.hero}>
            <View style={styles.iconCircle}>
              <Ionicons name="trophy" size={56} color={COLORS.white} />
            </View>
            <Text style={styles.title} testID="app-title">Trivia GerabDevSoft</Text>
            <Text style={styles.subtitle}>
              Responde, acumula puntos y gana premios
            </Text>
          </View>

          <View style={styles.tabs}>
            <TouchableOpacity
              onPress={() => setMode("login")}
              style={[styles.tabBtn, mode === "login" && styles.tabActive]}
              testID="tab-login"
            >
              <Text style={[styles.tabText, mode === "login" && styles.tabTextActive]}>Iniciar sesión</Text>
            </TouchableOpacity>
            <TouchableOpacity
              onPress={() => setMode("register")}
              style={[styles.tabBtn, mode === "register" && styles.tabActive]}
              testID="tab-register"
            >
              <Text style={[styles.tabText, mode === "register" && styles.tabTextActive]}>Crear cuenta</Text>
            </TouchableOpacity>
          </View>

          <View style={styles.form}>
            {mode === "register" && (
              <View style={styles.field}>
                <Ionicons name="person-outline" size={18} color={COLORS.textMuted} />
                <TextInput
                  placeholder="Nombre completo"
                  value={name}
                  onChangeText={setName}
                  style={styles.input}
                  testID="name-input"
                  placeholderTextColor={COLORS.textMuted}
                  autoCapitalize="words"
                />
              </View>
            )}
            <View style={styles.field}>
              <Ionicons name="mail-outline" size={18} color={COLORS.textMuted} />
              <TextInput
                placeholder="Correo electrónico"
                value={email}
                onChangeText={setEmail}
                style={styles.input}
                testID="email-input"
                placeholderTextColor={COLORS.textMuted}
                autoCapitalize="none"
                keyboardType="email-address"
                autoComplete="email"
              />
            </View>
            <View style={styles.field}>
              <Ionicons name="lock-closed-outline" size={18} color={COLORS.textMuted} />
              <TextInput
                placeholder="Contraseña"
                value={password}
                onChangeText={setPassword}
                style={styles.input}
                testID="password-input"
                placeholderTextColor={COLORS.textMuted}
                secureTextEntry={!showPass}
                autoCapitalize="none"
              />
              <TouchableOpacity onPress={() => setShowPass(!showPass)} testID="toggle-password-visibility">
                <Ionicons name={showPass ? "eye-off-outline" : "eye-outline"} size={20} color={COLORS.textMuted} />
              </TouchableOpacity>
            </View>

            {mode === "login" && (
              <TouchableOpacity onPress={() => router.push("/forgot-password" as any)} testID="forgot-link">
                <Text style={styles.forgot}>¿Olvidaste tu contraseña?</Text>
              </TouchableOpacity>
            )}

            {errorMsg ? (
              <View style={styles.errorBox} testID="login-error">
                <Text style={styles.errorText}>{errorMsg}</Text>
              </View>
            ) : null}
            {infoMsg ? (
              <View style={styles.infoBox} testID="login-info">
                <Text style={styles.infoText}>{infoMsg}</Text>
              </View>
            ) : null}

            <TouchableOpacity
              style={[styles.primaryBtn, busy && styles.disabled]}
              onPress={handleSubmit}
              disabled={busy}
              testID="submit-button"
            >
              {busy ? (
                <ActivityIndicator color={COLORS.white} />
              ) : (
                <Text style={styles.primaryBtnText}>
                  {mode === "login" ? "Iniciar sesión" : "Crear cuenta"}
                </Text>
              )}
            </TouchableOpacity>

            <View style={styles.divider}>
              <View style={styles.dividerLine} />
              <Text style={styles.dividerText}>o continúa con</Text>
              <View style={styles.dividerLine} />
            </View>

            <TouchableOpacity
              style={[styles.googleBtn, busy && styles.disabled]}
              onPress={handleGoogleLogin}
              disabled={busy}
              testID="google-signin-button"
            >
              <Ionicons name="logo-google" size={20} color={COLORS.primary} style={{ marginRight: 10 }} />
              <Text style={styles.googleBtnText}>Google</Text>
            </TouchableOpacity>
          </View>

          <View style={styles.brandFooter}>
            <Image source={{ uri: ASSETS.gerabDevSoft }} style={styles.brandLogo} resizeMode="contain" />
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.background },
  scroll: { paddingHorizontal: 24, paddingBottom: 20, flexGrow: 1 },
  hero: { alignItems: "center", marginTop: 24, marginBottom: 20 },
  iconCircle: {
    width: 96,
    height: 96,
    borderRadius: 48,
    backgroundColor: COLORS.primary,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 16,
    shadowColor: COLORS.primaryDark,
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.3,
    shadowRadius: 10,
    elevation: 6,
  },
  title: { fontSize: 24, fontWeight: "900", color: COLORS.primaryDark },
  subtitle: { fontSize: 14, color: COLORS.textSecondary, marginTop: 4, textAlign: "center" },
  tabs: { flexDirection: "row", backgroundColor: COLORS.surface, borderRadius: 12, padding: 4, marginBottom: 20 },
  tabBtn: { flex: 1, paddingVertical: 10, borderRadius: 10, alignItems: "center" },
  tabActive: { backgroundColor: COLORS.white, shadowColor: COLORS.primaryDark, shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.1, shadowRadius: 4, elevation: 2 },
  tabText: { color: COLORS.textMuted, fontWeight: "700", fontSize: 14 },
  tabTextActive: { color: COLORS.primaryDark },
  form: { gap: 12 },
  field: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    borderWidth: 1,
    borderColor: COLORS.border,
    borderRadius: 14,
    paddingHorizontal: 14,
    backgroundColor: COLORS.white,
  },
  input: { flex: 1, paddingVertical: 14, fontSize: 15, color: COLORS.textPrimary },
  forgot: { color: COLORS.primary, fontWeight: "600", textAlign: "right", fontSize: 13 },
  errorBox: {
    backgroundColor: COLORS.errorBg,
    borderRadius: 12,
    padding: 12,
    borderWidth: 1,
    borderColor: COLORS.error,
  },
  errorText: { color: COLORS.error, textAlign: "center", fontSize: 13 },
  infoBox: {
    backgroundColor: COLORS.surfaceAlt,
    borderRadius: 12,
    padding: 12,
    borderWidth: 1,
    borderColor: COLORS.primaryLight,
  },
  infoText: { color: COLORS.primaryDark, textAlign: "center", fontSize: 13 },
  primaryBtn: {
    backgroundColor: COLORS.primary,
    borderRadius: 14,
    paddingVertical: 16,
    alignItems: "center",
    justifyContent: "center",
    shadowColor: COLORS.primary,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 4,
  },
  primaryBtnText: { color: COLORS.white, fontSize: 16, fontWeight: "800" },
  disabled: { opacity: 0.6 },
  divider: { flexDirection: "row", alignItems: "center", gap: 10, marginVertical: 4 },
  dividerLine: { flex: 1, height: 1, backgroundColor: COLORS.border },
  dividerText: { color: COLORS.textMuted, fontSize: 12 },
  googleBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: COLORS.border,
    borderRadius: 14,
    paddingVertical: 14,
    backgroundColor: COLORS.white,
  },
  googleBtnText: { color: COLORS.textPrimary, fontWeight: "700", fontSize: 15 },
  brandFooter: { alignItems: "center", justifyContent: "center", marginTop: 24, paddingBottom: 8 },
  brandLogo: { width: 140, height: 60 },
});
