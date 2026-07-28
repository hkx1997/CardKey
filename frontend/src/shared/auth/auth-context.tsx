import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";

import type { AdminUser } from "@/entities/types";
import { api } from "@/shared/api/client";

interface AuthState {
  user: AdminUser | null;
  loading: boolean;
  login: (
    username: string,
    password: string,
  ) => Promise<{ requiresTotp?: boolean; ticket?: string } | void>;
  completeTotpLogin: (ticket: string, code: string) => Promise<void>;
  logout: () => Promise<void>;
  refresh: () => Promise<void>;
}

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AdminUser | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    try {
      const me = await api.me();
      setUser(me);
    } catch {
      setUser(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const login = useCallback(async (username: string, password: string) => {
    const res = await api.login(username, password);
    if (res && typeof res === "object" && "requiresTotp" in res && res.requiresTotp) {
      return { requiresTotp: true, ticket: (res as { ticket: string }).ticket };
    }
    setUser(res as AdminUser);
  }, []);

  const completeTotpLogin = useCallback(async (ticket: string, code: string) => {
    const me = await api.loginTotp(ticket, code);
    setUser(me);
  }, []);

  const logout = useCallback(async () => {
    await api.logout();
    setUser(null);
  }, []);

  const value = useMemo(
    () => ({ user, loading, login, completeTotpLogin, logout, refresh }),
    [user, loading, login, completeTotpLogin, logout, refresh],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
