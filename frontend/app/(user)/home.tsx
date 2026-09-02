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

type Question = {
  id: string;
  statement: string;
  options: string[];
  category: string;
  already_answered: boolean;
  selected_index: number | null;
  was_correct: boolean | null;
  correct_index: number | null;
};

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
  const [submitting, setSubmitting] = useState<string | null>(null);
  const [wins, setWins] = useState<Win[]>([]);
  const [celebrateWin, setCelebrateWin] = useState<Win | null>(null);

  const load = useCallback(async () => {
    try {
      const [r, w] = await Promise.all([api.todayQuestions(), api.myWins()]);
      setQuestions(r.questions as any);
      setWins((w.wins as any) || []);
      const unseen = (w.wins as any[])?.find((x) => !x.acknowledged);
      if (unseen) setCelebrateWin(unseen);
    } catch (e) {
      console.log("load today err", e);
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

  const answer = async (q: Question, idx: number) => {
    if (q.already_answered || submitting) return;
    setSubmitting(q.id);
    try {
      const r = await api.submitAnswer(q.id, idx);
      /*setQuestions((prev) =>
        prev.map((qq) =>
          qq.id === q.id
            ? { ...qq, already_answered: true, selected_index: idx, was_correct: r.correct, correct_index: r.correct_index }
            : qq,
        ),
      );*/
      setQuestions((prev) =>
        Array.isArray(prev)
          ? prev.map((qq) =>
              qq.id === q.id
                ? {
                    ...qq,
                    already_answered: true,
                    selected_index: idx,
                    was_correct: r.correct,
                    correct_index: r.correct_index,
                  }
                : qq,
            )
          : [],
      );
      refreshUser();
    } catch (e: any) {
      console.log("answer err", e?.message);
    } finally {
      setSubmitting(null);
    }
  };

  const answeredCount = questions?.filter((q) => q.already_answered)?.length;
  const correctToday = questions?.filter((q) => q.was_correct)?.length;

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
            label="Hoy"
            value={`${correctToday}/${questions?.length}`}
            icon="today"
            color={COLORS.primaryLight}
            testID="stat-today"
          />
        </View>

        <Text style={styles.sectionTitle}>Preguntas del día</Text>
        {questions?.length === 0 ? (
          <View style={styles.emptyCard} testID="empty-questions">
            <Ionicons
              name="hourglass-outline"
              size={48}
              color={COLORS.textMuted}
            />
            <Text style={styles.emptyTitle}>Aún no hay preguntas</Text>
            <Text style={styles.emptyText}>
              El administrador publicará las preguntas del día pronto. Recibirás
              una notificación.
            </Text>
          </View>
        ) : (
          questions?.map((q, qi) => (
            <QuestionCard
              key={q.id}
              q={q}
              index={qi + 1}
              submitting={submitting === q.id}
              onAnswer={(idx) => answer(q, idx)}
            />
          ))
        )}

        {answeredCount === questions?.length && questions?.length > 0 && (
          <View style={styles.doneCard} testID="all-done-card">
            <Ionicons name="ribbon" size={40} color={COLORS.accent} />
            <Text style={styles.doneTitle}>¡Completaste el reto de hoy!</Text>
            <Text style={styles.doneText}>
              Vuelve mañana por más preguntas.
            </Text>
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

function QuestionCard({
  q,
  index,
  submitting,
  onAnswer,
}: {
  q: Question;
  index: number;
  submitting: boolean;
  onAnswer: (idx: number) => void;
}) {
  return (
    <View style={styles.card} testID={`question-card-${q.id}`}>
      <View style={styles.cardHeader}>
        <View style={styles.badge}>
          <Text style={styles.badgeText}>{q.category}</Text>
        </View>
        <Text style={styles.qIndex}>Pregunta {index}</Text>
      </View>
      <Text style={styles.statement}>{q.statement}</Text>
      <View style={{ gap: 10, marginTop: 12 }}>
        {q.options?.map((opt, idx) => {
          const isSelected = q.selected_index === idx;
          const isCorrect = q.correct_index === idx;
          const showResult = q.already_answered;
          let bg = COLORS.white;
          let border = COLORS.border;
          let icon = <ClawBullet />;
          if (showResult) {
            if (isCorrect) {
              bg = COLORS.successBg;
              border = COLORS.success;
              icon = (
                <Ionicons
                  name="checkmark-circle"
                  size={24}
                  color={COLORS.success}
                />
              );
            } else if (isSelected) {
              bg = COLORS.errorBg;
              border = COLORS.error;
              icon = (
                <Ionicons name="close-circle" size={24} color={COLORS.error} />
              );
            }
          }
          return (
            <TouchableOpacity
              key={idx}
              activeOpacity={0.8}
              disabled={q.already_answered || submitting}
              onPress={() => onAnswer(idx)}
              style={[
                styles.option,
                { backgroundColor: bg, borderColor: border },
              ]}
              testID={`option-${q.id}-${idx}`}
            >
              <View style={styles.optIcon}>{icon}</View>
              <Text style={styles.optText}>{opt}</Text>
            </TouchableOpacity>
          );
        })}
      </View>
      {submitting && (
        <View style={{ marginTop: 8 }}>
          <ActivityIndicator color={COLORS.primary} />
        </View>
      )}
      {q.already_answered && (
        <View style={styles.resultBar}>
          <Ionicons
            name={q.was_correct ? "checkmark-circle" : "information-circle"}
            size={18}
            color={q.was_correct ? COLORS.success : COLORS.primaryLight}
          />
          <Text
            style={[
              styles.resultText,
              {
                color: q.was_correct
                  ? COLORS.accentDarker
                  : COLORS.textSecondary,
              },
            ]}
          >
            {q.was_correct ? "¡Correcto! +1 punto" : "Sin puntos esta vez"}
          </Text>
        </View>
      )}
    </View>
  );
}

function ClawBullet() {
  return (
    <View style={styles.clawBullet}>
      <Ionicons name="paw" size={16} color={COLORS.accent} />
    </View>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: "center", justifyContent: "center" },
  scroll: { padding: 20, paddingBottom: 40 },
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
