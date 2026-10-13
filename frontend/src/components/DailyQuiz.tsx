import { useCallback, useEffect, useRef, useState } from "react";
import { ActivityIndicator, AppState, Modal, ScrollView, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { useFocusEffect } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { api } from "@/src/lib/api";
import { localDeadline, parseQuizSession, quizStorageKey } from "@/src/lib/quiz-time";
import { QuestionCountdown } from "@/src/components/QuestionCountdown";
import { COLORS } from "@/src/theme";
import type { DailyQuestion, QuizResult, StoredQuizSession } from "@/src/types/quiz";

type Props = {
  questions: DailyQuestion[];
  quizDate: string;
  serverNow: string | null;
  userId: string;
  onAnswered: (questionId: string, result: QuizResult) => void;
};

export default function DailyQuiz({ questions, quizDate, serverNow, userId, onAnswered }: Props) {
  const [visible, setVisible] = useState(false);
  const [currentId, setCurrentId] = useState<string | null>(null);
  const [snapshot, setSnapshot] = useState<DailyQuestion | null>(null);
  const [deadline, setDeadline] = useState(0);
  const [hydrating, setHydrating] = useState(true);
  const [starting, setStarting] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [expiredLocally, setExpiredLocally] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [storageWarning, setStorageWarning] = useState<string | null>(null);
  const [focused, setFocused] = useState(true);
  const submissionLock = useRef(false);
  const startLock = useRef(false);
  const lastSelected = useRef<number | null>(null);
  const questionsRef = useRef(questions);
  const serverNowRef = useRef(serverNow);
  questionsRef.current = questions;
  serverNowRef.current = serverNow;
  const current = questions.find((q) => q.id === currentId) ?? snapshot;
  const currentRef = useRef(current);
  const deadlineRef = useRef(deadline);
  const focusedRef = useRef(focused);
  currentRef.current = current;
  deadlineRef.current = deadline;
  focusedRef.current = focused;
  const finishRef = useRef<(index: number | null) => Promise<void>>(async () => {});

  const saveSession = useCallback(async (question: DailyQuestion, end: number) => {
    const session: StoredQuizSession = { version: 1, userId, quizDate, question, deadline: end };
    try {
      await AsyncStorage.setItem(quizStorageKey(userId), JSON.stringify(session));
      setStorageWarning(null);
    } catch {
      setStorageWarning("No se pudo guardar en este dispositivo. El plazo sigue protegido en el servidor.");
    }
  }, [userId, quizDate]);

  useEffect(() => {
    let cancelled = false;
    setHydrating(true);
    setVisible(false);
    setCurrentId(null);
    setSnapshot(null);
    setError(null);
    AsyncStorage.getItem(quizStorageKey(userId)).then(async (raw) => {
      const saved = parseQuizSession(raw, userId, quizDate);
      const available = questionsRef.current;
      const pending = available.find((q) => !q.already_answered && q.deadline_at);
      const restored = saved ? available.find((q) => q.id === saved.question.id) ?? saved.question : pending;
      if (cancelled) return;
      if (restored) {
        const end = restored.deadline_at && serverNowRef.current
          ? localDeadline(restored.deadline_at, serverNowRef.current)
          : saved?.deadline ?? Date.now();
        setCurrentId(restored.id);
        setSnapshot(restored);
        setDeadline(end);
        setExpiredLocally(!!restored.timed_out);
        setVisible(true);
      } else if (raw) {
        await AsyncStorage.removeItem(quizStorageKey(userId));
      }
    }).catch(() => {
      if (!cancelled) setStorageWarning("No se pudo recuperar el intento local. El servidor conservará el plazo.");
    }).finally(() => { if (!cancelled) setHydrating(false); });
    return () => { cancelled = true; };
  }, [userId, quizDate]);

  useFocusEffect(useCallback(() => {
    setFocused(true);
    return () => setFocused(false);
  }, []));

  useEffect(() => {
    const subscription = AppState.addEventListener("change", (state) => {
      const question = currentRef.current;
      if (state === "active" && focusedRef.current && question && !question.already_answered &&
          deadlineRef.current > 0 && Date.now() >= deadlineRef.current) {
        setVisible(true);
        void finishRef.current(null);
      }
    });
    return () => subscription.remove();
  }, []);

  const finish = useCallback(async (index: number | null) => {
    const question = currentRef.current;
    if (!question || question.already_answered || submissionLock.current) return;
    submissionLock.current = true;
    const timeout = index === null || Date.now() >= deadlineRef.current;
    lastSelected.current = timeout ? null : index;
    if (timeout) setExpiredLocally(true);
    setSubmitting(true);
    setError(null);
    try {
      const result = await api.submitAnswer(question.id, timeout ? null : index);
      const updated: DailyQuestion = {
        ...question, already_answered: true, selected_index: result.selected_index,
        was_correct: result.correct, correct_index: result.correct_index, timed_out: result.timed_out,
      };
      setSnapshot(updated);
      setExpiredLocally(result.timed_out);
      onAnswered(question.id, result);
      await saveSession(updated, deadlineRef.current);
    } catch (e: any) {
      setExpiredLocally(Date.now() >= deadlineRef.current);
      setError(e?.message || "No se pudo registrar la respuesta. Reintenta cuando tengas conexión.");
    } finally {
      submissionLock.current = false;
      setSubmitting(false);
    }
  }, [onAnswered, saveSession]);
  finishRef.current = finish;

  const start = async (question: DailyQuestion) => {
    if (startLock.current) return;
    startLock.current = true;
    setStarting(true);
    setError(null);
    try {
      const result = await api.startQuestion(question.id);
      let shown = question;
      let end = Date.now();
      if (result.already_answered && result.answer) {
        shown = {
          ...question, already_answered: true, selected_index: result.answer.selected_index,
          was_correct: result.answer.correct, correct_index: result.answer.correct_index, timed_out: result.answer.timed_out,
        };
        onAnswered(question.id, result.answer);
      } else if (result.deadline_at) {
        end = localDeadline(result.deadline_at, result.server_now);
        shown = { ...question, deadline_at: result.deadline_at };
      } else {
        throw new Error("El servidor no devolvió un plazo válido");
      }
      await saveSession(shown, end);
      setSnapshot(shown);
      setCurrentId(shown.id);
      setDeadline(end);
      setExpiredLocally(!!shown.timed_out);
      setVisible(true);
    } catch (e: any) {
      setError(e?.message || "No se pudo iniciar la pregunta");
    } finally {
      startLock.current = false;
      setStarting(false);
    }
  };

  const next = async () => {
    const nextQuestion = questions.find((q) => !q.already_answered);
    if (nextQuestion) {
      await start(nextQuestion);
    } else {
      try { await AsyncStorage.removeItem(quizStorageKey(userId)); }
      catch { setStorageWarning("No se pudo limpiar el intento local."); }
      setVisible(false);
      setCurrentId(null);
      setSnapshot(null);
      setDeadline(0);
    }
  };

  const completed = questions.filter((q) => q.already_answered).length;
  const nextQuestion = questions.find((q) => !q.already_answered);
  const currentIndex = questions.findIndex((q) => q.id === currentId);
  const timeout = !!current?.timed_out || expiredLocally;

  return (
    <>
      <TouchableOpacity
        style={[styles.launch, (!nextQuestion && !currentId) && styles.launchDisabled]}
        disabled={hydrating || starting || (!nextQuestion && !currentId)}
        onPress={() => currentId ? setVisible(true) : nextQuestion && void start(nextQuestion)}
        activeOpacity={0.85}
        testID="start-daily-quiz"
      >
        <View style={styles.launchIcon}><Ionicons name="play" size={24} color={COLORS.primaryDark} /></View>
        <View style={{ flex: 1 }}>
          <Text style={styles.launchTitle}>Responder Preguntas del día</Text>
          <Text style={styles.launchSubtitle}>
            {questions.length ? `${completed} de ${questions.length} completadas · 10 segundos por pregunta` : "Las preguntas de hoy estarán disponibles pronto"}
          </Text>
        </View>
        {(starting || hydrating) ? <ActivityIndicator color={COLORS.white} /> : <Ionicons name="arrow-forward" size={22} color={COLORS.white} />}
      </TouchableOpacity>
      {error && !visible && <Text style={styles.error} accessibilityRole="alert">{error}</Text>}
      {storageWarning && !visible && <Text style={styles.warning}>{storageWarning}</Text>}
      {questions.length > 0 && completed === questions.length && !currentId && (
        <Text style={styles.complete} testID="all-done-card">¡Completaste el reto de hoy! Vuelve mañana por más preguntas.</Text>
      )}

      <Modal visible={visible} animationType="slide" onRequestClose={() => setVisible(false)}>
        <SafeAreaView style={styles.modalRoot}>
          <View style={styles.modalHeader}>
            <View>
              <Text style={styles.eyebrow}>RETO DEL DÍA</Text>
              <Text style={styles.modalTitle}>Pregunta {currentIndex >= 0 ? currentIndex + 1 : 1} de {questions.length || 1}</Text>
            </View>
            <TouchableOpacity onPress={() => setVisible(false)} accessibilityLabel="Cerrar preguntas" style={styles.close} testID="close-daily-quiz">
              <Ionicons name="close" size={26} color={COLORS.textPrimary} />
            </TouchableOpacity>
          </View>
          <ScrollView contentContainerStyle={styles.quizContent}>
            {current && (
              <>
                <View style={styles.cardHeader}>
                  <Text style={styles.category}>{current.category}</Text>
                  {!current.already_answered && deadline > 0 && !timeout && (
                    <QuestionCountdown
                      deadline={deadline}
                      active={visible && focused && !submitting && !starting && !hydrating}
                      onExpire={() => void finish(null)}
                    />
                  )}
                </View>
                <Text style={styles.statement}>{current.statement}</Text>
                <Text style={styles.instructions}>{current.already_answered ? "Respuesta registrada" : timeout ? "El plazo de esta pregunta terminó." : "Toca una opción antes de que termine el plazo."}</Text>
                {current.options.map((option, index) => {
                  const correctOption = current.already_answered && current.correct_index === index;
                  const wrongOption = current.already_answered && current.selected_index === index && !current.was_correct;
                  return (
                    <TouchableOpacity
                      key={index}
                      accessibilityRole="button"
                      disabled={current.already_answered || submitting || starting || timeout || hydrating}
                      onPress={() => void finish(index)}
                      style={[styles.option, correctOption && styles.correctOption, wrongOption && styles.wrongOption]}
                      testID={`option-${current.id}-${index}`}
                    >
                      <View style={styles.letter}><Text style={styles.letterText}>{String.fromCharCode(65 + index)}</Text></View>
                      <Text style={styles.optionText}>{option}</Text>
                      {correctOption && <Ionicons name="checkmark-circle" size={22} color={COLORS.primary} />}
                      {wrongOption && <Ionicons name="close-circle" size={22} color={COLORS.error} />}
                    </TouchableOpacity>
                  );
                })}
                {(timeout || current.already_answered) && (
                  <View style={styles.result} testID={timeout ? "question-timeout" : "question-result"}>
                    <Ionicons name={timeout ? "hourglass-outline" : current.was_correct ? "checkmark-circle" : "close-circle"} size={28} color={COLORS.primaryDark} />
                    <View style={{ flex: 1 }}>
                      <Text style={styles.resultTitle}>{timeout ? "Tiempo agotado" : current.was_correct ? "¡Correcto! +1 punto" : "Respuesta equivocada"}</Text>
                      <Text style={styles.resultText}>{timeout ? "Se registra como equivocada, con 0 puntos." : "Puedes pasar a la siguiente pregunta."}</Text>
                    </View>
                  </View>
                )}
                {submitting && <View style={styles.saving}><ActivityIndicator color={COLORS.primary} /><Text style={styles.instructions}>Registrando respuesta…</Text></View>}
                {error && (
                  <View style={styles.errorBox}>
                    <Text style={styles.error} accessibilityRole="alert">{error}</Text>
                    <TouchableOpacity onPress={() => void finish(lastSelected.current)} disabled={submitting} testID="retry-answer">
                      <Text style={styles.retry}>Reintentar registro</Text>
                    </TouchableOpacity>
                  </View>
                )}
                {storageWarning && <Text style={styles.warning}>{storageWarning}</Text>}
                {current.already_answered && (
                  <TouchableOpacity style={styles.next} onPress={() => void next()} disabled={starting || submitting} testID="next-question">
                    {starting ? <ActivityIndicator color={COLORS.white} /> : <Text style={styles.nextText}>{nextQuestion ? "Siguiente pregunta" : "Finalizar reto"}</Text>}
                    {!starting && <Ionicons name="arrow-forward" size={20} color={COLORS.white} />}
                  </TouchableOpacity>
                )}
              </>
            )}
          </ScrollView>
        </SafeAreaView>
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  launch: { flexDirection: "row", alignItems: "center", gap: 14, backgroundColor: COLORS.primaryDark, borderRadius: 24, padding: 20, marginBottom: 20 },
  launchDisabled: { opacity: 0.65 },
  launchIcon: { backgroundColor: COLORS.white, borderRadius: 18, width: 48, height: 48, alignItems: "center", justifyContent: "center" },
  launchTitle: { color: COLORS.white, fontSize: 20, fontWeight: "800", lineHeight: 25 },
  launchSubtitle: { color: "#FFE1E3", fontSize: 12, lineHeight: 18, marginTop: 7 },
  complete: { color: COLORS.primaryDark, fontSize: 14, lineHeight: 21, marginBottom: 20, fontWeight: "600" },
  modalRoot: { flex: 1, backgroundColor: COLORS.background },
  modalHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", padding: 22, borderBottomWidth: 1, borderBottomColor: COLORS.border },
  eyebrow: { color: COLORS.primaryDark, fontWeight: "800", fontSize: 11, letterSpacing: 1.4, marginBottom: 6 },
  modalTitle: { color: COLORS.textPrimary, fontWeight: "800", fontSize: 22 },
  close: { padding: 8, backgroundColor: COLORS.surface, borderRadius: 20 },
  quizContent: { padding: 22, paddingBottom: 40, width: "100%", maxWidth: 700, alignSelf: "center" },
  cardHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 22, gap: 8 },
  category: { color: COLORS.primaryDark, fontWeight: "700", fontSize: 13, flex: 1 },
  statement: { fontSize: 25, lineHeight: 34, fontWeight: "800", color: COLORS.textPrimary, marginBottom: 10 },
  instructions: { color: COLORS.textSecondary, fontSize: 14, lineHeight: 21, marginBottom: 16 },
  option: { flexDirection: "row", alignItems: "center", gap: 12, borderWidth: 1.5, borderColor: COLORS.border, backgroundColor: COLORS.white, padding: 15, borderRadius: 16, marginBottom: 12 },
  correctOption: { borderColor: COLORS.primary, backgroundColor: COLORS.successBg },
  wrongOption: { borderColor: COLORS.error, backgroundColor: COLORS.errorBg },
  letter: { width: 30, height: 30, alignItems: "center", justifyContent: "center", borderRadius: 10, backgroundColor: COLORS.surfaceAlt },
  letterText: { color: COLORS.primaryDark, fontWeight: "800" },
  optionText: { flex: 1, color: COLORS.textPrimary, fontSize: 16, lineHeight: 23, fontWeight: "600" },
  result: { flexDirection: "row", alignItems: "center", gap: 12, backgroundColor: COLORS.surfaceAlt, borderRadius: 18, padding: 16, marginTop: 8, marginBottom: 20 },
  resultTitle: { color: COLORS.primaryDark, fontSize: 18, fontWeight: "800", marginBottom: 4 },
  resultText: { color: COLORS.textSecondary, fontSize: 14, lineHeight: 20 },
  next: { backgroundColor: COLORS.primaryDark, flexDirection: "row", justifyContent: "center", alignItems: "center", gap: 10, padding: 18, borderRadius: 16 },
  nextText: { color: COLORS.white, fontSize: 16, fontWeight: "800" },
  saving: { flexDirection: "row", gap: 10, alignItems: "center", marginVertical: 12 },
  errorBox: { backgroundColor: COLORS.errorBg, padding: 14, borderRadius: 14, marginBottom: 15 },
  error: { color: COLORS.error, fontSize: 14, lineHeight: 21, marginBottom: 8 },
  retry: { color: COLORS.primaryDark, fontWeight: "800", fontSize: 14, textDecorationLine: "underline" },
  warning: { color: COLORS.textSecondary, fontSize: 12, lineHeight: 18, marginBottom: 14 },
});
