import { useEffect, useRef, useState } from "react";
import { View, Text, StyleSheet, ActivityIndicator } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { COLORS } from "@/src/theme";
import { api } from "@/src/lib/api";

type Status = {
  idle: boolean;
  server_time: string;
  message: string;
  opens_at: string;
  closes_at: string;
  timezone: string;
};

let listeners = new Set<(idle: Status | null) => void>();
let currentStatus: Status | null = null;

export function setGlobalIdleStatus(s: Status | null) {
  currentStatus = s;
  listeners.forEach((cb) => cb(s));
}

export function useIdleWatcher() {
  const [status, setStatus] = useState<Status | null>(currentStatus);
  const intervalRef = useRef<any>(null);

  useEffect(() => {
    const listener = (s: Status | null) => setStatus(s);
    listeners.add(listener);

    const check = async () => {
      try {
        const s = await api.status();
        setGlobalIdleStatus(s.idle ? s : null);
      } catch {
        // ignore
      }
    };

    check();
    intervalRef.current = setInterval(check, 60_000);
    return () => {
      listeners.delete(listener);
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, []);

  return status;
}

export function IdleGate({ children }: { children: React.ReactNode }) {
  const status = useIdleWatcher();
  if (!status || !status.idle) return <>{children}</>;
  return (
    <SafeAreaView style={styles.root} edges={["top", "bottom"]} testID="idle-screen">
      <View style={styles.center}>
        <View style={styles.iconWrap}>
          <Ionicons name="moon" size={72} color={COLORS.white} />
        </View>
        <Text style={styles.title}>Aplicación cerrada</Text>
        <Text style={styles.subtitle}>{status.message}</Text>
        <View style={styles.card}>
          <View style={styles.row}>
            <Ionicons name="time-outline" size={20} color={COLORS.primary} />
            <Text style={styles.rowText}>Cierre: {status.closes_at}</Text>
          </View>
          <View style={styles.row}>
            <Ionicons name="sunny-outline" size={20} color={COLORS.accent} />
            <Text style={styles.rowText}>Reapertura: {status.opens_at}</Text>
          </View>
          <View style={styles.row}>
            <Ionicons name="globe-outline" size={18} color={COLORS.textMuted} />
            <Text style={styles.rowMuted}>{status.timezone}</Text>
          </View>
        </View>
        <View style={styles.pulseRow}>
          <ActivityIndicator size="small" color={COLORS.textMuted} />
          <Text style={styles.pulseText}>Reintentando cada minuto…</Text>
        </View>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: COLORS.primaryDark },
  center: { flex: 1, alignItems: "center", justifyContent: "center", paddingHorizontal: 32 },
  iconWrap: {
    width: 120,
    height: 120,
    borderRadius: 60,
    backgroundColor: "rgba(255,255,255,0.1)",
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 24,
  },
  title: { fontSize: 28, fontWeight: "900", color: COLORS.white, textAlign: "center" },
  subtitle: { fontSize: 15, color: "rgba(255,255,255,0.75)", textAlign: "center", marginTop: 12, lineHeight: 22 },
  card: {
    backgroundColor: COLORS.white,
    padding: 20,
    borderRadius: 16,
    marginTop: 28,
    width: "100%",
    gap: 12,
  },
  row: { flexDirection: "row", alignItems: "center", gap: 10 },
  rowText: { fontSize: 15, color: COLORS.textPrimary, fontWeight: "600" },
  rowMuted: { fontSize: 12, color: COLORS.textMuted },
  pulseRow: { flexDirection: "row", alignItems: "center", gap: 8, marginTop: 24 },
  pulseText: { color: "rgba(255,255,255,0.7)", fontSize: 13 },
});
