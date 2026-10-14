import { useCallback, useState } from "react";
import { useFocusEffect } from "expo-router";
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
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { KeyboardAwareScrollView } from "react-native-keyboard-controller";
import { Ionicons } from "@expo/vector-icons";
import * as ImagePicker from "expo-image-picker";
import { COLORS } from "@/src/theme";
import { api } from "@/src/lib/api";
import { formatDisplayDate, toDateInputValue } from "@/src/lib/date-format";

const WEEKDAY_LABELS = ["Lun", "Mar", "Mié", "Jue", "Vie", "Sáb", "Dom"];
const MONTH_LABELS = [
  "enero", "febrero", "marzo", "abril", "mayo", "junio",
  "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre",
];

export default function AdminPrizes() {
  const [prizes, setPrizes] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [modalOpen, setModalOpen] = useState(false);
  const [calendarOpen, setCalendarOpen] = useState(false);
  const [calendarMonth, setCalendarMonth] = useState(() => {
    const today = new Date();
    return new Date(today.getFullYear(), today.getMonth(), 1);
  });
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
  const firstDayOffset = (calendarMonth.getDay() + 6) % 7;
  const daysInMonth = new Date(calendarMonth.getFullYear(), calendarMonth.getMonth() + 1, 0).getDate();
  const calendarDays: (number | null)[] = [
    ...Array.from({ length: firstDayOffset }, () => null),
    ...Array.from({ length: daysInMonth }, (_, index) => index + 1),
  ];
  const calendarMonthLabel = `${MONTH_LABELS[calendarMonth.getMonth()][0].toUpperCase()}${MONTH_LABELS[calendarMonth.getMonth()].slice(1)} ${calendarMonth.getFullYear()}`;
  const todayDate = toDateInputValue(new Date());

  const load = useCallback(async () => {
    try { const r = await api.adminListPrizes(); setPrizes(r.prizes as any); }
    catch (e) { console.log(e); }
    finally { setLoading(false); }
  }, []);
  useFocusEffect(useCallback(() => { void load(); }, [load]));

  const openCreate = () => {
    setEditing(null);
    setCalendarOpen(false);
    setForm({ name: "", description: "", prize_type: "weekly", draw_date: "", image_base64: null, image_content_type: "image/jpeg" });
    setModalOpen(true);
  };
  const openEdit = (p: any) => {
    setEditing(p);
    setCalendarOpen(false);
    setForm({
      name: p.name,
      description: p.description || "",
      prize_type: p.prize_type,
      draw_date: toDateInputValue(p.draw_date),
      image_base64: null,
      image_content_type: "image/jpeg",
    });
    setModalOpen(true);
  };
  const openCalendar = () => {
    const isoDate = toDateInputValue(form.draw_date);
    const [year, month, day] = isoDate ? isoDate.split("-").map(Number) : [];
    const anchor = isoDate ? new Date(year, month - 1, day) : new Date();
    setCalendarMonth(new Date(anchor.getFullYear(), anchor.getMonth(), 1));
    setCalendarOpen(true);
  };
  const selectCalendarDay = (day: number) => {
    const date = new Date(calendarMonth.getFullYear(), calendarMonth.getMonth(), day);
    setForm((current) => ({ ...current, draw_date: toDateInputValue(date) }));
    setCalendarOpen(false);
  };

  const pickImage = async () => {    
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
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
      await load();
    } catch (e: any) { showToast(e?.message || "Error"); }
    finally { setBusy(false); }
  };

  const remove = async (p: any) => {
    try { await api.adminDeletePrize(p.prize_id); await load(); showToast("Eliminado"); }
    catch (e: any) { showToast(e?.message); }
  };

  return (
    <SafeAreaView style={styles.root} edges={["top"]}>
      <View style={styles.header}>
        <Text style={styles.title} testID="admin-prizes-title">
          Premios
        </Text>
        <TouchableOpacity
          style={styles.addBtn}
          onPress={openCreate}
          testID="new-prize-button"
        >
          <Ionicons name="add" size={20} color={COLORS.white} />
          <Text style={styles.addBtnText}>Nuevo</Text>
        </TouchableOpacity>
      </View>
      {loading ? (
        <ActivityIndicator color={COLORS.primary} style={{ marginTop: 30 }} />
      ) : (
        <ScrollView contentContainerStyle={{ padding: 20, paddingBottom: 40 }}>
          {prizes.length === 0 ? (
            <Text style={styles.empty}>Crea el primer premio</Text>
          ) : (
            prizes.map((p) => (
              <View
                key={p.prize_id}
                style={styles.card}
                testID={`admin-prize-${p.prize_id}`}
              >
                {p.has_image ? (
                  <Image
                    source={{ uri: api.prizeImageUrl(p.prize_id) }}
                    style={styles.image}
                  />
                ) : (
                  <View style={[styles.image, styles.imgPlaceholder]}>
                    <Ionicons
                      name="image-outline"
                      size={40}
                      color={COLORS.textMuted}
                    />
                  </View>
                )}
                <View style={{ flex: 1, padding: 12 }}>
                  <View style={styles.rowBetween}>
                    <View
                      style={[
                        styles.tag,
                        {
                          backgroundColor:
                            p.prize_type === "weekly"
                              ? COLORS.surfaceAlt
                              : COLORS.successBg,
                        },
                      ]}
                    >
                      <Text
                        style={[
                          styles.tagText,
                          {
                            color:
                              p.prize_type === "weekly"
                                ? COLORS.primary
                                : COLORS.accentDarker,
                          },
                        ]}
                      >
                        {p.prize_type === "weekly" ? "Semanal" : "Activos"}
                      </Text>
                    </View>
                    {p.executed && (
                      <View
                        style={[
                          styles.tag,
                          { backgroundColor: COLORS.surface },
                        ]}
                      >
                        <Text
                          style={[styles.tagText, { color: COLORS.textMuted }]}
                        >
                          Sorteado
                        </Text>
                      </View>
                    )}
                  </View>
                  <Text style={styles.pname}>{p.name}</Text>
                  {!!p.description && (
                    <Text style={styles.pdesc} numberOfLines={2}>
                      {p.description}
                    </Text>
                  )}
                  {!!p.draw_date && (
                    <Text style={styles.pdate}>Fecha: {formatDisplayDate(p.draw_date)}</Text>
                  )}
                  <View style={styles.actions}>
                    {!p.executed && (
                      <TouchableOpacity
                        onPress={() => openEdit(p)}
                        style={styles.actionBtn}
                        testID={`edit-prize-${p.prize_id}`}
                      >
                        <Ionicons
                          name="pencil"
                          size={14}
                          color={COLORS.primary}
                        />
                        <Text style={styles.actionText}>Editar</Text>
                      </TouchableOpacity>
                    )}
                    <TouchableOpacity
                      onPress={() => remove(p)}
                      style={styles.actionBtn}
                      testID={`del-prize-${p.prize_id}`}
                    >
                      <Ionicons name="trash" size={14} color={COLORS.error} />
                      <Text
                        style={[styles.actionText, { color: COLORS.error }]}
                      >
                        Borrar
                      </Text>
                    </TouchableOpacity>
                  </View>
                </View>
              </View>
            ))
          )}
        </ScrollView>
      )}

      {toast && (
        <View style={styles.toast}>
          <Text style={styles.toastText}>{toast}</Text>
        </View>
      )}

      <Modal
        visible={modalOpen}
        transparent
        animationType="slide"
        onRequestClose={() => setModalOpen(false)}
      >
        <View style={styles.modalWrap}>
          <View style={styles.modal}>
            <KeyboardAwareScrollView
              bottomOffset={20}
              keyboardShouldPersistTaps="handled"
              showsVerticalScrollIndicator={false}
            >
              <Text style={styles.modalTitle}>
                {editing ? "Editar premio" : "Nuevo premio"}
              </Text>
              <TextInput
                placeholder="Nombre"
                value={form.name}
                onChangeText={(v) => setForm({ ...form, name: v })}
                style={styles.input}
                testID="prize-name"
                placeholderTextColor={COLORS.textMuted}
              />
              <TextInput
                placeholder="Descripción"
                value={form.description}
                onChangeText={(v) => setForm({ ...form, description: v })}
                style={[styles.input, { minHeight: 60 }]}
                multiline
                testID="prize-description"
                placeholderTextColor={COLORS.textMuted}
              />
              <Text style={styles.fieldLabel}>Fecha del sorteo</Text>
              <TouchableOpacity
                style={styles.dateField}
                onPress={openCalendar}
                accessibilityRole="button"
                accessibilityLabel="Elegir fecha del sorteo"
                testID="prize-date"
              >
                <Text style={form.draw_date ? styles.dateValue : styles.datePlaceholder}>
                  {formatDisplayDate(form.draw_date) || "Seleccionar fecha (DD/MM/YYYY)"}
                </Text>
                <Ionicons name="calendar-outline" size={20} color={COLORS.primary} />
              </TouchableOpacity>
              {calendarOpen && (
                <View style={styles.calendarPanel} testID="prize-calendar">
                  <View style={styles.calendarNavigation}>
                    <TouchableOpacity
                      style={styles.calendarArrow}
                      onPress={() => setCalendarMonth((current) => new Date(current.getFullYear(), current.getMonth() - 1, 1))}
                      accessibilityRole="button"
                      accessibilityLabel="Mes anterior"
                      testID="calendar-previous-month"
                    >
                      <Ionicons name="chevron-back" size={20} color={COLORS.primaryDark} />
                    </TouchableOpacity>
                    <Text style={styles.calendarMonth}>{calendarMonthLabel}</Text>
                    <TouchableOpacity
                      style={styles.calendarArrow}
                      onPress={() => setCalendarMonth((current) => new Date(current.getFullYear(), current.getMonth() + 1, 1))}
                      accessibilityRole="button"
                      accessibilityLabel="Mes siguiente"
                      testID="calendar-next-month"
                    >
                      <Ionicons name="chevron-forward" size={20} color={COLORS.primaryDark} />
                    </TouchableOpacity>
                  </View>
                  <View style={styles.calendarWeekdays}>
                    {WEEKDAY_LABELS.map((weekday) => (
                      <Text key={weekday} style={styles.calendarWeekday}>{weekday}</Text>
                    ))}
                  </View>
                  <View style={styles.calendarGrid}>
                    {calendarDays.map((day, index) => {
                      if (day === null) {
                        return <View key={`empty-${index}`} style={styles.calendarDayCell} />;
                      }
                      const date = new Date(calendarMonth.getFullYear(), calendarMonth.getMonth(), day);
                      const dateValue = toDateInputValue(date);
                      const selected = form.draw_date === dateValue;
                      const isToday = todayDate === dateValue;
                      return (
                        <TouchableOpacity
                          key={dateValue}
                          style={[
                            styles.calendarDayCell,
                            selected && styles.calendarDayCellSelected,
                            !selected && isToday && styles.calendarDayCellToday,
                          ]}
                          onPress={() => selectCalendarDay(day)}
                          accessibilityRole="button"
                          accessibilityLabel={formatDisplayDate(dateValue)}
                          accessibilityState={{ selected }}
                          testID={`calendar-day-${dateValue}`}
                        >
                          <Text style={[styles.calendarDayText, selected && styles.calendarDayTextSelected]}>{day}</Text>
                        </TouchableOpacity>
                      );
                    })}
                  </View>
                  {!!form.draw_date && (
                    <TouchableOpacity
                      style={styles.clearDateButton}
                      onPress={() => setForm((current) => ({ ...current, draw_date: "" }))}
                      accessibilityRole="button"
                      testID="clear-prize-date"
                    >
                      <Text style={styles.clearDateText}>Quitar fecha</Text>
                    </TouchableOpacity>
                  )}
                </View>
              )}
              <View style={styles.typeRow}>
                <TouchableOpacity
                  style={[
                    styles.typeBtn,
                    form.prize_type === "weekly" && styles.typeBtnActive,
                  ]}
                  onPress={() => setForm({ ...form, prize_type: "weekly" })}
                  testID="type-weekly"
                >
                  <Text
                    style={[
                      styles.typeText,
                      form.prize_type === "weekly" && styles.typeTextActive,
                    ]}
                  >
                    Semanal
                  </Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[
                    styles.typeBtn,
                    form.prize_type === "active" && styles.typeBtnActive,
                  ]}
                  onPress={() => setForm({ ...form, prize_type: "active" })}
                  testID="type-active"
                >
                  <Text
                    style={[
                      styles.typeText,
                      form.prize_type === "active" && styles.typeTextActive,
                    ]}
                  >
                    Usuarios Activos
                  </Text>
                </TouchableOpacity>
              </View>
              <TouchableOpacity
                style={styles.pickBtn}
                onPress={pickImage}
                testID="pick-image"
              >
                <Ionicons name="image" size={20} color={COLORS.primary} />
                <Text style={styles.pickBtnText}>
                  {form.image_base64
                    ? "Imagen seleccionada ✓"
                    : "Seleccionar imagen"}
                </Text>
              </TouchableOpacity>
              <View style={{ flexDirection: "row", gap: 10, marginTop: 8 }}>
                <TouchableOpacity
                  onPress={() => setModalOpen(false)}
                  style={[styles.btnGhost, { flex: 1 }]}
                >
                  <Text style={styles.btnGhostText}>Cancelar</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  onPress={save}
                  disabled={busy}
                  style={[styles.btnPrimary, { flex: 1 }]}
                  testID="save-prize"
                >
                  {busy ? (
                    <ActivityIndicator color={COLORS.white} />
                  ) : (
                    <Text style={styles.btnPrimaryText}>Guardar</Text>
                  )}
                </TouchableOpacity>
              </View>
            </KeyboardAwareScrollView>
          </View>
        </View>
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
  fieldLabel: { fontSize: 12, color: COLORS.textMuted, fontWeight: "700", marginBottom: 6 },
  dateField: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", borderWidth: 1, borderColor: COLORS.border, borderRadius: 12, padding: 12, marginBottom: 10, backgroundColor: COLORS.surface },
  dateValue: { color: COLORS.textPrimary, fontSize: 15 },
  datePlaceholder: { color: COLORS.textMuted, fontSize: 15 },
  calendarPanel: { padding: 10, marginTop: -2, marginBottom: 10, borderWidth: 1, borderColor: COLORS.border, borderRadius: 14, backgroundColor: COLORS.white },
  calendarNavigation: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 8 },
  calendarArrow: { width: 40, height: 40, alignItems: "center", justifyContent: "center", borderRadius: 20, backgroundColor: COLORS.surface },
  calendarMonth: { color: COLORS.primaryDark, fontSize: 16, fontWeight: "800" },
  calendarWeekdays: { flexDirection: "row", marginBottom: 4 },
  calendarWeekday: { width: "14.2857%", color: COLORS.textMuted, fontSize: 11, textAlign: "center", fontWeight: "700" },
  calendarGrid: { flexDirection: "row", flexWrap: "wrap" },
  calendarDayCell: { width: "14.2857%", height: 38, alignItems: "center", justifyContent: "center", borderRadius: 19 },
  calendarDayCellSelected: { backgroundColor: COLORS.primary },
  calendarDayCellToday: { borderWidth: 1, borderColor: COLORS.primary },
  calendarDayText: { color: COLORS.textPrimary, fontSize: 14, fontWeight: "600" },
  calendarDayTextSelected: { color: COLORS.white, fontWeight: "800" },
  clearDateButton: { alignSelf: "flex-end", paddingHorizontal: 8, paddingVertical: 6 },
  clearDateText: { color: COLORS.error, fontWeight: "700", fontSize: 12 },
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
