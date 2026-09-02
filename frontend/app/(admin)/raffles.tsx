import { useCallback, useEffect, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  ActivityIndicator,
  TextInput,
  Modal,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { COLORS } from "@/src/theme";
import { api } from "@/src/lib/api";

export default function AdminRaffles() {
  const [prizes, setPrizes] = useState<any[]>([]);
  const [history, setHistory] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [nValueModal, setNValueModal] = useState<{ prize: any | null; open: boolean }>({ prize: null, open: false });
  const [n, setN] = useState("10");
  const [detail, setDetail] = useState<any | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const showToast = (m: string) => { setToast(m); setTimeout(() => setToast(null), 3000); };

  const load = useCallback(async () => {
    try {
      const [p, h] = await Promise.all([api.adminListPrizes(), api.adminRaffleHistory()]);
      setPrizes(p.prizes as any);
      setHistory(h.raffles as any);
    } catch (e) { console.log(e); } finally { setLoading(false); }
  }, []);
  useEffect(() => { load(); }, [load]);

  const openWeekly = (p: any) => { setN("10"); setNValueModal({ prize: p, open: true }); };
  const executeWeekly = async () => {
    if (!nValueModal.prize) return;
    const nn = parseInt(n, 10);
    if (!nn || nn < 1) { showToast("Ingresa un N válido"); return; }
    setBusy(true);
    try {
      const r = await api.adminExecuteWeekly(nValueModal.prize.prize_id, nn);
      showToast(`Ganador: ${r.winner.name}`);
      setNValueModal({ prize: null, open: false });
      load();
    } catch (e: any) { showToast(e?.message || "Error"); }
    finally { setBusy(false); }
  };
  const executeActive = async (p: any) => {
    setBusy(true);
    try {
      const r = await api.adminExecuteActive(p.prize_id);
      showToast(`Ganador: ${r.winner.name}`);
      load();
    } catch (e: any) { showToast(e?.message || "Error"); }
    finally { setBusy(false); }
  };

  const pending = prizes?.filter((p) => !p.executed);

  return (
    <SafeAreaView style={styles.root} edges={["top"]}>
      <View style={styles.header}>
        <Text style={styles.title} testID="admin-raffles-title">Sorteos</Text>
      </View>
      {loading ? <ActivityIndicator color={COLORS.primary} style={{ marginTop: 30 }} /> : (
        <ScrollView contentContainerStyle={{ padding: 20, paddingBottom: 40 }}>
          <Text style={styles.section}>Ejecutar sorteo</Text>
          {pending.length === 0 ? (
            <View style={styles.empty}><Text style={styles.emptyText}>No hay premios pendientes</Text></View>
          ) : pending.map((p) => (
            <View key={p.prize_id} style={styles.pcard} testID={`pending-prize-${p.prize_id}`}>
              <View style={{ flex: 1 }}>
                <Text style={styles.pname}>{p.name}</Text>
                <Text style={styles.ptype}>{p.prize_type === "weekly" ? "Semanal (Top N)" : "Usuarios activos"}</Text>
                {!!p.draw_date && <Text style={styles.pdate}>Fecha: {p.draw_date}</Text>}
              </View>
              {p.prize_type === "weekly" ? (
                <TouchableOpacity style={styles.execBtn} onPress={() => openWeekly(p)} testID={`exec-weekly-${p.prize_id}`}>
                  <Ionicons name="dice" size={16} color={COLORS.white} />
                  <Text style={styles.execText}>Sortear</Text>
                </TouchableOpacity>
              ) : (
                <TouchableOpacity style={styles.execBtn} onPress={() => executeActive(p)} disabled={busy} testID={`exec-active-${p.prize_id}`}>
                  {busy ? <ActivityIndicator color={COLORS.white} /> : (
                    <>
                      <Ionicons name="dice" size={16} color={COLORS.white} />
                      <Text style={styles.execText}>Sortear</Text>
                    </>
                  )}
                </TouchableOpacity>
              )}
            </View>
          ))}

          <Text style={[styles.section, { marginTop: 24 }]}>Historial de Sorteos</Text>
          {history.length === 0 ? (
            <View style={styles.empty}><Text style={styles.emptyText}>Aún no hay sorteos ejecutados</Text></View>
          ) : history.map((r: any) => (
            <TouchableOpacity key={r.raffle_id} style={styles.hcard} onPress={() => setDetail(r)} testID={`history-raffle-${r.raffle_id}`}>
              <View style={{ flex: 1 }}>
                <Text style={styles.hname}>{r.prize_name}</Text>
                <Text style={styles.htype}>{r.prize_type === "weekly" ? "Semanal" : "Usuarios activos"} · {String(r.date).slice(0, 10)}</Text>
                <Text style={styles.hwinner}>🏆 {r.winner?.name} ({r.winner?.email})</Text>
                <Text style={styles.hpart}>{r.participants?.length ?? 0} participantes</Text>
              </View>
              <Ionicons name="chevron-forward" size={20} color={COLORS.textMuted} />
            </TouchableOpacity>
          ))}
        </ScrollView>
      )}

      {toast && <View style={styles.toast}><Text style={styles.toastText}>{toast}</Text></View>}

      <Modal visible={nValueModal.open} transparent animationType="slide" onRequestClose={() => setNValueModal({ prize: null, open: false })}>
        <View style={styles.modalWrap}>
          <View style={styles.modal}>
            <Text style={styles.modalTitle}>Sorteo semanal</Text>
            <Text style={styles.modalDesc}>
              El sistema seleccionará los N usuarios con mayor puntaje semanal y elegirá aleatoriamente un ganador.
            </Text>
            <Text style={styles.label}>Valor de N</Text>
            <TextInput
              value={n}
              onChangeText={setN}
              keyboardType="number-pad"
              style={styles.input}
              testID="n-value-input"
              placeholderTextColor={COLORS.textMuted}
            />
            <View style={{ flexDirection: "row", gap: 10, marginTop: 10 }}>
              <TouchableOpacity style={[styles.btnGhost, { flex: 1 }]} onPress={() => setNValueModal({ prize: null, open: false })}>
                <Text style={styles.btnGhostText}>Cancelar</Text>
              </TouchableOpacity>
              <TouchableOpacity style={[styles.btnPrimary, { flex: 1 }]} onPress={executeWeekly} disabled={busy} testID="confirm-weekly-raffle">
                {busy ? <ActivityIndicator color={COLORS.white} /> : <Text style={styles.btnPrimaryText}>Sortear</Text>}
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      <Modal visible={!!detail} transparent animationType="slide" onRequestClose={() => setDetail(null)}>
        <View style={styles.modalWrap}>
          <View style={[styles.modal, { maxHeight: "80%" }]}>
            <ScrollView>
              <Text style={styles.modalTitle}>{detail?.prize_name}</Text>
              <Text style={styles.modalDesc}>{detail?.prize_type === "weekly" ? "Sorteo Semanal" : "Sorteo Usuarios Activos"}</Text>
              <Text style={styles.label}>Ganador</Text>
              <View style={styles.winnerBox}>
                <Ionicons name="trophy" size={24} color={COLORS.accent} />
                <View>
                  <Text style={styles.winnerName}>{detail?.winner?.name}</Text>
                  <Text style={styles.winnerEmail}>{detail?.winner?.email}</Text>
                </View>
              </View>
              <Text style={[styles.label, { marginTop: 12 }]}>Participantes ({detail?.participants?.length ?? 0})</Text>
              {(detail?.participants ?? []).map((p: any, i: number) => (
                <View key={i} style={styles.partRow}>
                  <Text style={styles.partName}>{p.name}</Text>
                  {typeof p.points !== "undefined" && <Text style={styles.partPts}>{p.points} pts</Text>}
                </View>
              ))}
              <TouchableOpacity style={[styles.btnPrimary, { marginTop: 16 }]} onPress={() => setDetail(null)}>
                <Text style={styles.btnPrimaryText}>Cerrar</Text>
              </TouchableOpacity>
            </ScrollView>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: COLORS.surface },
  header: { padding: 20 },
  title: { fontSize: 26, fontWeight: "900", color: COLORS.primaryDark },
  section: { fontSize: 16, fontWeight: "800", color: COLORS.primaryDark, marginBottom: 10 },
  pcard: { flexDirection: "row", alignItems: "center", backgroundColor: COLORS.white, padding: 14, borderRadius: 14, marginBottom: 10, borderWidth: 1, borderColor: COLORS.border, gap: 12 },
  pname: { fontSize: 15, fontWeight: "800", color: COLORS.primaryDark },
  ptype: { fontSize: 12, color: COLORS.textMuted, marginTop: 2 },
  pdate: { fontSize: 12, color: COLORS.primary, marginTop: 4, fontWeight: "600" },
  execBtn: { flexDirection: "row", alignItems: "center", gap: 6, backgroundColor: COLORS.accent, paddingVertical: 10, paddingHorizontal: 14, borderRadius: 10 },
  execText: { color: COLORS.white, fontWeight: "800" },
  hcard: { flexDirection: "row", alignItems: "center", backgroundColor: COLORS.white, padding: 14, borderRadius: 14, marginBottom: 10, borderWidth: 1, borderColor: COLORS.border },
  hname: { fontSize: 15, fontWeight: "800", color: COLORS.primaryDark },
  htype: { fontSize: 12, color: COLORS.textMuted, marginTop: 2 },
  hwinner: { fontSize: 13, color: COLORS.accentDarker, marginTop: 4, fontWeight: "700" },
  hpart: { fontSize: 11, color: COLORS.textMuted, marginTop: 2 },
  empty: { padding: 20, backgroundColor: COLORS.white, borderRadius: 12, alignItems: "center" },
  emptyText: { color: COLORS.textMuted },
  modalWrap: { flex: 1, backgroundColor: COLORS.overlay, justifyContent: "flex-end" },
  modal: { backgroundColor: COLORS.white, borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 20, paddingBottom: 32 },
  modalTitle: { fontSize: 20, fontWeight: "900", color: COLORS.primaryDark, marginBottom: 6 },
  modalDesc: { fontSize: 13, color: COLORS.textSecondary, marginBottom: 14 },
  label: { fontSize: 12, color: COLORS.textMuted, textTransform: "uppercase", fontWeight: "700", marginBottom: 6 },
  input: { borderWidth: 1, borderColor: COLORS.border, borderRadius: 12, padding: 12, color: COLORS.textPrimary, backgroundColor: COLORS.surface },
  btnPrimary: { backgroundColor: COLORS.accent, padding: 14, borderRadius: 12, alignItems: "center" },
  btnPrimaryText: { color: COLORS.white, fontWeight: "800" },
  btnGhost: { padding: 14, borderRadius: 12, alignItems: "center", borderWidth: 1, borderColor: COLORS.border },
  btnGhostText: { color: COLORS.textPrimary, fontWeight: "700" },
  winnerBox: { flexDirection: "row", alignItems: "center", gap: 12, backgroundColor: COLORS.successBg, padding: 14, borderRadius: 14, borderWidth: 1, borderColor: COLORS.accent },
  winnerName: { fontSize: 16, fontWeight: "900", color: COLORS.accentDarker },
  winnerEmail: { fontSize: 12, color: COLORS.textSecondary },
  partRow: { flexDirection: "row", justifyContent: "space-between", padding: 10, backgroundColor: COLORS.surface, borderRadius: 8, marginBottom: 4 },
  partName: { color: COLORS.textPrimary, fontWeight: "600" },
  partPts: { color: COLORS.primary, fontWeight: "800" },
  toast: { position: "absolute", left: 20, right: 20, bottom: 20, backgroundColor: COLORS.primaryDark, padding: 14, borderRadius: 12 },
  toastText: { color: COLORS.white, textAlign: "center", fontWeight: "600" },
});
