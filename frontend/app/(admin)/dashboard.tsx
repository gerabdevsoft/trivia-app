import { useCallback, useEffect, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  ActivityIndicator,
  TextInput,
  RefreshControl,
  Modal,
  KeyboardAvoidingView,
  Platform,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { COLORS } from "@/src/theme";
import { api } from "@/src/lib/api";
import { useAuth } from "@/src/context/auth";

export default function AdminDashboard() {
  const router = useRouter();
  const { logout } = useAuth();
  const [stats, setStats] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [notifOpen, setNotifOpen] = useState(false);
  const [notifTitle, setNotifTitle] = useState("");
  const [notifMsg, setNotifMsg] = useState("");
  const [notifBusy, setNotifBusy] = useState(false);
  const [toast, setToast] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const r = await api.adminStats();
      setStats(r);
    } catch (e) { console.log(e); }
    finally { setLoading(false); setRefreshing(false); }
  }, []);
  useEffect(() => { load(); }, [load]);

  const sendNotif = async () => {
    if (!notifTitle.trim() || !notifMsg.trim()) return;
    setNotifBusy(true);
    try {
      const r = await api.adminSendNotification(notifTitle, notifMsg);
      setToast(`Notificación enviada a ${r.sent_to || 0} usuarios`);
      setNotifTitle(""); setNotifMsg(""); setNotifOpen(false);
      setTimeout(() => setToast(null), 3000);
    } catch (e: any) {
      setToast(e?.message || "Error");
      setTimeout(() => setToast(null), 3000);
    } finally { setNotifBusy(false); }
  };

  const doLogout = async () => { await logout(); router.replace("/login"); };

  return (
    <SafeAreaView style={styles.root} edges={["top"]}>
      <View style={styles.header}>
        <View>
          <Text style={styles.hi}>Admin</Text>
          <Text style={styles.title} testID="admin-title">Panel de Control</Text>
        </View>
        <TouchableOpacity onPress={doLogout} style={styles.logoutIcon} testID="admin-logout">
          <Ionicons name="log-out-outline" size={24} color={COLORS.primaryDark} />
        </TouchableOpacity>
      </View>

      <ScrollView
        contentContainerStyle={{ padding: 20, paddingBottom: 40 }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} />}
      >
        {loading ? (
          <ActivityIndicator size="large" color={COLORS.primary} />
        ) : (
          <>
            <View style={styles.grid}>
              <Metric icon="people" color={COLORS.primary} label="Usuarios" value={stats?.total_users ?? 0} testID="metric-users" />
              <Metric icon="pulse" color={COLORS.accent} label="Activos" value={stats?.active_users ?? 0} testID="metric-active" />
              <Metric icon="calendar" color={COLORS.primaryLight} label="Semanal" value={stats?.weekly_participants ?? 0} testID="metric-weekly" />
              <Metric icon="checkmark-done" color={COLORS.primaryDark} label="Respuestas" value={stats?.answers_total ?? 0} testID="metric-answers" />
              <Metric icon="gift" color={COLORS.accent} label="Premios pend." value={stats?.pending_prizes ?? 0} testID="metric-pending" />
              <Metric icon="trophy" color={COLORS.primary} label="Sorteados" value={stats?.executed_prizes ?? 0} testID="metric-executed" />
            </View>

            <TouchableOpacity style={styles.notifBtn} onPress={() => setNotifOpen(true)} testID="open-notif-modal">
              <Ionicons name="notifications" size={20} color={COLORS.white} />
              <Text style={styles.notifBtnText}>Enviar notificación push</Text>
            </TouchableOpacity>

            <Text style={styles.section}>Top 10 Semanal</Text>
            {(stats?.top10 ?? []).length === 0 ? (
              <View style={styles.empty}><Text style={styles.emptyText}>Sin puntajes esta semana</Text></View>
            ) : (
              stats.top10.map((r: any) => (
                <View key={r.user_id} style={styles.rankRow} testID={`admin-rank-${r.rank}`}>
                  <Text style={styles.rankNum}>#{r.rank}</Text>
                  <Text style={styles.rankName}>{r.name}</Text>
                  <Text style={styles.rankPts}>{r.points} pts</Text>
                </View>
              ))
            )}

            <Text style={styles.section}>Próximos Sorteos</Text>
            {(stats?.upcoming ?? []).length === 0 ? (
              <View style={styles.empty}><Text style={styles.emptyText}>No hay sorteos pendientes</Text></View>
            ) : (
              stats.upcoming.map((p: any) => (
                <View key={p.prize_id} style={styles.upcomingRow}>
                  <Ionicons name={p.prize_type === "weekly" ? "trophy" : "star"} size={20} color={COLORS.primary} />
                  <View style={{ flex: 1 }}>
                    <Text style={styles.upcomingName}>{p.name}</Text>
                    <Text style={styles.upcomingType}>{p.prize_type === "weekly" ? "Semanal" : "Usuarios activos"} · {p.draw_date || "sin fecha"}</Text>
                  </View>
                </View>
              ))
            )}
          </>
        )}
      </ScrollView>

      {toast && (
        <View style={styles.toast} testID="toast"><Text style={styles.toastText}>{toast}</Text></View>
      )}

      <Modal visible={notifOpen} transparent animationType="slide" onRequestClose={() => setNotifOpen(false)}>
        <KeyboardAvoidingView style={styles.modalWrap} behavior={Platform.OS === "ios" ? "padding" : undefined}>
          <View style={styles.modal}>
            <Text style={styles.modalTitle}>Enviar notificación</Text>
            <TextInput
              placeholder="Título"
              value={notifTitle}
              onChangeText={setNotifTitle}
              style={styles.input}
              testID="notif-title"
              placeholderTextColor={COLORS.textMuted}
            />
            <TextInput
              placeholder="Mensaje"
              value={notifMsg}
              onChangeText={setNotifMsg}
              multiline
              numberOfLines={3}
              style={[styles.input, { minHeight: 80, textAlignVertical: "top" }]}
              testID="notif-message"
              placeholderTextColor={COLORS.textMuted}
            />
            <View style={{ flexDirection: "row", gap: 10 }}>
              <TouchableOpacity style={[styles.btnGhost, { flex: 1 }]} onPress={() => setNotifOpen(false)}>
                <Text style={styles.btnGhostText}>Cancelar</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.btnPrimary, { flex: 1 }]}
                onPress={sendNotif}
                disabled={notifBusy}
                testID="send-notif-button"
              >
                {notifBusy ? <ActivityIndicator color={COLORS.white} /> : <Text style={styles.btnPrimaryText}>Enviar</Text>}
              </TouchableOpacity>
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </SafeAreaView>
  );
}

