import { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { apiFetch } from '@/lib/apiFetch';
import { storage } from '@/lib/storage';

export interface AuthUser {
  id: string;
  email: string;
  name: string;
  role: string;
}

interface AuthContextValue {
  isAuthenticated: boolean;
  isLoading: boolean;
  user: AuthUser | null;
  login: (email: string, password: string, totpCode: string) => Promise<boolean>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [user, setUser] = useState<AuthUser | null>(null);

  const login = useCallback(async (email: string, password: string, totpCode: string): Promise<boolean> => {
    try {
      const res = await apiFetch('/mobile/auth/totp-login', {
        method: 'POST',
        body: JSON.stringify({ email, password, totp: totpCode }),
      });

      if (!res.ok) return false;

      const data = await res.json();
      if (data.accessToken) {
        await storage.setAccessToken(data.accessToken);
      }
      if (data.user) {
        setUser(data.user);
        setIsAuthenticated(true);
        return true;
      }
      return false;
    } catch {
      return false;
    }
  }, []);

  const logout = useCallback(async () => {
    await apiFetch('/auth/logout', { method: 'POST' }).catch(() => {});
    await storage.clearAuth();
    setUser(null);
    setIsAuthenticated(false);
  }, []);

  useEffect(() => {
    async function checkAuth() {
      try {
        const token = await storage.getAccessToken();
        if (!token) {
          setIsAuthenticated(false);
          setIsLoading(false);
          return;
        }

        const res = await apiFetch('/auth/me');
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
    <AuthContext.Provider value={{ isAuthenticated, isLoading, user, login, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
