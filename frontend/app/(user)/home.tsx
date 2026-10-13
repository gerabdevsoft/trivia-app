import { useCallback, useEffect, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  ActivityIndicator,
  RefreshControl,
  Modal,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { COLORS } from "@/src/theme";
import { api } from "@/src/lib/api";
import { useAuth } from "@/src/context/auth";
import { UserBackground } from "@/src/components/UserBackground";
import DailyQuiz from "@/src/components/DailyQuiz";
import ProposalSection from "@/src/components/ProposalSection";
import type { DailyQuestion as Question, QuizResult } from "@/src/types/quiz";

type Win = {
  raffle_id: string;
  prize_id: string;
  prize_name: string;
  prize_type: string;
  date: string;
  acknowledged: boolean;
};

export default function HomeScreen() {
  const { user, refreshUser } = useAuth();
  const [questions, setQuestions] = useState<Question[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [quizDate, setQuizDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [serverNow, setServerNow] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [wins, setWins] = useState<Win[]>([]);
  const [celebrateWin, setCelebrateWin] = useState<Win | null>(null);

  const load = useCallback(async () => {
    setLoadError(null);
    try {
      const [r, w] = await Promise.all([api.todayQuestions(), api.myWins()]);
      setQuestions(r.questions as any);
      setQuizDate(r.date);
      setServerNow(r.server_now);
      setWins((w.wins as any) || []);
      const unseen = (w.wins as any[])?.find((x) => !x.acknowledged);
      if (unseen) setCelebrateWin(unseen);
    } catch (e: any) {
      console.log("load today err", e);
      setLoadError(e?.message || "No se pudieron cargar las preguntas. Desliza para reintentar.");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const onRefresh = () => {
    setRefreshing(true);
    load();
    refreshUser();
  };

  const acknowledge = async (win: Win) => {
    try {
      await api.ackWin(win.raffle_id);
      //setWins((prev) => prev.map((x) => (x.raffle_id === win.raffle_id ? { ...x, acknowledged: true } : x)));
      setWins((prev) =>
        Array.isArray(prev)
          ? prev.map((x) =>
              x.raffle_id === win.raffle_id ? { ...x, acknowledged: true } : x,
            )
          : [],
      );
      setCelebrateWin(null);
    } catch (e) {
      console.log("ack err", e);
      setCelebrateWin(null);
    }
  };

  const onAnswered = useCallback((questionId: string, result: QuizResult) => {
    setQuestions((prev) => prev.map((q) => q.id === questionId ? {
      ...q, already_answered: true, selected_index: result.selected_index,
      was_correct: result.correct, correct_index: result.correct_index, timed_out: result.timed_out,
    } : q));
    void refreshUser();
  }, [refreshUser]);

  if (loading) {
    return (
      <UserBackground>
        <View style={styles.center}>
          <ActivityIndicator size="large" color={COLORS.primary} />
        </View>
      </UserBackground>
    );
  }

  return (
    <UserBackground>
      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={styles.scroll}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={onRefresh}
            tintColor={COLORS.primary}
          />
        }
      >
        <View style={styles.header}>
          <Text style={styles.hello}>¡Hola,</Text>
          <Text style={styles.userName} testID="home-user-name">
            {user?.name || "jugador"}!
          </Text>
        </View>

        <View style={styles.statsRow}>
          <StatCard
            label="Puntos"
            value={user?.total_points ?? 0}
            icon="star"
            color={COLORS.accent}
            testID="stat-points"
          />
          <StatCard
            label="Correctas"
            value={user?.correct_count ?? 0}
            icon="checkmark-circle"
            color={COLORS.primary}
            testID="stat-correct"
          />
          <StatCard
            label="Preguntas hoy"
            value={questions?.length ?? 0}
            icon="today"
            color={COLORS.primaryLight}
            testID="stat-today"
          />
        </View>

        {loadError && <Text style={{ color: COLORS.error, marginBottom: 12 }}>{loadError}</Text>}
        <DailyQuiz
          questions={questions}
          quizDate={quizDate}
          serverNow={serverNow}
          userId={user?.user_id || ""}
          onAnswered={onAnswered}
        />
        <ProposalSection />

        {wins?.length > 0 && (
          <View>
            {wins?.slice(0, 3)?.map((w) => (
              <TouchableOpacity
                key={w.raffle_id}
                style={[
                  styles.winBanner,
                  w.acknowledged && styles.winBannerSeen,
                ]}
                onPress={() => setCelebrateWin(w)}
                testID={`win-banner-${w.raffle_id}`}
                activeOpacity={0.8}
              >
                <View style={styles.winIcon}>
                  <Ionicons name="trophy" size={26} color={COLORS.white} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.winTitle}>¡Ganaste un sorteo!</Text>
                  <Text style={styles.winPrize} numberOfLines={1}>
                    {w.prize_name}
                  </Text>
                </View>
                {!w.acknowledged && (
                  <View style={styles.newDot}>
                    <Text style={styles.newDotText}>NUEVO</Text>
                  </View>
                )}
                <Ionicons
                  name="chevron-forward"
                  size={20}
                  color={COLORS.white}
                />
              </TouchableOpacity>
            ))}
          </View>
        )}

      </ScrollView>

      <Modal
        visible={!!celebrateWin}
        transparent
        animationType="fade"
        onRequestClose={() => setCelebrateWin(null)}
      >
        <View style={styles.celebrateWrap}>
          <View style={styles.celebrateCard} testID="celebrate-modal">
            <View style={styles.celebrateIconWrap}>
              <Ionicons name="trophy" size={72} color={COLORS.accent} />
            </View>
            <Text style={styles.celebrateTitle}>¡Felicidades!</Text>
            <Text style={styles.celebrateText}>
              Ganaste el sorteo{"\n"}
              <Text style={styles.celebratePrize}>
                {celebrateWin?.prize_name}
              </Text>
            </Text>
            <Text style={styles.celebrateDate}>
              {celebrateWin?.prize_type === "weekly"
                ? "Sorteo Semanal"
                : "Sorteo Usuarios Activos"}
              {celebrateWin?.date
                ? ` · ${String(celebrateWin.date).slice(0, 10)}`
                : ""}
            </Text>
            <TouchableOpacity
              style={styles.celebrateBtn}
              onPress={() => celebrateWin && acknowledge(celebrateWin)}
              testID="celebrate-ack-button"
            >
              <Text style={styles.celebrateBtnText}>¡Genial!</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    </UserBackground>
  );
}

function StatCard({ label, value, icon, color, testID }: any) {
  return (
    <View style={styles.stat} testID={testID}>
      <Ionicons name={icon} size={22} color={color} />
      <Text style={[styles.statValue, { color }]}>{value}</Text>
      <Text style={styles.statLabel}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: "center", justifyContent: "center" },
  scroll: { flexGrow: 1, padding: 20, paddingBottom: 40 },
  header: { marginBottom: 20 },
  hello: { fontSize: 16, color: COLORS.textSecondary },
  userName: { fontSize: 28, fontWeight: "800", color: COLORS.primaryDark },
  statsRow: { flexDirection: "row", gap: 10, marginBottom: 24 },
  stat: {
    flex: 1,
    backgroundColor: COLORS.white,
    borderRadius: 16,
    padding: 14,
    alignItems: "center",
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  statValue: { fontSize: 22, fontWeight: "900", marginTop: 4 },
  statLabel: {
    fontSize: 11,
    color: COLORS.textMuted,
    marginTop: 2,
    textTransform: "uppercase",
    fontWeight: "600",
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: "800",
    color: COLORS.primaryDark,
    marginBottom: 12,
  },
  card: {
    backgroundColor: COLORS.white,
    borderRadius: 20,
    padding: 18,
    marginBottom: 16,
    borderWidth: 1,
    borderColor: COLORS.border,
    shadowColor: COLORS.primaryDark,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.06,
    shadowRadius: 8,
    elevation: 2,
  },
  cardHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 8,
  },
  badge: {
    backgroundColor: COLORS.surfaceAlt,
    paddingVertical: 4,
    paddingHorizontal: 10,
    borderRadius: 10,
  },
  badgeText: {
    color: COLORS.primary,
    fontSize: 11,
    fontWeight: "700",
    textTransform: "uppercase",
  },
  qIndex: { color: COLORS.textMuted, fontSize: 12, fontWeight: "600" },
  statement: {
    fontSize: 16,
    color: COLORS.textPrimary,
    fontWeight: "700",
    lineHeight: 22,
  },
  option: {
    flexDirection: "row",
    alignItems: "center",
    padding: 14,
    borderRadius: 14,
    borderWidth: 2,
    gap: 12,
  },
  optIcon: {
    width: 24,
    height: 24,
    alignItems: "center",
    justifyContent: "center",
  },
  optText: {
    flex: 1,
    fontSize: 15,
    color: COLORS.textPrimary,
    fontWeight: "500",
  },
  clawBullet: {
    width: 24,
    height: 24,
    alignItems: "center",
    justifyContent: "center",
  },
  resultBar: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginTop: 12,
  },
  resultText: { fontSize: 13, fontWeight: "700" },
  emptyCard: {
    backgroundColor: COLORS.white,
    borderRadius: 20,
    padding: 32,
    alignItems: "center",
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  emptyTitle: {
    fontSize: 18,
    fontWeight: "800",
    color: COLORS.primaryDark,
    marginTop: 12,
  },
  emptyText: {
    fontSize: 14,
    color: COLORS.textSecondary,
    textAlign: "center",
    marginTop: 6,
  },
  doneCard: {
    backgroundColor: COLORS.successBg,
    borderRadius: 20,
    padding: 24,
    alignItems: "center",
    marginTop: 8,
    borderWidth: 2,
    borderColor: COLORS.success,
  },
  doneTitle: {
    fontSize: 18,
    fontWeight: "900",
    color: COLORS.accentDarker,
    marginTop: 8,
  },
  doneText: { fontSize: 14, color: COLORS.textSecondary, marginTop: 4 },
  winBanner: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    backgroundColor: COLORS.accent,
    padding: 14,
    borderRadius: 16,
    marginBottom: 12,
    shadowColor: COLORS.accent,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.35,
    shadowRadius: 8,
    elevation: 4,
  },
  winBannerSeen: { backgroundColor: COLORS.accentDark, opacity: 0.85 },
  winIcon: {
    width: 44,
    height: 44,
    borderRadius: 12,
    backgroundColor: "rgba(255,255,255,0.2)",
    alignItems: "center",
    justifyContent: "center",
  },
  winTitle: { color: COLORS.white, fontWeight: "900", fontSize: 15 },
  winPrize: { color: COLORS.white, fontSize: 13, marginTop: 2, opacity: 0.95 },
  newDot: {
    backgroundColor: COLORS.white,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 8,
  },
  newDotText: { color: COLORS.accentDarker, fontSize: 10, fontWeight: "900" },
  celebrateWrap: {
    flex: 1,
    backgroundColor: COLORS.overlay,
    alignItems: "center",
    justifyContent: "center",
    padding: 24,
  },
  celebrateCard: {
    backgroundColor: COLORS.white,
    borderRadius: 24,
    padding: 28,
    alignItems: "center",
    width: "100%",
    maxWidth: 360,
  },
  celebrateIconWrap: {
    width: 120,
    height: 120,
    borderRadius: 60,
    backgroundColor: COLORS.successBg,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 16,
  },
  celebrateTitle: {
    fontSize: 26,
    fontWeight: "900",
    color: COLORS.primaryDark,
  },
  celebrateText: {
    fontSize: 16,
    color: COLORS.textSecondary,
    textAlign: "center",
    marginTop: 8,
    lineHeight: 24,
  },
  celebratePrize: {
    fontSize: 18,
    fontWeight: "900",
    color: COLORS.accentDarker,
  },
  celebrateDate: { fontSize: 12, color: COLORS.textMuted, marginTop: 8 },
  celebrateBtn: {
    backgroundColor: COLORS.accent,
    paddingVertical: 14,
    paddingHorizontal: 40,
    borderRadius: 14,
    marginTop: 20,
  },
  celebrateBtnText: { color: COLORS.white, fontWeight: "900", fontSize: 16 },
});
