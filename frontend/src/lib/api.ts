import type { RouteAnalytics } from './types';

const BASE = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3100';

export async function apiFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${path}`, { credentials: 'include', ...init });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err: any = new Error(data.message ?? data.error ?? `Request failed (${res.status})`);
    err.status = res.status;
    err.data = data;
    throw err;
  }
  return data as T;
}

export const api = {
  aircraft: (lat: number, lon: number, dist = 50) =>
    apiFetch<any>(`/api/aircraft?lat=${lat}&lon=${lon}&dist=${dist}`),

  flight: (params: { callsign?: string; hex?: string; lat?: number; lon?: number; gs?: number; ground?: boolean; type?: string }) => {
    const p = new URLSearchParams();
    Object.entries(params).forEach(([k, v]) => v != null && p.set(k, String(v)));
    return apiFetch<any>(`/api/flight?${p}`);
  },

  airlines: () => apiFetch<Record<string, string>>('/api/airlines'),

  search: (number: string, date?: string) =>
    apiFetch<any>(`/api/search?number=${encodeURIComponent(number)}${date ? `&date=${date}` : ''}`),

  route: (from: string, to: string, date: string) =>
    apiFetch<any>(`/api/route?from=${from}&to=${to}&date=${date}`),

  routeAnalytics: (from: string, to: string) =>
    apiFetch<RouteAnalytics>(`/api/route/analytics?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`),

  delays: (airport: string) =>
    apiFetch<any>(`/api/delays?airport=${airport}`),

  history: () => apiFetch<any>('/api/history'),

  flightHistory: (number: string, days = 7) =>
    apiFetch<any[]>(`/api/flight/history?number=${encodeURIComponent(number)}&days=${days}`),

  airlineProfile: (iata: string) =>
    apiFetch<any>(`/api/airline/profile?iata=${encodeURIComponent(iata)}`),

  airlineRankings: () =>
    apiFetch<any[]>('/api/airline/rankings'),

  airlineTrend: (iata: string, months = 9) =>
    apiFetch<any>(`/api/airline/trend?iata=${encodeURIComponent(iata)}&months=${months}`),

  place: (q: string) =>
    apiFetch<{ name: string; lat: number; lon: number }>(`/api/place?q=${encodeURIComponent(q)}`),

  authLogin: (email: string, password: string) =>
    apiFetch<{ id: number; email: string; firstName: string | null }>('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password }),
    }),

  authLogout: () =>
    apiFetch<{ ok: boolean }>('/api/auth/logout', { method: 'POST' }),

  authMe: () =>
    apiFetch<{ id: number; email: string; firstName: string | null } | null>('/api/auth/me'),
};
