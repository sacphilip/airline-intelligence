// Formatting helpers ported from public/js/format.js

export const DELAYED_MIN = 15;

export function fmt(n: number | null | undefined, decimals = 0): string {
  if (n == null || !Number.isFinite(n)) return '—';
  return n.toLocaleString('en-IN', { maximumFractionDigits: decimals });
}

export function fmtClock(ms: number | null | undefined, timeZone?: string | null): string {
  if (ms == null) return '—';
  return new Date(ms).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: timeZone ?? undefined });
}

export function fmtDay(ms: number | null | undefined, timeZone?: string | null): string {
  if (ms == null) return '—';
  return new Date(ms).toLocaleDateString('en-IN', { weekday: 'short', month: 'short', day: 'numeric', timeZone: timeZone ?? undefined });
}

export function fmtHoursMinutes(minutes: number): string {
  const h = Math.floor(Math.abs(minutes) / 60);
  const m = Math.abs(minutes) % 60;
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

export function fmtDuration(minutes: number): string {
  return fmtHoursMinutes(minutes);
}

export function fmtDelay(minutes: number | null | undefined): string {
  if (minutes == null) return '—';
  if (minutes === 0) return 'On time';
  return `${minutes > 0 ? '+' : ''}${minutes} min`;
}

export function airportCode(airport: { iata?: string | null; icao?: string | null } | null | undefined): string {
  return airport?.iata ?? airport?.icao ?? '?';
}

export function delayClass(minutes: number | null | undefined): string {
  if (minutes == null || minutes < DELAYED_MIN) return 'text-green-600 dark:text-green-400';
  if (minutes >= 60) return 'text-red-600 dark:text-red-400';
  return 'text-amber-600 dark:text-amber-400';
}

export function esc(s: string | null | undefined): string {
  return (s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

export function todayLocal(): string {
  return new Date().toLocaleDateString('en-CA'); // YYYY-MM-DD
}
