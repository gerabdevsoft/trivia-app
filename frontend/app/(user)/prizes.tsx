import { useCallback, useEffect, useState } from "react";
import { View, Text, StyleSheet, ScrollView, Image, ActivityIndicator, RefreshControl } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { COLORS } from "@/src/theme";
import { api } from "@/src/lib/api";
import { UserBackground } from "@/src/components/UserBackground";

type Prize = {
  prize_id: string;
  name: string;
  description: string;
  prize_type: "weekly" | "active";
  draw_date?: string;
  has_image: boolean;
  executed: boolean;
  created_at: string;
};

export default function Prizes() {
  const [prizes, setPrizes] = useState<Prize[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    try {
      const r = await api.prizes();
      setPrizes(r.prizes as any);
    } catch (e) { console.log(e); }
    finally { setLoading(false); setRefreshing(false); }
  }, []);

  useEffect(() => { load(); }, [load]);

  const upcoming = prizes.filter((p) => !p.executed);
  const past = prizes.filter((p) => p.executed);

  return (
    <UserBackground>
      <ScrollView
        contentContainerStyle={{ padding: 20 }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} />}
      >
        <Text style={styles.title} testID="prizes-title">Premios</Text>
        <Text style={styles.subtitle}>Descubre los premios en juego</Text>

        {loading ? (
          <View style={{ paddingVertical: 40 }}><ActivityIndicator size="large" color={COLORS.primary} /></View>
        ) : (
          <>
            <Text style={styles.section}>Disponibles</Text>
            {upcoming.length === 0 ? (
              <View style={styles.empty} testID="upcoming-empty">
                <Ionicons name="gift-outline" size={40} color={COLORS.textMuted} />
                <Text style={styles.emptyText}>No hay premios disponibles por ahora.</Text>
              </View>
            ) : (
              upcoming.map((p) => <PrizeCard key={p.prize_id} p={p} />)
            )}

            {past.length > 0 && (
              <>
                <Text style={[styles.section, { marginTop: 24 }]}>Historial</Text>
                {past.map((p) => <PrizeCard key={p.prize_id} p={p} historical />)}
              </>
            )}
          </>
        )}
      </ScrollView>
    </UserBackground>
  );
}

function PrizeCard({ p, historical }: { p: Prize; historical?: boolean }) {
  return (
    <View style={styles.card} testID={`prize-card-${p.prize_id}`}>
      {p.has_image ? (
        <Image source={{ uri: api.prizeImageUrl(p.prize_id) }} style={styles.image} resizeMode="cover" />
      ) : (
        <View style={[styles.image, styles.imagePlaceholder]}>
          <Ionicons name="gift" size={48} color={COLORS.primaryLight} />
        </View>
      )}
      <View style={styles.body}>
        <View style={styles.rowBetween}>
          <View style={[styles.tag, { backgroundColor: p.prize_type === "weekly" ? COLORS.surfaceAlt : COLORS.successBg }]}>
            <Text style={[styles.tagText, { color: p.prize_type === "weekly" ? COLORS.primary : COLORS.accentDarker }]}>
              {p.prize_type === "weekly" ? "Semanal" : "Usuarios Activos"}
            </Text>
          </View>
          {historical && (
            <View style={[styles.tag, { backgroundColor: COLORS.surface }]}>
              <Text style={[styles.tagText, { color: COLORS.textMuted }]}>Sorteado</Text>
            </View>
          )}
        </View>
        <Text style={styles.name}>{p.name}</Text>
        {!!p.description && <Text style={styles.desc}>{p.description}</Text>}
        {p.draw_date && (
          <View style={styles.dateRow}>
            <Ionicons name="calendar-outline" size={14} color={COLORS.primary} />
            <Text style={styles.dateText}>Sorteo: {p.draw_date}</Text>
          </View>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  title: { fontSize: 28, fontWeight: "900", color: COLORS.primaryDark },
  subtitle: { fontSize: 14, color: COLORS.textSecondary, marginTop: 4 },
  section: { fontSize: 16, fontWeight: "800", color: COLORS.primaryDark, marginTop: 20, marginBottom: 12 },
  card: {
    backgroundColor: COLORS.white,
    borderRadius: 20,
    marginBottom: 16,
    borderWidth: 1,
    borderColor: COLORS.border,
    overflow: "hidden",
  },
  image: { width: "100%", height: 160, backgroundColor: COLORS.surface },
  imagePlaceholder: { alignItems: "center", justifyContent: "center" },
  body: { padding: 16 },
  rowBetween: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 8 },
  tag: { paddingVertical: 4, paddingHorizontal: 10, borderRadius: 10 },
  tagText: { fontSize: 11, fontWeight: "700", textTransform: "uppercase" },
  name: { fontSize: 18, fontWeight: "800", color: COLORS.primaryDark },
  desc: { fontSize: 14, color: COLORS.textSecondary, marginTop: 4, lineHeight: 20 },
  dateRow: { flexDirection: "row", alignItems: "center", gap: 6, marginTop: 8 },
  dateText: { fontSize: 13, color: COLORS.primary, fontWeight: "600" },
  empty: { alignItems: "center", padding: 40, backgroundColor: COLORS.white, borderRadius: 16, borderWidth: 1, borderColor: COLORS.border },
  emptyText: { color: COLORS.textSecondary, marginTop: 8 },
});
