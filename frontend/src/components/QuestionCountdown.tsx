import { memo, useEffect, useRef, useState } from "react";
import { AppState, StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { COLORS } from "@/src/theme";
import { remainingSeconds } from "@/src/lib/quiz-time";

/** Only this small widget rerenders every second. No background timer or disk writes. */
export const QuestionCountdown = memo(function QuestionCountdown({
  deadline, active, onExpire,
}: { deadline: number; active: boolean; onExpire: () => void }) {
  const [seconds, setSeconds] = useState(() => remainingSeconds(deadline));
  const expireRef = useRef(onExpire);
  expireRef.current = onExpire;

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    let expired = false;
    const stop = () => {
      if (timer) clearTimeout(timer);
      timer = undefined;
    };
    const tick = () => {
      stop();
      if (!active || AppState.currentState === "background" || AppState.currentState === "inactive") return;
      const remaining = remainingSeconds(deadline);
      setSeconds(remaining);
      if (remaining === 0) {
        if (!expired) { expired = true; expireRef.current(); }
        return;
      }
      timer = setTimeout(tick, 1000);
    };
    if (active) tick();
    else setSeconds(remainingSeconds(deadline));
    const subscription = AppState.addEventListener("change", (state) => {
      stop();
      if (state === "active") tick();
    });
    return () => { stop(); subscription.remove(); };
  }, [deadline, active]);

  return (
    <View style={[styles.clock, seconds <= 3 && styles.urgent]} testID="question-countdown">
      <Ionicons name="timer-outline" size={18} color={COLORS.primaryDark} />
      <Text style={styles.value} accessibilityLabel={`${seconds} segundos restantes`}>{seconds}s</Text>
    </View>
  );
});

const styles = StyleSheet.create({
  clock: { flexDirection: "row", alignItems: "center", gap: 6, backgroundColor: COLORS.surface, borderRadius: 14, paddingHorizontal: 12, paddingVertical: 8 },
  urgent: { backgroundColor: COLORS.errorBg },
  value: { color: COLORS.primaryDark, fontSize: 18, fontWeight: "800", fontVariant: ["tabular-nums"] },
});
