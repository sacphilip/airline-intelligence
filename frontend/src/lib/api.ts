const BASE = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3100';

export async function apiFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${path}`, init);
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

  delays: (airport: string) =>
    apiFetch<any>(`/api/delays?airport=${airport}`),

  history: () => apiFetch<any>('/api/history'),

  place: (q: string) =>
    apiFetch<{ name: string; lat: number; lon: number }>(`/api/place?q=${encodeURIComponent(q)}`),
};
