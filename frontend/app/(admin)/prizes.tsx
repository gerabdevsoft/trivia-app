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
  Image,
  KeyboardAvoidingView,
  Platform,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import * as ImagePicker from "expo-image-picker";
import { COLORS } from "@/src/theme";
import { api } from "@/src/lib/api";

export default function AdminPrizes() {
  const [prizes, setPrizes] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<any | null>(null);
  const [form, setForm] = useState<{ name: string; description: string; prize_type: "weekly" | "active"; draw_date: string; image_base64: string | null; image_content_type: string }>({
    name: "",
    description: "",
    prize_type: "weekly",
    draw_date: "",
    image_base64: null,
    image_content_type: "image/jpeg",
  });
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const showToast = (m: string) => { setToast(m); setTimeout(() => setToast(null), 2500); };

  const load = useCallback(async () => {
    try { const r = await api.adminListPrizes(); setPrizes(r.prizes as any); }
    catch (e) { console.log(e); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { load(); }, [load]);

  const openCreate = () => {
    setEditing(null);
    setForm({ name: "", description: "", prize_type: "weekly", draw_date: "", image_base64: null, image_content_type: "image/jpeg" });
    setModalOpen(true);
  };
  const openEdit = (p: any) => {
    setEditing(p);
    setForm({
      name: p.name,
      description: p.description || "",
      prize_type: p.prize_type,
      draw_date: p.draw_date || "",
      image_base64: null,
      image_content_type: "image/jpeg",
    });
    setModalOpen(true);
  };

  const pickImage = async () => {
    const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (status !== "granted") { showToast("Permiso denegado"); return; }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      quality: 0.6,
      base64: true,
    });
    if (!result.canceled && result.assets?.[0]) {
      const a = result.assets[0];
      setForm({ ...form, image_base64: a.base64 || null, image_content_type: a.mimeType || "image/jpeg" });
    }
  };

  const save = async () => {
    if (!form.name.trim()) { showToast("Nombre requerido"); return; }
    setBusy(true);
    try {
      const payload: any = {
        name: form.name,
        description: form.description,
        prize_type: form.prize_type,
        draw_date: form.draw_date || undefined,
      };
      if (form.image_base64) {
        payload.image_base64 = form.image_base64;
        payload.image_content_type = form.image_content_type;
      }
      if (editing) await api.adminUpdatePrize(editing.prize_id, payload);
      else await api.adminCreatePrize(payload);
      showToast("Guardado");
      setModalOpen(false);
      load();
    } catch (e: any) { showToast(e?.message || "Error"); }
    finally { setBusy(false); }
  };

  const remove = async (p: any) => {
    try { await api.adminDeletePrize(p.prize_id); load(); showToast("Eliminado"); }
    catch (e: any) { showToast(e?.message); }
  };

  return (
    <SafeAreaView style={styles.root} edges={["top"]}>
      <View style={styles.header}>
        <Text style={styles.title} testID="admin-prizes-title">Premios</Text>
        <TouchableOpacity style={styles.addBtn} onPress={openCreate} testID="new-prize-button">
          <Ionicons name="add" size={20} color={COLORS.white} />
          <Text style={styles.addBtnText}>Nuevo</Text>
        </TouchableOpacity>
      </View>
      {loading ? <ActivityIndicator color={COLORS.primary} style={{ marginTop: 30 }} /> : (
        <ScrollView contentContainerStyle={{ padding: 20, paddingBottom: 40 }}>
          {prizes.length === 0 ? (
            <Text style={styles.empty}>Crea el primer premio</Text>
          ) : prizes.map((p) => (
            <View key={p.prize_id} style={styles.card} testID={`admin-prize-${p.prize_id}`}>
              {p.has_image ? (
                <Image source={{ uri: api.prizeImageUrl(p.prize_id) }} style={styles.image} />
              ) : (
                <View style={[styles.image, styles.imgPlaceholder]}>
                  <Ionicons name="image-outline" size={40} color={COLORS.textMuted} />
                </View>
              )}
              <View style={{ flex: 1, padding: 12 }}>
                <View style={styles.rowBetween}>
                  <View style={[styles.tag, { backgroundColor: p.prize_type === "weekly" ? COLORS.surfaceAlt : COLORS.successBg }]}>
                    <Text style={[styles.tagText, { color: p.prize_type === "weekly" ? COLORS.primary : COLORS.accentDarker }]}>
                      {p.prize_type === "weekly" ? "Semanal" : "Activos"}
                    </Text>
                  </View>
                  {p.executed && (
                    <View style={[styles.tag, { backgroundColor: COLORS.surface }]}>
                      <Text style={[styles.tagText, { color: COLORS.textMuted }]}>Sorteado</Text>
                    </View>
                  )}
                </View>
                <Text style={styles.pname}>{p.name}</Text>
                {!!p.description && <Text style={styles.pdesc} numberOfLines={2}>{p.description}</Text>}
                {!!p.draw_date && <Text style={styles.pdate}>Fecha: {p.draw_date}</Text>}
                <View style={styles.actions}>
                  {!p.executed && (
                    <TouchableOpacity onPress={() => openEdit(p)} style={styles.actionBtn} testID={`edit-prize-${p.prize_id}`}>
                      <Ionicons name="pencil" size={14} color={COLORS.primary} />
                      <Text style={styles.actionText}>Editar</Text>
                    </TouchableOpacity>
                  )}
                  <TouchableOpacity onPress={() => remove(p)} style={styles.actionBtn} testID={`del-prize-${p.prize_id}`}>
                    <Ionicons name="trash" size={14} color={COLORS.error} />
                    <Text style={[styles.actionText, { color: COLORS.error }]}>Borrar</Text>
                  </TouchableOpacity>
                </View>
              </View>
            </View>
          ))}
        </ScrollView>
      )}

      {toast && <View style={styles.toast}><Text style={styles.toastText}>{toast}</Text></View>}

      <Modal visible={modalOpen} transparent animationType="slide" onRequestClose={() => setModalOpen(false)}>
        <KeyboardAvoidingView style={styles.modalWrap} behavior={Platform.OS === "ios" ? "padding" : undefined}>
          <View style={styles.modal}>
            <ScrollView>
              <Text style={styles.modalTitle}>{editing ? "Editar premio" : "Nuevo premio"}</Text>
              <TextInput placeholder="Nombre" value={form.name} onChangeText={(v) => setForm({ ...form, name: v })} style={styles.input} testID="prize-name" placeholderTextColor={COLORS.textMuted} />
              <TextInput placeholder="Descripción" value={form.description} onChangeText={(v) => setForm({ ...form, description: v })} style={[styles.input, { minHeight: 60 }]} multiline testID="prize-description" placeholderTextColor={COLORS.textMuted} />
              <TextInput placeholder="Fecha (YYYY-MM-DD)" value={form.draw_date} onChangeText={(v) => setForm({ ...form, draw_date: v })} style={styles.input} testID="prize-date" placeholderTextColor={COLORS.textMuted} />
              <View style={styles.typeRow}>
                <TouchableOpacity style={[styles.typeBtn, form.prize_type === "weekly" && styles.typeBtnActive]} onPress={() => setForm({ ...form, prize_type: "weekly" })} testID="type-weekly">
                  <Text style={[styles.typeText, form.prize_type === "weekly" && styles.typeTextActive]}>Semanal</Text>
                </TouchableOpacity>
                <TouchableOpacity style={[styles.typeBtn, form.prize_type === "active" && styles.typeBtnActive]} onPress={() => setForm({ ...form, prize_type: "active" })} testID="type-active">
                  <Text style={[styles.typeText, form.prize_type === "active" && styles.typeTextActive]}>Usuarios Activos</Text>
                </TouchableOpacity>
              </View>
              <TouchableOpacity style={styles.pickBtn} onPress={pickImage} testID="pick-image">
                <Ionicons name="image" size={20} color={COLORS.primary} />
                <Text style={styles.pickBtnText}>{form.image_base64 ? "Imagen seleccionada ✓" : "Seleccionar imagen"}</Text>
              </TouchableOpacity>
              <View style={{ flexDirection: "row", gap: 10, marginTop: 8 }}>
                <TouchableOpacity onPress={() => setModalOpen(false)} style={[styles.btnGhost, { flex: 1 }]}>
                  <Text style={styles.btnGhostText}>Cancelar</Text>
                </TouchableOpacity>
                <TouchableOpacity onPress={save} disabled={busy} style={[styles.btnPrimary, { flex: 1 }]} testID="save-prize">
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
  card: { flexDirection: "row", backgroundColor: COLORS.white, borderRadius: 16, marginBottom: 12, borderWidth: 1, borderColor: COLORS.border, overflow: "hidden" },
  image: { width: 100, height: 130, backgroundColor: COLORS.surface },
  imgPlaceholder: { alignItems: "center", justifyContent: "center" },
  rowBetween: { flexDirection: "row", justifyContent: "space-between", marginBottom: 6, gap: 6 },
  tag: { paddingVertical: 3, paddingHorizontal: 8, borderRadius: 8 },
  tagText: { fontSize: 10, fontWeight: "800", textTransform: "uppercase" },
  pname: { fontSize: 16, fontWeight: "800", color: COLORS.primaryDark },
  pdesc: { fontSize: 13, color: COLORS.textSecondary, marginTop: 3 },
  pdate: { fontSize: 12, color: COLORS.primary, marginTop: 4, fontWeight: "600" },
  actions: { flexDirection: "row", gap: 14, marginTop: 8 },
  actionBtn: { flexDirection: "row", alignItems: "center", gap: 4 },
  actionText: { fontSize: 12, color: COLORS.primary, fontWeight: "700" },
  empty: { textAlign: "center", color: COLORS.textMuted, marginTop: 20 },
  modalWrap: { flex: 1, backgroundColor: COLORS.overlay, justifyContent: "flex-end" },
  modal: { backgroundColor: COLORS.white, borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 20, paddingBottom: 32, maxHeight: "90%" },
  modalTitle: { fontSize: 20, fontWeight: "900", color: COLORS.primaryDark, marginBottom: 12 },
  input: { borderWidth: 1, borderColor: COLORS.border, borderRadius: 12, padding: 12, marginBottom: 10, color: COLORS.textPrimary, backgroundColor: COLORS.surface },
  typeRow: { flexDirection: "row", gap: 8, marginBottom: 10 },
  typeBtn: { flex: 1, padding: 12, borderRadius: 10, borderWidth: 1, borderColor: COLORS.border, alignItems: "center" },
  typeBtnActive: { backgroundColor: COLORS.primaryDark, borderColor: COLORS.primaryDark },
  typeText: { color: COLORS.textPrimary, fontWeight: "700" },
  typeTextActive: { color: COLORS.white },
  pickBtn: { flexDirection: "row", alignItems: "center", gap: 8, padding: 12, borderRadius: 12, borderWidth: 1, borderColor: COLORS.primary, borderStyle: "dashed", marginBottom: 12, justifyContent: "center" },
  pickBtnText: { color: COLORS.primary, fontWeight: "700" },
  btnPrimary: { backgroundColor: COLORS.primary, padding: 14, borderRadius: 12, alignItems: "center" },
  btnPrimaryText: { color: COLORS.white, fontWeight: "800" },
  btnGhost: { padding: 14, borderRadius: 12, alignItems: "center", borderWidth: 1, borderColor: COLORS.border },
  btnGhostText: { color: COLORS.textPrimary, fontWeight: "700" },
  toast: { position: "absolute", left: 20, right: 20, bottom: 20, backgroundColor: COLORS.primaryDark, padding: 14, borderRadius: 12 },
  toastText: { color: COLORS.white, textAlign: "center", fontWeight: "600" },
});
