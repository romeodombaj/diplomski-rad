import { createContext, useCallback, useContext, useEffect, useState } from 'react';

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
  login: (user: AuthUser) => void;
  logout: () => void;
  refetch: () => Promise<void>;
  switchProject: (projectId: string) => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [user, setUser] = useState<AuthUser | null>(null);

  const login = useCallback((u: AuthUser) => {
    setUser(u);
    setIsAuthenticated(true);
  }, []);

  const logout = useCallback(() => {
    setUser(null);
    setIsAuthenticated(false);
    fetch('/auth/logout', { method: 'POST' }).catch(() => {});
  }, []);

  const refetch = useCallback(async () => {
    try {
      const res = await fetch('/auth/me');
      if (res.ok) {
        const data = await res.json();
        setUser(data);
      }
    } catch {}
  }, []);

  const switchProject = useCallback(async (projectId: string) => {
    const res = await fetch('/auth/switch-project', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ projectId }),
    });
    if (res.ok) {
      window.location.reload();
    }
  }, []);

  useEffect(() => {
    async function checkAuth() {
      try {
        let res = await fetch('/auth/me');

        if (res.status === 401) {
          // Access token expired — silently try to refresh
          const refreshed = await fetch('/auth/refresh', { method: 'POST' });
          if (refreshed.ok) {
            res = await fetch('/auth/me');
          }
        }

        if (res.ok) {
          const data = await res.json();
          setUser(data);
          setIsAuthenticated(true);
        } else {
          setIsAuthenticated(false);
        }
      } catch {
        setIsAuthenticated(false);
      } finally {
        setIsLoading(false);
      }
    }

    checkAuth();

    // apiFetch dispatches this when both access token and refresh token have expired
    const handleExpired = () => {
      setUser(null);
      setIsAuthenticated(false);
    };
    window.addEventListener('auth:expired', handleExpired);
    return () => window.removeEventListener('auth:expired', handleExpired);
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
