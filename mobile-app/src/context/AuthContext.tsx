import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { router } from 'expo-router';
import { apiFetch, setAuthExpiredHandler } from '@/lib/apiFetch';
import { storage } from '@/lib/storage';

export interface AuthUser {
  id: string;
  email: string;
  name: string;
  role: string;
  has_password: boolean;
  projectId?: string;
  isSandbox?: boolean;
}

interface AuthContextValue {
  isAuthenticated: boolean;
  isLoading: boolean;
  user: AuthUser | null;
  login: (user: AuthUser, tokens: { accessToken: string; refreshToken: string }) => Promise<void>;
  logout: () => Promise<void>;
  refetch: () => Promise<void>;
  switchProject: (projectId: string) => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [user, setUser] = useState<AuthUser | null>(null);
  const handlerRegistered = useRef(false);

  const login = useCallback(async (u: AuthUser, tokens: { accessToken: string; refreshToken: string }) => {
    await storage.setAccessToken(tokens.accessToken);
    await storage.setRefreshToken(tokens.refreshToken);
    if (u.projectId) await storage.setProjectId(u.projectId);
    setUser(u);
    setIsAuthenticated(true);
  }, []);

  const logout = useCallback(async () => {
    await apiFetch('/auth/logout', { method: 'POST' }).catch(() => {});
    await storage.clearAuth();
    setUser(null);
    setIsAuthenticated(false);
    router.replace('/(auth)/login');
  }, []);

  const refetch = useCallback(async () => {
    try {
      const res = await apiFetch('/auth/me');
      if (res.ok) {
        const data = await res.json();
        setUser(data);
      }
    } catch {}
  }, []);

  const switchProject = useCallback(async (projectId: string) => {
    const res = await apiFetch('/auth/switch-project', {
      method: 'POST',
      body: JSON.stringify({ projectId }),
    });
    if (res.ok) {
      const data = await res.json();
      if (data.accessToken) await storage.setAccessToken(data.accessToken);
      await storage.setProjectId(projectId);
      await refetch();
    }
  }, [refetch]);

  useEffect(() => {
    if (!handlerRegistered.current) {
      handlerRegistered.current = true;
      setAuthExpiredHandler(() => {
        setUser(null);
        setIsAuthenticated(false);
        router.replace('/(auth)/login');
      });
    }

    async function checkAuth() {
      try {
        const token = await storage.getAccessToken();
        if (!token) {
          setIsAuthenticated(false);
          return;
        }

        let res = await apiFetch('/auth/me');

        if (res.status === 401) {
          const refreshed = await apiFetch('/auth/refresh', { method: 'POST' });
          if (refreshed.ok) {
            const data = await refreshed.json();
            if (data.accessToken) await storage.setAccessToken(data.accessToken);
            res = await apiFetch('/auth/me');
          }
        }

        if (res.ok) {
          const data = await res.json();
          setUser(data);
          setIsAuthenticated(true);
        } else {
          await storage.clearAuth();
          setIsAuthenticated(false);
        }
      } catch {
        setIsAuthenticated(false);
      } finally {
        setIsLoading(false);
      }
    }

    checkAuth();
  }, []);

  return (
    <AuthContext.Provider value={{ isAuthenticated, isLoading, user, login, logout, refetch, switchProject }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
