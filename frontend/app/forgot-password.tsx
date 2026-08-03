import { useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  TextInput,
  TouchableOpacity,
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { COLORS } from "@/src/theme";
import { api } from "@/src/lib/api";

export default function ForgotPasswordScreen() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const submit = async () => {
    setMsg(null);
    setErrorMsg(null);
    if (!email.trim()) {
      setErrorMsg("Ingresa tu correo");
      return;
    }
    setBusy(true);
    try {
      const r = await api.forgotPassword(email.trim());
      setMsg(r.message + " Revisa tu bandeja de entrada y usa el código para restablecer.");
    } catch (e: any) {
      setErrorMsg(e?.message || "Error");
    } finally {
      setBusy(false);
    }
  };

  return (
    <SafeAreaView style={styles.container} edges={["top", "bottom"]}>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === "ios" ? "padding" : undefined}>
        <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
          <TouchableOpacity onPress={() => router.back()} style={styles.backBtn} testID="back-button">
            <Ionicons name="chevron-back" size={24} color={COLORS.primaryDark} />
            <Text style={styles.backText}>Volver</Text>
          </TouchableOpacity>

          <View style={styles.iconCircle}>
            <Ionicons name="key-outline" size={48} color={COLORS.white} />
          </View>

          <Text style={styles.title} testID="forgot-title">¿Olvidaste tu contraseña?</Text>
          <Text style={styles.subtitle}>
            Ingresa tu correo y te enviaremos un código para crear una nueva contraseña.
          </Text>

          <View style={styles.field}>
            <Ionicons name="mail-outline" size={18} color={COLORS.textMuted} />
            <TextInput
              placeholder="Correo electrónico"
              value={email}
              onChangeText={setEmail}
              style={styles.input}
              testID="forgot-email"
              placeholderTextColor={COLORS.textMuted}
              autoCapitalize="none"
              keyboardType="email-address"
            />
          </View>

          {errorMsg && (
            <View style={styles.errorBox} testID="forgot-error">
              <Text style={styles.errorText}>{errorMsg}</Text>
            </View>
          )}
          {msg && (
            <View style={styles.successBox} testID="forgot-success">
              <Text style={styles.successText}>{msg}</Text>
            </View>
          )}

          <TouchableOpacity style={[styles.btn, busy && { opacity: 0.6 }]} onPress={submit} disabled={busy} testID="forgot-submit">
            {busy ? <ActivityIndicator color={COLORS.white} /> : <Text style={styles.btnText}>Enviar código</Text>}
          </TouchableOpacity>

          <TouchableOpacity style={styles.secondaryBtn} onPress={() => router.push("/reset-password" as any)} testID="already-have-code">
            <Text style={styles.secondaryText}>Ya tengo un código</Text>
          </TouchableOpacity>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.background },
  scroll: { padding: 24, flexGrow: 1 },
  backBtn: { flexDirection: "row", alignItems: "center", gap: 4, marginBottom: 12 },
  backText: { color: COLORS.primaryDark, fontWeight: "700" },
  iconCircle: {
    width: 80,
    height: 80,
    borderRadius: 40,
    backgroundColor: COLORS.primary,
    alignItems: "center",
    justifyContent: "center",
    alignSelf: "center",
    marginTop: 20,
    marginBottom: 16,
  },
  title: { fontSize: 22, fontWeight: "900", color: COLORS.primaryDark, textAlign: "center" },
  subtitle: { color: COLORS.textSecondary, textAlign: "center", marginTop: 8, marginBottom: 24, lineHeight: 20 },
  field: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    borderWidth: 1,
    borderColor: COLORS.border,
    borderRadius: 14,
    paddingHorizontal: 14,
    backgroundColor: COLORS.white,
    marginBottom: 12,
  },
  input: { flex: 1, paddingVertical: 14, fontSize: 15, color: COLORS.textPrimary },
  errorBox: { backgroundColor: COLORS.errorBg, borderRadius: 12, padding: 12, borderWidth: 1, borderColor: COLORS.error, marginBottom: 12 },
  errorText: { color: COLORS.error, textAlign: "center", fontSize: 13 },
  successBox: { backgroundColor: COLORS.successBg, borderRadius: 12, padding: 12, borderWidth: 1, borderColor: COLORS.success, marginBottom: 12 },
  successText: { color: COLORS.accentDarker, textAlign: "center", fontSize: 13 },
  btn: { backgroundColor: COLORS.primary, paddingVertical: 16, borderRadius: 14, alignItems: "center" },
  btnText: { color: COLORS.white, fontWeight: "800", fontSize: 16 },
  secondaryBtn: { paddingVertical: 14, alignItems: "center", marginTop: 8 },
  secondaryText: { color: COLORS.primary, fontWeight: "700" },
});
