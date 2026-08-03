import { useCallback, useEffect, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Image,
  ActivityIndicator,
  RefreshControl,
} from "react-native";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { COLORS } from "@/src/theme";
import { api } from "@/src/lib/api";
import { useAuth } from "@/src/context/auth";
import { UserBackground } from "@/src/components/UserBackground";

export default function Profile() {
  const { user, logout, refreshUser } = useAuth();
  const router = useRouter();
  const [history, setHistory] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    try {
      const r = await api.history();
      setHistory(r.history as any);
    } catch (e) { console.log(e); }
    finally { setLoading(false); setRefreshing(false); }
  }, []);

  useEffect(() => { load(); }, [load]);

  const doLogout = async () => {
    await logout();
    router.replace("/login");
  };

  return (
    <UserBackground>
      <ScrollView
        contentContainerStyle={{ padding: 20, paddingBottom: 40 }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); refreshUser(); }} />}
      >
        <View style={styles.profileCard}>
          {user?.picture ? (
            <Image source={{ uri: user.picture }} style={styles.avatar} />
          ) : (
            <View style={[styles.avatar, styles.avatarPlaceholder]}>
              <Text style={styles.avatarText}>{(user?.name?.[0] || "U").toUpperCase()}</Text>
            </View>
          )}
          <Text style={styles.name} testID="profile-name">{user?.name}</Text>
          <Text style={styles.email}>{user?.email}</Text>
          <View style={styles.pointsBox}>
            <Ionicons name="star" size={22} color={COLORS.accent} />
            <Text style={styles.pointsBig}>{user?.total_points ?? 0}</Text>
            <Text style={styles.pointsLbl}>puntos totales</Text>
          </View>
          <View style={styles.statsRow}>
            <View style={styles.stat}>
              <Text style={[styles.statVal, { color: COLORS.success }]}>{user?.correct_count ?? 0}</Text>
              <Text style={styles.statLbl}>Correctas</Text>
            </View>
            <View style={styles.stat}>
              <Text style={[styles.statVal, { color: COLORS.error }]}>{user?.incorrect_count ?? 0}</Text>
              <Text style={styles.statLbl}>Incorrectas</Text>
            </View>
          </View>
        </View>

        <Text style={styles.sectionTitle}>Historial</Text>
        {loading ? (
          <ActivityIndicator color={COLORS.primary} />
        ) : history.length === 0 ? (
          <View style={styles.empty} testID="history-empty">
            <Ionicons name="time-outline" size={40} color={COLORS.textMuted} />
            <Text style={styles.emptyText}>Todavía no tienes respuestas.</Text>
          </View>
        ) : (
          history.map((h) => (
            <View key={h.answer_id} style={styles.histCard} testID={`history-${h.answer_id}`}>
              <View style={styles.histRow}>
                <Ionicons
                  name={h.correct ? "checkmark-circle" : "close-circle"}
                  size={22}
                  color={h.correct ? COLORS.success : COLORS.error}
                />
                <Text style={styles.histQuestion}>{h.statement}</Text>
              </View>
              <View style={styles.histFooter}>
                <Text style={styles.histCategory}>{h.category}</Text>
                <Text style={[styles.histPoints, { color: h.correct ? COLORS.accentDarker : COLORS.textMuted }]}>
                  {h.correct ? "+1 pto" : "0 pts"}
                </Text>
              </View>
            </View>
          ))
        )}

        <TouchableOpacity style={styles.logoutBtn} onPress={doLogout} testID="logout-button">
          <Ionicons name="log-out-outline" size={20} color={COLORS.error} />
          <Text style={styles.logoutText}>Cerrar sesión</Text>
        </TouchableOpacity>
      </ScrollView>
    </UserBackground>
  );
}

const styles = StyleSheet.create({
  profileCard: {
    backgroundColor: COLORS.white,
    borderRadius: 24,
    padding: 24,
    alignItems: "center",
    borderWidth: 1,
    borderColor: COLORS.border,
    marginBottom: 20,
  },
  avatar: { width: 96, height: 96, borderRadius: 48, backgroundColor: COLORS.surfaceAlt },
  avatarPlaceholder: { alignItems: "center", justifyContent: "center" },
  avatarText: { fontSize: 36, fontWeight: "900", color: COLORS.primary },
  name: { fontSize: 22, fontWeight: "900", color: COLORS.primaryDark, marginTop: 12 },
  email: { fontSize: 13, color: COLORS.textMuted, marginTop: 2 },
  pointsBox: { flexDirection: "row", alignItems: "center", gap: 6, marginTop: 12 },
  pointsBig: { fontSize: 32, fontWeight: "900", color: COLORS.accent },
  pointsLbl: { fontSize: 13, color: COLORS.textMuted, marginLeft: 4 },
  statsRow: { flexDirection: "row", gap: 20, marginTop: 12 },
  stat: { alignItems: "center" },
  statVal: { fontSize: 22, fontWeight: "900" },
  statLbl: { fontSize: 11, color: COLORS.textMuted, textTransform: "uppercase", fontWeight: "700" },
  sectionTitle: { fontSize: 18, fontWeight: "800", color: COLORS.primaryDark, marginBottom: 12 },
  histCard: {
    backgroundColor: COLORS.white,
    padding: 14,
    borderRadius: 14,
    marginBottom: 10,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  histRow: { flexDirection: "row", alignItems: "flex-start", gap: 10 },
  histQuestion: { flex: 1, fontSize: 14, color: COLORS.textPrimary, fontWeight: "600", lineHeight: 20 },
  histFooter: { flexDirection: "row", justifyContent: "space-between", marginTop: 8 },
  histCategory: { fontSize: 11, color: COLORS.textMuted, textTransform: "uppercase", fontWeight: "700" },
  histPoints: { fontSize: 12, fontWeight: "700" },
  empty: { alignItems: "center", padding: 30, backgroundColor: COLORS.white, borderRadius: 16, borderWidth: 1, borderColor: COLORS.border },
  emptyText: { color: COLORS.textSecondary, marginTop: 8 },
  logoutBtn: {
    marginTop: 20,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    padding: 14,
    borderRadius: 14,
    backgroundColor: COLORS.errorBg,
    borderWidth: 1,
    borderColor: COLORS.error,
  },
  logoutText: { color: COLORS.error, fontWeight: "700" },
});
