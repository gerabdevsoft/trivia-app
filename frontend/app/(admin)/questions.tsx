import { useCallback, useEffect, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TextInput,
  TouchableOpacity,
  ActivityIndicator,
  Modal,
  KeyboardAvoidingView,
  Platform,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { COLORS } from "@/src/theme";
import { api } from "@/src/lib/api";

type Q = {
  id: string;
  statement: string;
  options: string[];
  correct_index: number;
  category: string;
  active: boolean;
};

export default function AdminQuestions() {
  const [tab, setTab] = useState<"bank" | "schedule">("bank");
  const [items, setItems] = useState<Q[]>([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<Q | null>(null);
  const [form, setForm] = useState({ statement: "", opt1: "", opt2: "", opt3: "", opt4: "", correct: 0, category: "General" });
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [settings, setSettings] = useState<any>(null);
  const [dailyCount, setDailyCount] = useState("5");

  const showToast = (msg: string) => { setToast(msg); setTimeout(() => setToast(null), 2500); };

  const load = useCallback(async () => {
    try {
      const [r, s, sched] = await Promise.all([
        api.adminListQuestions(),
        api.adminGetSettings(),
        api.adminGetSchedule(),
      ]);
      setItems(r.questions as any);
      setSettings(s);
      setDailyCount(String(s?.daily_questions_count ?? 5));
      setSelected(new Set(sched?.question_ids ?? []));
    } catch (e) { console.log(e); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { load(); }, [load]);

  const openCreate = () => {
    setEditing(null);
    setForm({ statement: "", opt1: "", opt2: "", opt3: "", opt4: "", correct: 0, category: "General" });
    setModalOpen(true);
  };
  const openEdit = (q: Q) => {
    setEditing(q);
    setForm({
      statement: q.statement,
      opt1: q.options[0] || "",
      opt2: q.options[1] || "",
      opt3: q.options[2] || "",
      opt4: q.options[3] || "",
      correct: q.correct_index,
      category: q.category,
    });
    setModalOpen(true);
  };

  const save = async () => {
    if (!form.statement.trim() || !form.opt1 || !form.opt2 || !form.opt3 || !form.opt4) {
      showToast("Completa todos los campos"); return;
    }
    setBusy(true);
    const payload = {
      statement: form.statement,
      options: [form.opt1, form.opt2, form.opt3, form.opt4],
      correct_index: form.correct,
      category: form.category || "General",
      active: true,
    };
    try {
      if (editing) await api.adminUpdateQuestion(editing.id, payload);
      else await api.adminCreateQuestion(payload);
      showToast("Guardado");
      setModalOpen(false);
      load();
    } catch (e: any) { showToast(e?.message || "Error"); }
    finally { setBusy(false); }
  };

  const toggleActive = async (q: Q) => {
    try { await api.adminUpdateQuestion(q.id, { active: !q.active }); load(); }
    catch (e: any) { showToast(e?.message); }
  };

  const remove = async (q: Q) => {
    try { await api.adminDeleteQuestion(q.id); load(); showToast("Eliminada"); }
    catch (e: any) { showToast(e?.message); }
  };

  const toggleSelect = (id: string) => {
    const next = new Set(selected);
    if (next.has(id)) next.delete(id); else next.add(id);
    setSelected(next);
  };

  const publish = async () => {
    if (selected.size === 0) { showToast("Selecciona preguntas"); return; }
    setBusy(true);
    try {
      const r = await api.adminSetSchedule(Array.from(selected));
      showToast(`Publicadas ${r.count} preguntas del día`);
    } catch (e: any) { showToast(e?.message); }
    finally { setBusy(false); }
  };

  const saveSettings = async () => {
    const n = parseInt(dailyCount, 10);
    if (!n || n < 1) return;
    try { await api.adminUpdateSettings({ daily_questions_count: n }); showToast("Actualizado"); }
    catch (e: any) { showToast(e?.message); }
  };

  return (
    <SafeAreaView style={styles.root} edges={["top"]}>
      <View style={styles.header}>
        <Text style={styles.title} testID="admin-questions-title">Preguntas</Text>
        <TouchableOpacity style={styles.addBtn} onPress={openCreate} testID="new-question-button">
          <Ionicons name="add" size={20} color={COLORS.white} />
          <Text style={styles.addBtnText}>Nueva</Text>
        </TouchableOpacity>
      </View>

      <View style={styles.tabs}>
        <TouchableOpacity onPress={() => setTab("bank")} style={[styles.tabBtn, tab === "bank" && styles.tabActive]} testID="tab-bank">
          <Text style={[styles.tabText, tab === "bank" && styles.tabTextActive]}>Banco</Text>
        </TouchableOpacity>
        <TouchableOpacity onPress={() => setTab("schedule")} style={[styles.tabBtn, tab === "schedule" && styles.tabActive]} testID="tab-schedule">
          <Text style={[styles.tabText, tab === "schedule" && styles.tabTextActive]}>Programar hoy ({selected.size})</Text>
        </TouchableOpacity>
      </View>

      {loading ? (
        <ActivityIndicator color={COLORS.primary} style={{ marginTop: 30 }} />
      ) : tab === "bank" ? (
        <ScrollView contentContainerStyle={{ padding: 20, paddingBottom: 40 }}>
          {items.length === 0 ? (
            <Text style={styles.emptyText}>No hay preguntas. Crea la primera.</Text>
          ) : items.map((q) => (
            <View key={q.id} style={styles.qcard} testID={`admin-q-${q.id}`}>
              <View style={styles.qHeader}>
                <View style={[styles.tag, { backgroundColor: q.active ? COLORS.successBg : COLORS.errorBg }]}>
                  <Text style={[styles.tagText, { color: q.active ? COLORS.accentDarker : COLORS.error }]}>
                    {q.active ? "Activa" : "Inactiva"}
                  </Text>
                </View>
                <Text style={styles.cat}>{q.category}</Text>
              </View>
              <Text style={styles.statement}>{q.statement}</Text>
              <View style={styles.opts}>
                {q.options.map((o, i) => (
                  <Text key={i} style={[styles.opt, i === q.correct_index && styles.optCorrect]}>
                    {i === q.correct_index ? "✓ " : "• "}{o}
                  </Text>
                ))}
              </View>
              <View style={styles.actions}>
                <TouchableOpacity onPress={() => openEdit(q)} style={styles.actionBtn} testID={`edit-q-${q.id}`}>
                  <Ionicons name="pencil" size={16} color={COLORS.primary} />
                  <Text style={styles.actionText}>Editar</Text>
                </TouchableOpacity>
                <TouchableOpacity onPress={() => toggleActive(q)} style={styles.actionBtn} testID={`toggle-q-${q.id}`}>
                  <Ionicons name={q.active ? "pause" : "play"} size={16} color={COLORS.primaryLight} />
                  <Text style={styles.actionText}>{q.active ? "Desactivar" : "Activar"}</Text>
                </TouchableOpacity>
                <TouchableOpacity onPress={() => remove(q)} style={styles.actionBtn} testID={`del-q-${q.id}`}>
                  <Ionicons name="trash" size={16} color={COLORS.error} />
                  <Text style={[styles.actionText, { color: COLORS.error }]}>Borrar</Text>
                </TouchableOpacity>
              </View>
            </View>
          ))}
        </ScrollView>
      ) : (
        <ScrollView contentContainerStyle={{ padding: 20, paddingBottom: 40 }}>
          <View style={styles.settingsCard}>
            <Text style={styles.settingsLabel}>Cantidad de preguntas diarias (X)</Text>
            <View style={styles.settingsRow}>
              <TextInput
                value={dailyCount}
                onChangeText={setDailyCount}
                keyboardType="number-pad"
                style={styles.settingsInput}
                testID="daily-count-input"
              />
              <TouchableOpacity onPress={saveSettings} style={styles.saveBtn} testID="save-settings">
                <Text style={styles.saveBtnText}>Guardar</Text>
              </TouchableOpacity>
            </View>
          </View>

          <Text style={styles.helperText}>
            Selecciona {settings?.daily_questions_count ?? 5} preguntas activas para el día. Al publicar se enviará una notificación push.
          </Text>

          {items.filter(q => q.active).map((q) => {
            const isSel = selected.has(q.id);
            return (
              <TouchableOpacity
                key={q.id}
                onPress={() => toggleSelect(q.id)}
                style={[styles.selCard, isSel && styles.selCardActive]}
                testID={`sel-q-${q.id}`}
              >
                <Ionicons name={isSel ? "checkmark-circle" : "ellipse-outline"} size={22} color={isSel ? COLORS.accent : COLORS.textMuted} />
                <View style={{ flex: 1 }}>
                  <Text style={styles.selStatement}>{q.statement}</Text>
                  <Text style={styles.selCat}>{q.category}</Text>
                </View>
              </TouchableOpacity>
            );
          })}

          <TouchableOpacity style={styles.publishBtn} onPress={publish} disabled={busy} testID="publish-button">
            {busy ? <ActivityIndicator color={COLORS.white} /> : (
              <>
                <Ionicons name="send" size={18} color={COLORS.white} />
                <Text style={styles.publishText}>Publicar preguntas del día</Text>
              </>
            )}
          </TouchableOpacity>
        </ScrollView>
      )}

      {toast && <View style={styles.toast}><Text style={styles.toastText}>{toast}</Text></View>}

      <Modal visible={modalOpen} transparent animationType="slide" onRequestClose={() => setModalOpen(false)}>
        <KeyboardAvoidingView style={styles.modalWrap} behavior={Platform.OS === "ios" ? "padding" : undefined}>
          <View style={styles.modal}>
            <ScrollView>
              <Text style={styles.modalTitle}>{editing ? "Editar pregunta" : "Nueva pregunta"}</Text>
              <TextInput placeholder="Enunciado" value={form.statement} onChangeText={(v) => setForm({ ...form, statement: v })} style={[styles.input, { minHeight: 60 }]} multiline testID="q-statement" placeholderTextColor={COLORS.textMuted} />
              <TextInput placeholder="Categoría" value={form.category} onChangeText={(v) => setForm({ ...form, category: v })} style={styles.input} testID="q-category" placeholderTextColor={COLORS.textMuted} />
              {[0, 1, 2, 3].map((i) => (
                <View key={i} style={styles.optRow}>
                  <TouchableOpacity onPress={() => setForm({ ...form, correct: i })} testID={`q-correct-${i}`}>
                    <Ionicons name={form.correct === i ? "radio-button-on" : "radio-button-off"} size={22} color={form.correct === i ? COLORS.accent : COLORS.textMuted} />
                  </TouchableOpacity>
                  <TextInput
                    placeholder={`Opción ${i + 1}`}
                    value={(form as any)[`opt${i + 1}`]}
                    onChangeText={(v) => setForm({ ...form, [`opt${i + 1}`]: v } as any)}
                    style={[styles.input, { flex: 1, marginBottom: 0 }]}
                    testID={`q-opt-${i}`}
                    placeholderTextColor={COLORS.textMuted}
                  />
                </View>
              ))}
              <View style={{ flexDirection: "row", gap: 10, marginTop: 12 }}>
                <TouchableOpacity onPress={() => setModalOpen(false)} style={[styles.btnGhost, { flex: 1 }]}>
                  <Text style={styles.btnGhostText}>Cancelar</Text>
                </TouchableOpacity>
                <TouchableOpacity onPress={save} disabled={busy} style={[styles.btnPrimary, { flex: 1 }]} testID="save-question">
                  {busy ? <ActivityIndicator color={COLORS.white} /> : <Text style={styles.btnPrimaryText}>Guardar</Text>}
                </TouchableOpacity>
              </View>
            </ScrollView>
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: COLORS.surface },
  header: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", padding: 20 },
  title: { fontSize: 26, fontWeight: "900", color: COLORS.primaryDark },
  addBtn: { flexDirection: "row", alignItems: "center", gap: 4, backgroundColor: COLORS.primary, paddingVertical: 8, paddingHorizontal: 14, borderRadius: 10 },
  addBtnText: { color: COLORS.white, fontWeight: "700" },
  tabs: { flexDirection: "row", paddingHorizontal: 20, gap: 8, marginBottom: 8 },
  tabBtn: { paddingVertical: 8, paddingHorizontal: 14, borderRadius: 10, backgroundColor: COLORS.white, borderWidth: 1, borderColor: COLORS.border },
  tabActive: { backgroundColor: COLORS.primaryDark, borderColor: COLORS.primaryDark },
  tabText: { color: COLORS.textSecondary, fontWeight: "700", fontSize: 13 },
  tabTextActive: { color: COLORS.white },
  qcard: { backgroundColor: COLORS.white, borderRadius: 16, padding: 14, marginBottom: 10, borderWidth: 1, borderColor: COLORS.border },
  qHeader: { flexDirection: "row", justifyContent: "space-between", marginBottom: 8 },
  tag: { paddingVertical: 3, paddingHorizontal: 8, borderRadius: 8 },
  tagText: { fontSize: 10, fontWeight: "800", textTransform: "uppercase" },
  cat: { color: COLORS.textMuted, fontSize: 12, fontWeight: "700", textTransform: "uppercase" },
  statement: { fontSize: 15, color: COLORS.textPrimary, fontWeight: "600" },
  opts: { marginTop: 8, gap: 3 },
  opt: { fontSize: 13, color: COLORS.textSecondary },
  optCorrect: { color: COLORS.accentDarker, fontWeight: "700" },
  actions: { flexDirection: "row", gap: 12, marginTop: 10 },
  actionBtn: { flexDirection: "row", alignItems: "center", gap: 4 },
  actionText: { fontSize: 12, color: COLORS.primary, fontWeight: "700" },
  emptyText: { textAlign: "center", color: COLORS.textMuted, marginTop: 20 },
  settingsCard: { backgroundColor: COLORS.white, padding: 16, borderRadius: 14, borderWidth: 1, borderColor: COLORS.border, marginBottom: 16 },
  settingsLabel: { fontSize: 13, color: COLORS.textMuted, fontWeight: "700", textTransform: "uppercase", marginBottom: 8 },
  settingsRow: { flexDirection: "row", gap: 8 },
  settingsInput: { flex: 1, borderWidth: 1, borderColor: COLORS.border, borderRadius: 10, padding: 10, backgroundColor: COLORS.surface, color: COLORS.textPrimary },
  saveBtn: { backgroundColor: COLORS.primary, paddingHorizontal: 16, borderRadius: 10, justifyContent: "center" },
  saveBtnText: { color: COLORS.white, fontWeight: "700" },
  helperText: { color: COLORS.textSecondary, marginBottom: 12, fontSize: 13 },
  selCard: { flexDirection: "row", alignItems: "center", gap: 12, backgroundColor: COLORS.white, padding: 12, borderRadius: 12, marginBottom: 8, borderWidth: 1, borderColor: COLORS.border },
  selCardActive: { borderColor: COLORS.accent, backgroundColor: COLORS.successBg },
  selStatement: { fontSize: 14, color: COLORS.textPrimary, fontWeight: "600" },
  selCat: { fontSize: 11, color: COLORS.textMuted, textTransform: "uppercase", fontWeight: "700", marginTop: 2 },
  publishBtn: { marginTop: 16, backgroundColor: COLORS.accent, padding: 16, borderRadius: 14, alignItems: "center", flexDirection: "row", justifyContent: "center", gap: 8 },
  publishText: { color: COLORS.white, fontWeight: "800", fontSize: 15 },
  modalWrap: { flex: 1, backgroundColor: COLORS.overlay, justifyContent: "flex-end" },
  modal: { backgroundColor: COLORS.white, borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 20, paddingBottom: 32, maxHeight: "90%" },
  modalTitle: { fontSize: 20, fontWeight: "900", color: COLORS.primaryDark, marginBottom: 12 },
  input: { borderWidth: 1, borderColor: COLORS.border, borderRadius: 12, padding: 12, marginBottom: 10, color: COLORS.textPrimary, backgroundColor: COLORS.surface },
  optRow: { flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 10 },
  btnPrimary: { backgroundColor: COLORS.primary, padding: 14, borderRadius: 12, alignItems: "center" },
  btnPrimaryText: { color: COLORS.white, fontWeight: "800" },
  btnGhost: { padding: 14, borderRadius: 12, alignItems: "center", borderWidth: 1, borderColor: COLORS.border },
  btnGhostText: { color: COLORS.textPrimary, fontWeight: "700" },
  toast: { position: "absolute", left: 20, right: 20, bottom: 20, backgroundColor: COLORS.primaryDark, padding: 14, borderRadius: 12 },
  toastText: { color: COLORS.white, textAlign: "center", fontWeight: "600" },
});
