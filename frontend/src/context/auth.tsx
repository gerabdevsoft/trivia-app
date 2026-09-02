import React, { createContext, useCallback, useContext, useEffect, useState } from "react";
import { Platform } from "react-native";
import * as Notifications from "expo-notifications";
import * as Device from "expo-device";
import { api, clearToken, setToken } from "@/src/lib/api";

type User = {
  user_id: string;
  email: string;
  name: string;
  picture?: string | null;
  is_admin: boolean;
  is_active: boolean;
  total_points: number;
  correct_count: number;
  incorrect_count: number;
} | null;

type Ctx = {
  user: User;
  loading: boolean;
  applySessionResponse: (res: { session_token: string; user: any }) => Promise<User>;
  refreshUser: () => Promise<void>;
  logout: () => Promise<void>;
};

const AuthContext = createContext<Ctx | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User>(null);
  const [loading, setLoading] = useState(true);

  const registerPush = useCallback(async () => {
    if (Platform.OS === "web") return;
    if (!Device.isDevice) return;
    try {
      const { status: existing } = await Notifications.getPermissionsAsync();
      let status = existing;
      if (status !== "granted") {
        const req = await Notifications.requestPermissionsAsync();
        status = req.status;
      }
      if (status !== "granted") return;
      const tokenResp = await Notifications.getDevicePushTokenAsync();
      if (tokenResp?.data) {
        await api.registerPush(Platform.OS, String(tokenResp.data));
      }
    } catch (e) {
      console.log("Push registration failed:", e);
    }
  }, []);

  const refreshUser = useCallback(async () => {
    try {
      const u = await api.me();
      // VALIDACIÓN: Si no se tiene user_id, la sesión es inválida
      if (!u || !u.user_id) {
        throw new Error("Invalid session data.");
      }
      setUser(u);
    } catch {
      setUser(null);
      await clearToken();
    }
  }, []);

  useEffect(() => {
    (async () => {
      try {
        const u = await api.me();
        if (!u || !u.user_id) {
          throw new Error("Invalid session data.");
        }
        setUser(u);
        registerPush();
      } catch {
        setUser(null);
        await clearToken();
      } finally {
        setLoading(false);
      }
    })();
  }, [registerPush]);

  const applySessionResponse = useCallback(async (res: { session_token: string; user: any }) => {
    console.log("=== RESPUESTA COMPLETA DE FASTAPI ===", JSON.stringify(res, null, 2));
    const token = typeof res?.session_token === 'object' 
      ? JSON.stringify(res.session_token) 
      : String(res?.session_token || '');

    if (!token || token === 'undefined' || token === 'null') {
      console.error("Error: El backend no envió un session_token válido.", res);
      throw new Error("No se pudo iniciar sesión: Token inválido.");
    }
    await setToken(res.session_token);
    setUser(res.user);
    registerPush();
    return res.user as User;
  }, [registerPush]);

  const logout = useCallback(async () => {
    try {
      await api.logout();
    } catch {}
    await clearToken();
    setUser(null);
  }, []);

  return (
    <AuthContext.Provider value={{ user, loading, applySessionResponse, refreshUser, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used inside AuthProvider");
  return ctx;
}
