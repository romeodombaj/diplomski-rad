import { storage } from './storage';

// Use `||` so an empty EXPO_PUBLIC_API_URL (as in .env.development) still falls
// back. NOTE: in Expo Go on a physical phone, localhost is the phone itself —
// set EXPO_PUBLIC_API_URL to your machine's LAN IP, e.g. http://192.168.1.20:5000
const API_URL = process.env.EXPO_PUBLIC_API_URL || 'http://localhost:5000';
const MOBILE_API_URL = process.env.EXPO_PUBLIC_API_URL || 'http://localhost:5000';

let isRefreshing = false;
let refreshPromise: Promise<boolean> | null = null;

let onAuthExpired: (() => void) | null = null;

export function setAuthExpiredHandler(handler: () => void) {
  onAuthExpired = handler;
}

async function tryRefresh(): Promise<boolean> {
  if (isRefreshing && refreshPromise) return refreshPromise;
  isRefreshing = true;
  refreshPromise = (async () => {
    try {
      const refreshToken = await storage.getRefreshToken();
      if (!refreshToken) return false;
      const res = await fetch(`${API_URL}/auth/refresh`, {
        method: 'POST',
        headers: { 'X-Refresh-Token': refreshToken },
      });
      if (!res.ok) return false;
      const data = await res.json();
      if (data.accessToken) await storage.setAccessToken(data.accessToken);
      if (data.refreshToken) await storage.setRefreshToken(data.refreshToken);
      return true;
    } catch {
      return false;
    } finally {
      isRefreshing = false;
      refreshPromise = null;
    }
  })();
  return refreshPromise;
}

export async function apiFetch(path: string, init: RequestInit = {}): Promise<Response> {
  const accessToken = await storage.getAccessToken();

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(init.headers as Record<string, string>),
  };
  if (accessToken) headers['Authorization'] = `Bearer ${accessToken}`;

  // Use mobile prefix for mobile endpoints
  const urlPrefix = path.startsWith('/mobile') ? MOBILE_API_URL : API_URL;
  const res = await fetch(`${urlPrefix}${path}`, { ...init, headers });

  if (res.status !== 401) return res;

  const refreshed = await tryRefresh();
  if (refreshed) {
    const newToken = await storage.getAccessToken();
    if (newToken) headers['Authorization'] = `Bearer ${newToken}`;
    return fetch(`${urlPrefix}${path}`, { ...init, headers });
  }

  onAuthExpired?.();
  return res;
}
