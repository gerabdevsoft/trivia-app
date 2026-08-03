import { useCallback, useEffect, useState } from "react";
import { View, Text, StyleSheet, FlatList, ActivityIndicator, RefreshControl } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { COLORS } from "@/src/theme";
import { api } from "@/src/lib/api";
import { UserBackground } from "@/src/components/UserBackground";

type Row = { rank: number; user_id: string; name: string; points: number; picture?: string | null };

export default function Ranking() {
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    try {
      const r = await api.rankingWeekly();
      setRows(r.top10 as any);
    } catch (e) {
      console.log(e);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const medalColor = (rank: number) =>
    rank === 1 ? "#F5B301" : rank === 2 ? "#B0B0B0" : rank === 3 ? "#CD7F32" : COLORS.primary;

  return (
    <UserBackground>
      <View style={styles.header}>
        <Text style={styles.title} testID="ranking-title">Ranking Semanal</Text>
        <Text style={styles.subtitle}>Top 10 con más puntos esta semana</Text>
      </View>
      {loading ? (
        <View style={styles.center}><ActivityIndicator size="large" color={COLORS.primary} /></View>
      ) : (
        <FlatList
          data={rows}
          keyExtractor={(r) => r.user_id}
          contentContainerStyle={{ padding: 20, paddingTop: 8 }}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} />}
          ListEmptyComponent={
            <View style={styles.empty} testID="ranking-empty">
              <Ionicons name="podium-outline" size={48} color={COLORS.textMuted} />
              <Text style={styles.emptyText}>Todavía no hay puntajes esta semana.</Text>
            </View>
          }
          renderItem={({ item }) => (
            <View style={styles.card} testID={`rank-row-${item.rank}`}>
              <View style={[styles.rankBadge, { backgroundColor: medalColor(item.rank) }]}>
                {item.rank <= 3 ? (
                  <Ionicons name="trophy" size={18} color={COLORS.white} />
                ) : (
                  <Text style={styles.rankText}>{item.rank}</Text>
                )}
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.name}>{item.name}</Text>
                <Text style={styles.sub}>Posición #{item.rank}</Text>
              </View>
              <View style={styles.pointsWrap}>
                <Text style={styles.points}>{item.points}</Text>
                <Text style={styles.ptsLabel}>pts</Text>
              </View>
            </View>
          )}
        />
      )}
    </UserBackground>
  );
}

const styles = StyleSheet.create({
  header: { padding: 20, paddingBottom: 8 },
  title: { fontSize: 28, fontWeight: "900", color: COLORS.primaryDark },
  subtitle: { fontSize: 14, color: COLORS.textSecondary, marginTop: 4 },
  center: { flex: 1, alignItems: "center", justifyContent: "center" },
  card: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: COLORS.white,
    padding: 14,
    borderRadius: 16,
    marginBottom: 10,
    borderWidth: 1,
    borderColor: COLORS.border,
    gap: 12,
  },
  rankBadge: { width: 40, height: 40, borderRadius: 20, alignItems: "center", justifyContent: "center" },
  rankText: { color: COLORS.white, fontWeight: "900", fontSize: 16 },
  name: { fontSize: 16, fontWeight: "700", color: COLORS.primaryDark },
  sub: { fontSize: 12, color: COLORS.textMuted },
  pointsWrap: { alignItems: "flex-end" },
  points: { fontSize: 22, fontWeight: "900", color: COLORS.accent },
  ptsLabel: { fontSize: 11, color: COLORS.textMuted, fontWeight: "700" },
  empty: { alignItems: "center", padding: 40 },
  emptyText: { color: COLORS.textSecondary, marginTop: 12, textAlign: "center" },
});