function Metric({ icon, color, label, value, testID }: any) {
  return (
    <View style={styles.metric} testID={testID}>
      <View style={[styles.metricIcon, { backgroundColor: color + "22" }]}>
        <Ionicons name={icon} size={20} color={color} />
      </View>
      <Text style={[styles.metricValue, { color }]}>{value}</Text>
      <Text style={styles.metricLabel}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: COLORS.surface },
  header: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", padding: 20, paddingBottom: 10 },
  hi: { fontSize: 13, color: COLORS.textMuted, textTransform: "uppercase", fontWeight: "700" },
  title: { fontSize: 26, fontWeight: "900", color: COLORS.primaryDark },
  logoutIcon: { padding: 8 },
  grid: { flexDirection: "row", flexWrap: "wrap", gap: 10, marginBottom: 16 },
  metric: {
    width: "31%",
    backgroundColor: COLORS.white,
    borderRadius: 16,
    padding: 12,
    borderWidth: 1,
    borderColor: COLORS.border,
    alignItems: "flex-start",
  },
  metricIcon: { width: 36, height: 36, borderRadius: 10, alignItems: "center", justifyContent: "center", marginBottom: 6 },
  metricValue: { fontSize: 22, fontWeight: "900" },
  metricLabel: { fontSize: 11, color: COLORS.textMuted, textTransform: "uppercase", fontWeight: "700" },
  notifBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    backgroundColor: COLORS.accent,
    padding: 14,
    borderRadius: 16,
    marginBottom: 20,
  },
  notifBtnText: { color: COLORS.white, fontWeight: "800", fontSize: 15 },
  section: { fontSize: 16, fontWeight: "800", color: COLORS.primaryDark, marginBottom: 10, marginTop: 8 },
  rankRow: { flexDirection: "row", backgroundColor: COLORS.white, padding: 12, borderRadius: 12, marginBottom: 6, alignItems: "center", gap: 10 },
  rankNum: { fontWeight: "900", color: COLORS.primary, minWidth: 36 },
  rankName: { flex: 1, color: COLORS.textPrimary, fontWeight: "600" },
  rankPts: { color: COLORS.accent, fontWeight: "900" },
  upcomingRow: { flexDirection: "row", gap: 12, alignItems: "center", backgroundColor: COLORS.white, padding: 12, borderRadius: 12, marginBottom: 6 },
  upcomingName: { fontWeight: "700", color: COLORS.primaryDark },
  upcomingType: { fontSize: 12, color: COLORS.textMuted, marginTop: 2 },
  empty: { padding: 20, backgroundColor: COLORS.white, borderRadius: 12, alignItems: "center" },
  emptyText: { color: COLORS.textMuted },
  modalWrap: { flex: 1, backgroundColor: COLORS.overlay, justifyContent: "flex-end" },
  modal: { backgroundColor: COLORS.white, borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 20, paddingBottom: 32 },
  modalTitle: { fontSize: 20, fontWeight: "900", color: COLORS.primaryDark, marginBottom: 12 },
  input: {
    borderWidth: 1,
    borderColor: COLORS.border,
    borderRadius: 12,
    padding: 12,
    marginBottom: 10,
    color: COLORS.textPrimary,
    backgroundColor: COLORS.surface,
  },
  btnPrimary: { backgroundColor: COLORS.primary, padding: 14, borderRadius: 12, alignItems: "center" },
  btnPrimaryText: { color: COLORS.white, fontWeight: "800" },
  btnGhost: { padding: 14, borderRadius: 12, alignItems: "center", borderWidth: 1, borderColor: COLORS.border },
  btnGhostText: { color: COLORS.textPrimary, fontWeight: "700" },
  toast: { position: "absolute", left: 20, right: 20, bottom: 20, backgroundColor: COLORS.primaryDark, padding: 14, borderRadius: 12 },
  toastText: { color: COLORS.white, textAlign: "center", fontWeight: "600" },
});
