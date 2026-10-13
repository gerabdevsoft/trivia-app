import { Stack, useRouter } from "expo-router";
import * as SplashScreen from "expo-splash-screen";
import { useEffect } from "react";
import { Alert, LogBox, Platform } from "react-native";
import * as Notifications from "expo-notifications";
import * as Linking from "expo-linking";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { SafeAreaProvider } from "react-native-safe-area-context";

import { useIconFonts } from "@/src/hooks/use-icon-fonts";
import { AuthProvider } from "@/src/context/auth";
import { IdleGate } from "@/src/components/IdleGate";
import { KeyboardProvider } from "react-native-keyboard-controller";

LogBox.ignoreAllLogs(true);

SplashScreen.preventAutoHideAsync();

// Push notification setup - module scope
if (Platform.OS !== "web") {
  Notifications.setNotificationHandler({
    handleNotification: async () => ({
      shouldShowAlert: true,
      shouldPlaySound: true,
      shouldSetBadge: false,
      shouldShowBanner: true,
      shouldShowList: true,
    }),
  });
}

if (Platform.OS === "android") {
  Notifications.setNotificationChannelAsync("default", {
    name: "Default",
    importance: Notifications.AndroidImportance.MAX,
    sound: "default",
  });
}

export default function RootLayout() {
  const [loaded, error] = useIconFonts();
  const router = useRouter();

  useEffect(() => {
    if (loaded || error) {
      SplashScreen.hideAsync();
    }
  }, [loaded, error]);

  useEffect(() => {
    if (Platform.OS === "web") return;

    const notifyPermissionStatus = async () => {
      const { status, canAskAgain } = await Notifications.getPermissionsAsync();
      if (status !== "denied" || canAskAgain) return;

      const lastNudge = await AsyncStorage.getItem("pushNudgeAt");
      const oneWeek = 7 * 24 * 60 * 60 * 1000;
      if (lastNudge && Date.now() - Number(lastNudge) <= oneWeek) return;

      Alert.alert(
        "Notificaciones desactivadas",
        "Actívalas en Ajustes para recibir las preguntas diarias y resultados de sorteos.",
        [
          {
            text: "Más tarde",
            style: "cancel",
            onPress: () => AsyncStorage.setItem("pushNudgeAt", String(Date.now())),
          },
          {
            text: "Abrir ajustes",
            onPress: async () => {
              await AsyncStorage.setItem("pushNudgeAt", String(Date.now()));
              await Linking.openSettings();
            },
          },
        ],
      );
    };

    void notifyPermissionStatus();

    const receivedSub = Notifications.addNotificationReceivedListener((notification) => {
      const content = notification.request.content;
      Alert.alert(content.title || "Yamile Hayes Pregunta", content.body || "Tienes una nueva notificación.");
    });

    const tapSub = Notifications.addNotificationResponseReceivedListener((response) => {
      const data = (response.notification.request.content.data as any) || {};
      const url = data.deeplink || data.action_url;
      if (!url) return;
      if (String(url).startsWith("http")) Linking.openURL(String(url));
      else router.push(String(url) as any);
    });

    Notifications.getLastNotificationResponseAsync().then((response) => {
      if (!response) return;
      const data = (response.notification.request.content.data as any) || {};
      const url = data.deeplink || data.action_url;
      if (url) {
        if (String(url).startsWith("http")) Linking.openURL(String(url));
        else router.push(String(url) as any);
      }
    });

    return () => {
      receivedSub.remove();
      tapSub.remove();
    };
  }, [router]);

  if (!loaded && !error) return null;

  return (
    <SafeAreaProvider>
      <KeyboardProvider>
        <AuthProvider>
          <IdleGate>
            <Stack screenOptions={{ headerShown: false }} />
          </IdleGate>
        </AuthProvider>
      </KeyboardProvider>
    </SafeAreaProvider>
  );
}
