import React, { ReactNode } from "react";
import { View, ImageBackground, StyleSheet, StatusBar } from "react-native";
import { SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context";
import { COLORS, ASSETS } from "@/src/theme";

export function UserBackground({ children }: { children: ReactNode }) {
  const insets = useSafeAreaInsets();
  return (
    <View style={styles.root}>
      <StatusBar barStyle="dark-content" backgroundColor={COLORS.background} />
      <ImageBackground
        source={{ uri: ASSETS.watermark }}
        style={styles.bg}
        imageStyle={styles.bgImage}
        resizeMode="repeat"
      >
        <SafeAreaView style={styles.safe} edges={["top"]}>
          <View style={[styles.content, { paddingBottom: insets.bottom }]}>{children}</View>
        </SafeAreaView>
      </ImageBackground>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: COLORS.background },
  bg: { flex: 1 },
  bgImage: { opacity: 0.06 },
  safe: { flex: 1 },
  content: { flex: 1 },
});
