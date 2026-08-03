import { Tabs, useRouter } from "expo-router";
import { useEffect } from "react";
import { Ionicons } from "@expo/vector-icons";
import { COLORS } from "@/src/theme";
import { useAuth } from "@/src/context/auth";

export default function AdminLayout() {
  const { user, loading } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (loading) return;
    if (!user) router.replace("/login");
    else if (!user.is_admin) router.replace("/(user)/home");
  }, [user, loading, router]);

  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: COLORS.primary,
        tabBarInactiveTintColor: COLORS.textMuted,
        tabBarStyle: {
          backgroundColor: COLORS.white,
          borderTopColor: COLORS.border,
          height: 64,
          paddingBottom: 8,
          paddingTop: 8,
        },
        tabBarLabelStyle: { fontSize: 10, fontWeight: "700" },
      }}
    >
      <Tabs.Screen
        name="dashboard"
        options={{ title: "Panel", tabBarIcon: ({ color, size }) => <Ionicons name="stats-chart" size={size} color={color} /> }}
      />
      <Tabs.Screen
        name="questions"
        options={{ title: "Preguntas", tabBarIcon: ({ color, size }) => <Ionicons name="help-circle" size={size} color={color} /> }}
      />
      <Tabs.Screen
        name="prizes"
        options={{ title: "Premios", tabBarIcon: ({ color, size }) => <Ionicons name="gift" size={size} color={color} /> }}
      />
      <Tabs.Screen
        name="raffles"
        options={{ title: "Sorteos", tabBarIcon: ({ color, size }) => <Ionicons name="dice" size={size} color={color} /> }}
      />
      <Tabs.Screen
        name="users"
        options={{ title: "Usuarios", tabBarIcon: ({ color, size }) => <Ionicons name="people" size={size} color={color} /> }}
      />
    </Tabs>
  );
}
