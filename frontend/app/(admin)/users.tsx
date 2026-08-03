import { useCallback, useEffect, useState } from "react";
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, ActivityIndicator, RefreshControl } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { COLORS } from "@/src/theme";
import { api } from "@/src/lib/api";

export default function AdminUsers() {
  const [users, setUsers] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const showToast = (m: string) => { setToast(m); setTimeout(() => setToast(null), 2500); };

  const load = useCallback(async () => {
    try { const r = await api.adminUsers(); setUsers(r.users as any); }
    catch (e) { console.log(e); }
    finally { setLoading(false); setRefreshing(false); }
  }, []);
  useEffect(() => { load(); }, [load]);

  const toggle = async (u: any) => {
    try { await api.adminToggleUser(u.user_id); load(); }
    catch (e: any) { showToast(e?.message); }
  };
  const remove = async (u: any) => {
    try { await api.adminDeleteUser(u.user_id); load(); showToast("Eliminado"); }
    catch (e: any) { showToast(e?.message); }
  };

  return (
    <SafeAreaView style={styles.root} edges={["top"]}>
      <View style={styles.header}>
        <Text style={styles.title} testID="admin-users-title">Usuarios</Text>
        <Text style={styles.subtitle}>{users.length} totales</Text>
      </View>
      {loading ? <ActivityIndicator color={COLORS.primary} style={{ marginTop: 30 }} /> : (
        <ScrollView
          contentContainerStyle={{ padding: 20, paddingBottom: 40 }}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} />}
        >
          {users.map((u) => (
            <View key={u.user_id} style={styles.card} testID={`user-row-${u.user_id}`}>
              <View style={styles.avatar}>
                <Text style={styles.avatarText}>{(u.name?.[0] || "U").toUpperCase()}</Text>
              </View>
              <View style={{ flex: 1 }}>
                <View style={styles.nameRow}>
                  <Text style={styles.name}>{u.name}</Text>
                  {u.is_admin && (
                    <View style={styles.adminTag}>
                      <Text style={styles.adminTagText}>ADMIN</Text>
                    </View>
                  )}
                </View>
                <Text style={styles.email}>{u.email}</Text>
                <Text style={styles.stats}>
                  {u.total_points ?? 0} pts · {u.correct_count ?? 0} correctas · {u.incorrect_count ?? 0} incorrectas
                </Text>
              </View>
              {!u.is_admin && (
                <View style={styles.actions}>
                  <TouchableOpacity onPress={() => toggle(u)} style={styles.iconBtn} testID={`toggle-user-${u.user_id}`}>
                    <Ionicons name={u.is_active ? "pause-circle" : "play-circle"} size={26} color={u.is_active ? COLORS.error : COLORS.success} />
                  </TouchableOpacity>
                  <TouchableOpacity onPress={() => remove(u)} style={styles.iconBtn} testID={`delete-user-${u.user_id}`}>
                    <Ionicons name="trash" size={22} color={COLORS.error} />
                  </TouchableOpacity>
                </View>
              )}
            </View>
          ))}
        </ScrollView>
      )}
      {toast && <View style={styles.toast}><Text style={styles.toastText}>{toast}</Text></View>}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: COLORS.surface },
  header: { padding: 20 },
  title: { fontSize: 26, fontWeight: "900", color: COLORS.primaryDark },
  subtitle: { fontSize: 13, color: COLORS.textMuted, marginTop: 2 },
  card: { flexDirection: "row", alignItems: "center", backgroundColor: COLORS.white, padding: 14, borderRadius: 14, marginBottom: 10, borderWidth: 1, borderColor: COLORS.border, gap: 12 },
  avatar: { width: 44, height: 44, borderRadius: 22, backgroundColor: COLORS.primary, alignItems: "center", justifyContent: "center" },
  avatarText: { color: COLORS.white, fontWeight: "900", fontSize: 18 },
  nameRow: { flexDirection: "row", alignItems: "center", gap: 6 },
  name: { fontSize: 15, fontWeight: "800", color: COLORS.primaryDark },
  adminTag: { backgroundColor: COLORS.accent, paddingHorizontal: 6, paddingVertical: 2, borderRadius: 6 },
  adminTagText: { color: COLORS.white, fontSize: 10, fontWeight: "900" },
  email: { fontSize: 12, color: COLORS.textMuted, marginTop: 1 },
  stats: { fontSize: 11, color: COLORS.textSecondary, marginTop: 2 },
  actions: { flexDirection: "row", gap: 4 },
  iconBtn: { padding: 6 },
  toast: { position: "absolute", left: 20, right: 20, bottom: 20, backgroundColor: COLORS.primaryDark, padding: 14, borderRadius: 12 },
  toastText: { color: COLORS.white, textAlign: "center", fontWeight: "600" },
});
