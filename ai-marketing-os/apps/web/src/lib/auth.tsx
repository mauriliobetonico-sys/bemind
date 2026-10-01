'use client';

import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import type { Permission } from '@aimos/shared';
import { api } from './api';

export interface Me {
  user: { id: string; name: string; email: string; globalRole: string | null };
  memberships: { tenantId: string; tenantName: string; tenantKind: string; tenantStatus: string; roleKey: string }[];
  permissions: { global: Permission[]; byTenant: Record<string, Permission[]> };
  isStaff: boolean;
}

interface AuthState {
  me: Me | null;
  loading: boolean;
  refresh: () => Promise<void>;
  logout: () => Promise<void>;
  /** Apenas para exibir/ocultar elementos — a autorização real é do servidor. */
  can: (permission: Permission) => boolean;
}

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [me, setMe] = useState<Me | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    try {
      setMe(await api<Me>('/auth/me'));
    } catch {
      setMe(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const logout = useCallback(async () => {
    await api('/auth/logout', { method: 'POST' }).catch(() => undefined);
    setMe(null);
    window.location.assign('/login');
  }, []);

  const can = useCallback(
    (p: Permission) => !!me && (me.permissions.global.includes(p) || Object.values(me.permissions.byTenant).some((ps) => ps.includes(p))),
    [me],
  );

  return <AuthContext.Provider value={{ me, loading, refresh, logout, can }}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth fora do AuthProvider');
  return ctx;
}
