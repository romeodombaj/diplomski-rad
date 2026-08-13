// Shared fetch wrapper that handles token refresh transparently.
// All API service files should use this instead of raw fetch.

let isRefreshing = false;
let refreshPromise: Promise<boolean> | null = null;

async function tryRefresh(): Promise<boolean> {
  // Deduplicate concurrent refresh attempts
  if (isRefreshing && refreshPromise) return refreshPromise;
  isRefreshing = true;
  refreshPromise = fetch('/auth/refresh', { method: 'POST' })
    .then((r) => r.ok)
    .catch(() => false)
    .finally(() => {
      isRefreshing = false;
      refreshPromise = null;
    });
  return refreshPromise;
}

export async function apiFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const res = await fetch(input, init);

  if (res.status !== 401) return res;

  // Access token expired — try to get a new one via the refresh token cookie
  const refreshed = await tryRefresh();
  if (refreshed) {
    return fetch(input, init);
  }

  // Refresh token also expired — notify AuthContext so it can redirect
  window.dispatchEvent(new CustomEvent('auth:expired'));
  return res;
}
