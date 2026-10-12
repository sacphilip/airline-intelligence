'use client';

import { useState, useEffect, useRef } from 'react';
import { api } from '@/lib/api';
import { SearchResult, SearchLeg } from '@/lib/types';
import { flightStatus, flightTimeline, fmtDelayMinutes, DEPARTED } from '@/lib/flight-status';
import { airportCode, delayClass, fmtClock, fmtDay, todayLocal, DELAYED_MIN } from '@/lib/format';
import { RouteAnalytics } from './RouteAnalytics';

const AIRPORT_RE = /^[A-Z0-9]{3,4}$/;

interface Props {
  initialNumber: string | null;
  onConsumeNumber: () => void;
  // US-009: from a #route/BLR/DEL link
  initialRoute?: { from: string; to: string } | null;
  onConsumeRoute?: () => void;
}

export function FlightSearchTab({ initialNumber, onConsumeNumber, initialRoute = null, onConsumeRoute }: Props) {
  const [mode, setMode] = useState<'number' | 'route'>('number');
  const [input, setInput] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [date, setDate] = useState(todayLocal());
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<SearchResult | null>(null);
  const [error, setError] = useState('');
  // The route whose analytics are shown; independent of the day's flight list and its errors.
  const [analyticsRoute, setAnalyticsRoute] = useState<{ from: string; to: string } | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (initialNumber) {
      setMode('number');
      setInput(initialNumber);
      setResult(null);
      setError('');
      onConsumeNumber();
      handleSearch(initialNumber);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialNumber]);

  useEffect(() => {
    if (initialRoute) {
      setMode('route');
      setFrom(initialRoute.from);
      setTo(initialRoute.to);
      onConsumeRoute?.();
      handleRoute(initialRoute.from, initialRoute.to);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialRoute]);

  async function handleSearch(numberOverride?: string) {
    const q = (numberOverride ?? input).trim().toUpperCase().replace(/\s+/g, ' ');
    if (!q) return;
    setLoading(true); setError(''); setResult(null);
    try { setResult(await api.search(q, date !== todayLocal() ? date : undefined)); }
    catch (err: any) { setError(err.message ?? 'Search failed'); } // apiFetch puts the server's message here; data.error is only a code
    finally { setLoading(false); }
  }

  async function handleRoute(fromOverride?: string, toOverride?: string) {
    const f = (fromOverride ?? from).trim().toUpperCase(), t = (toOverride ?? to).trim().toUpperCase();
    if (!AIRPORT_RE.test(f) || !AIRPORT_RE.test(t)) { setError('Enter 3–4 letter airport codes'); return; }
    if (f === t) { setError('Departure and arrival airports must be different'); return; }
    setAnalyticsRoute({ from: f, to: t });
    setLoading(true); setError(''); setResult(null);
    try {
      const data = await api.route(f, t, date);
      setResult({ query: `${f} → ${t}`, source: data.source ?? 'aerodatabox', scheduleAvailable: true, legs: data.flights ?? [] });
    } catch (err: any) { setError(err.message ?? 'Route search failed'); }
    finally { setLoading(false); }
  }

  return (
    <div className="max-w-2xl mx-auto p-5 space-y-5">

      {/* Mode toggle */}
      <div className="inline-flex rounded-lg border border-border bg-muted p-0.5 gap-0.5">
        {(['number', 'route'] as const).map(m => (
          <button key={m} onClick={() => setMode(m)}
            className={`px-4 py-1.5 text-sm font-medium rounded-md transition-all duration-150
              ${mode === m ? 'bg-card text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'}`}>
            {m === 'number' ? '✈ Flight number' : '↔ Route'}
          </button>
        ))}
      </div>

      {/* Search form */}
      <div className="rounded-xl border border-border bg-card p-4 shadow-sm space-y-3">
        {mode === 'number' ? (
          <form onSubmit={e => { e.preventDefault(); handleSearch(); }} className="flex gap-2 flex-wrap sm:flex-nowrap">
            <input ref={inputRef} value={input} onChange={e => setInput(e.target.value)}
              className="flex-1 min-w-0 px-3 py-2.5 rounded-lg border border-input bg-background text-sm focus:outline-none focus:ring-2 focus:ring-primary/40 focus:border-primary transition"
              placeholder="e.g. 6E 5321, BA 117" autoFocus />
            <input type="date" value={date} onChange={e => setDate(e.target.value)}
              className="px-3 py-2.5 rounded-lg border border-input bg-background text-sm focus:outline-none focus:ring-2 focus:ring-primary/40 focus:border-primary transition w-40" />
            <button type="submit" disabled={loading}
              className="px-5 py-2.5 bg-primary text-primary-foreground rounded-lg text-sm font-medium hover:opacity-90 active:scale-95 transition disabled:opacity-60 shrink-0">
              Search
            </button>
          </form>
        ) : (
          <form onSubmit={e => { e.preventDefault(); handleRoute(); }} className="flex gap-2 flex-wrap">
            <input value={from} onChange={e => setFrom(e.target.value)} placeholder="From (BLR)"
              className="w-28 px-3 py-2.5 rounded-lg border border-input bg-background text-sm uppercase focus:outline-none focus:ring-2 focus:ring-primary/40 focus:border-primary transition" maxLength={4} />
            <span className="self-center text-muted-foreground text-lg">→</span>
            <input value={to} onChange={e => setTo(e.target.value)} placeholder="To (DEL)"
              className="w-28 px-3 py-2.5 rounded-lg border border-input bg-background text-sm uppercase focus:outline-none focus:ring-2 focus:ring-primary/40 focus:border-primary transition" maxLength={4} />
            <input type="date" value={date} onChange={e => setDate(e.target.value)}
              className="px-3 py-2.5 rounded-lg border border-input bg-background text-sm focus:outline-none focus:ring-2 focus:ring-primary/40 focus:border-primary transition w-40" />
            <button type="submit" disabled={loading}
              className="px-5 py-2.5 bg-primary text-primary-foreground rounded-lg text-sm font-medium hover:opacity-90 active:scale-95 transition disabled:opacity-60">
              Search
            </button>
          </form>
        )}
        <p className="text-xs text-muted-foreground">
          {mode === 'number' ? 'Airline code and number, like 6E 5321, BA 117 or UAE 1.' : 'Enter IATA or ICAO airport codes.'}
        </p>
      </div>

      {/* Loading */}
      {loading && (
        <div className="flex items-center gap-3 px-4 py-3 rounded-xl border border-border bg-card animate-fade-in">
          <svg className="animate-spin-slow w-4 h-4 text-primary shrink-0" fill="none" viewBox="0 0 24 24">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z"/>
          </svg>
          <span className="text-sm text-muted-foreground">Looking up flight…</span>
        </div>
      )}

      {/* Error */}
      {error && (
        <div className="flex items-start gap-2 px-4 py-3 rounded-xl border border-destructive/30 bg-destructive/10 text-destructive text-sm animate-fade-in">
          <span className="mt-0.5">⚠</span> {error}
        </div>
      )}

      {/* Results */}
      {result && mode === 'number' && result.legs.map((leg, i) => (
        <div key={i} className="space-y-3">
          <FlightCard leg={leg} />
          <FlightHistory number={leg.number} available={result.scheduleAvailable} />
        </div>
      ))}
      {mode === 'route' && analyticsRoute && <RouteAnalytics from={analyticsRoute.from} to={analyticsRoute.to} />}
      {result && mode === 'route' && <RouteTable legs={result.legs} />}
    </div>
  );
}

function toneCls(tone: string) {
  if (tone === 'good')    return 'tone-good';
  if (tone === 'warn')    return 'tone-warn';
  if (tone === 'bad')     return 'tone-bad';
  if (tone === 'live')    return 'tone-live';
  return 'tone-neutral';
}

function FlightCard({ leg }: { leg: SearchLeg }) {
  const status = flightStatus(leg);
  const timeline = flightTimeline(leg);
  const depTz = (leg.origin as any).airport?.timeZone;
  const arrTz = (leg.destination as any).airport?.timeZone;

  const depDelay = status.depDelay;
  const arrDelay = status.arrDelay;
  // Show arrival delay (ETA − STA) when available; fall back to departure delay.
  const delayVal = arrDelay ?? depDelay;

  return (
    <div className="rounded-xl border border-border bg-card shadow-sm overflow-hidden animate-fade-in">
      {/* Top band — flight number + airline */}
      <div className="flex items-start justify-between px-5 py-4 border-b border-border/60">
        <div>
          <div className="font-bold text-xl tracking-tight">{leg.number ?? '—'}</div>
          <div className="text-sm text-muted-foreground mt-0.5 flex items-center gap-1.5 flex-wrap">
            {leg.airline?.iata ? (
              <button
                onClick={() => { window.location.hash = `#airline/${encodeURIComponent(leg.airline!.iata!)}`; }}
                className="hover:text-primary hover:underline underline-offset-2 transition-colors"
              >
                {leg.airline.name}
              </button>
            ) : (leg.airline?.name ?? null)}
            {leg.aircraft?.model && <span>· {leg.aircraft.model}</span>}
          </div>
        </div>
      </div>

      {/* Route bar */}
      <div className="flex items-center gap-4 px-5 py-4 border-b border-border/60">
        <div className="text-center min-w-[64px]">
          <div className="text-3xl font-extrabold tracking-tight">{airportCode(leg.origin.airport)}</div>
          <div className="text-xs text-muted-foreground mt-0.5 truncate max-w-[90px]">
            {(leg.origin as any).airport?.name ?? ''}
          </div>
        </div>

        <div className="flex-1 flex items-center gap-1">
          <div className="flex-1 h-px bg-border" />
          <svg className="w-5 h-5 text-primary" fill="currentColor" viewBox="0 0 24 24">
            <path d="M21 16v-2l-8-5V3.5A1.5 1.5 0 0011.5 2 1.5 1.5 0 0010 3.5V9l-8 5v2l8-2.5V19l-2 1.5V22l3.5-1 3.5 1v-1.5L13 19v-5.5l8 2.5z"/>
          </svg>
          <div className="flex-1 h-px bg-border" />
        </div>

        <div className="text-center min-w-[64px]">
          <div className="text-3xl font-extrabold tracking-tight">{airportCode(leg.destination.airport)}</div>
          <div className="text-xs text-muted-foreground mt-0.5 truncate max-w-[90px]">
            {(leg.destination as any).airport?.name ?? ''}
          </div>
        </div>
      </div>

      {/* Info row — STD · ETD · STA · ETA · Delay · Status */}
      <div className="grid grid-cols-3 sm:grid-cols-6 divide-x divide-border/60 border-b border-border/60">
        <InfoCell label="STD" sublabel="Sched. dep" value={fmtClock(leg.origin.scheduled, depTz) || '—'} />
        <InfoCell
          label="ETD"
          sublabel="Est. dep"
          value={fmtClock(leg.origin.estimated ?? leg.origin.scheduled, depTz) || '—'}
          tone={depDelay != null && depDelay >= 15 ? (depDelay >= 45 ? 'bad' : 'warn') : depDelay != null && depDelay < 0 ? 'good' : undefined}
        />
        <InfoCell label="STA" sublabel="Sched. arr" value={fmtClock(leg.destination.scheduled, arrTz) || '—'} />
        <InfoCell
          label="ETA"
          sublabel="Est. arr"
          value={fmtClock(leg.destination.estimated ?? leg.destination.scheduled, arrTz) || '—'}
          tone={arrDelay != null && arrDelay >= 15 ? (arrDelay >= 45 ? 'bad' : 'warn') : arrDelay != null && arrDelay < 0 ? 'good' : undefined}
        />
        <InfoCell
          label="Delay"
          sublabel="Arrival (ETA−STA)"
          value={fmtDelayMinutes(delayVal) || '—'}
          tone={delayVal != null && delayVal >= 15 ? (delayVal >= 45 ? 'bad' : 'warn') : delayVal != null && delayVal < 0 ? 'good' : undefined}
        />
        <div className="px-4 py-3 flex flex-col justify-center">
          <span className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold mb-1.5">Status</span>
          <span className={`inline-flex items-center gap-1.5 text-xs font-semibold px-2.5 py-1 rounded-full w-fit ${toneCls(status.tone)}`}>
            <span>{status.icon}</span>
            <span>{status.text}</span>
          </span>
          {status.detail && (
            <span className="text-[10px] text-muted-foreground mt-1">· {status.detail}</span>
          )}
        </div>
      </div>

      {/* Route details — from / to with times */}
      <div className="grid grid-cols-2 divide-x divide-border/60 border-b border-border/60">
        <div className="px-5 py-3 space-y-1">
          <div className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">From</div>
          <div className="text-2xl font-bold">{airportCode(leg.origin.airport)}</div>
          <div className="text-xs text-muted-foreground">{(leg.origin as any).airport?.municipalityName} · {(leg.origin as any).airport?.name}</div>
          <div className="flex gap-3 text-xs mt-1">
            <span className="text-muted-foreground">Scheduled <span className="text-foreground font-medium">{fmtClock(leg.origin.scheduled, depTz) || '—'}</span></span>
          </div>
          <div className="flex gap-3 text-xs">
            <span className="text-muted-foreground">Estimated <span className={`font-medium ${delayClass(depDelay)}`}>{fmtClock(leg.origin.estimated, depTz) || '—'}</span></span>
          </div>
        </div>
        <div className="px-5 py-3 space-y-1">
          <div className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">To</div>
          <div className="text-2xl font-bold">{airportCode(leg.destination.airport)}</div>
          <div className="text-xs text-muted-foreground">{(leg.destination as any).airport?.municipalityName} · {(leg.destination as any).airport?.name}</div>
          <div className="flex gap-3 text-xs mt-1">
            <span className="text-muted-foreground">Scheduled <span className="text-foreground font-medium">{fmtClock(leg.destination.scheduled, arrTz) || '—'}</span></span>
          </div>
          <div className="flex gap-3 text-xs">
            <span className="text-muted-foreground">Estimated <span className={`font-medium ${delayClass(arrDelay)}`}>{fmtClock(leg.destination.estimated, arrTz) || '—'}</span></span>
          </div>
        </div>
      </div>

      {/* Timeline */}
      <div className="px-4 py-4">
        <ol className="flex">
          {timeline.map((step, i) => {
            const isDone      = step.state === 'done';
            const isCurrent   = step.state === 'current';
            const isCancelled = step.state === 'cancelled';
            return (
              <li key={step.key} className="flex-1 flex flex-col items-center text-center gap-1">
                <div className={`w-3 h-3 rounded-full border-2 transition-colors
                  ${isCurrent   ? 'bg-primary border-primary shadow-[0_0_0_3px] shadow-primary/30' :
                    isDone      ? 'bg-muted-foreground border-muted-foreground' :
                    isCancelled ? 'bg-destructive border-destructive' :
                                  'bg-background border-border'}`} />
                <span className={`text-[10px] leading-tight ${
                  isCurrent   ? 'text-primary font-semibold' :
                  isCancelled ? 'text-destructive line-through' :
                  isDone      ? 'text-muted-foreground' :
                                'text-muted-foreground/50'}`}>
                  {step.label}
                </span>
                {step.time && (
                  <span className="text-[10px] text-muted-foreground">{fmtClock(step.time, step.timeZone)}</span>
                )}
              </li>
            );
          })}
        </ol>
      </div>

      {/* Notes */}
      {(leg as any).notes?.length > 0 && (
        <div className="px-5 py-2 bg-muted/40 border-t border-border/60 text-xs text-muted-foreground">
          {(leg as any).notes.join(' · ')}
        </div>
      )}
    </div>
  );
}

function InfoCell({ label, sublabel, value, tone }: {
  label: string; sublabel?: string; value: string;
  tone?: 'good' | 'warn' | 'bad';
}) {
  const valCls = tone === 'bad'  ? 'text-red-500 dark:text-red-400' :
                 tone === 'warn' ? 'text-amber-500 dark:text-amber-400' :
                 tone === 'good' ? 'text-emerald-500 dark:text-emerald-400' :
                 'text-foreground';
  return (
    <div className="px-3 py-3">
      <div className="flex items-baseline gap-1 mb-1">
        <span className="text-xs font-bold text-foreground">{label}</span>
        {sublabel && <span className="text-[10px] text-muted-foreground hidden sm:inline">{sublabel}</span>}
      </div>
      <div className={`text-base font-semibold tabular-nums ${valCls}`}>{value}</div>
    </div>
  );
}


const STATUS_MAP: Record<string, { icon: string; label: string; cls: string }> = {
  Expected:          { icon: '🟢', label: 'Scheduled',        cls: 'text-emerald-500' },
  Delayed:           { icon: '🟠', label: 'Delayed',          cls: 'text-amber-500' },
  CheckIn:           { icon: '🟢', label: 'Check-in',         cls: 'text-emerald-500' },
  Boarding:          { icon: '🟢', label: 'Boarding',         cls: 'text-emerald-500' },
  GateClosed:        { icon: '🟢', label: 'Gate closed',      cls: 'text-emerald-500' },
  Departed:          { icon: '✈️',  label: 'Departed',         cls: 'text-sky-500' },
  EnRoute:           { icon: '✈️',  label: 'In the air',       cls: 'text-sky-500' },
  Approaching:       { icon: '✈️',  label: 'Approaching',      cls: 'text-sky-500' },
  Arrived:           { icon: '🟢', label: 'Landed',           cls: 'text-emerald-500' },
  Canceled:          { icon: '🔴', label: 'Cancelled',        cls: 'text-red-500' },
  CanceledUncertain: { icon: '🔴', label: 'Poss. cancelled',  cls: 'text-red-500' },
  Diverted:          { icon: '🔴', label: 'Diverted',         cls: 'text-red-500' },
  OnGround:          { icon: '⚪', label: 'On the ground',    cls: 'text-muted-foreground' },
  Unknown:           { icon: '⚪', label: 'Unknown',          cls: 'text-muted-foreground' },
};

function routeStatus(raw: string | null | undefined) {
  if (!raw) return { icon: '⚪', label: '—', cls: 'text-muted-foreground' };
  return STATUS_MAP[raw] ?? { icon: '⚪', label: raw, cls: 'text-muted-foreground' };
}

// ─── Flight History ────────────────────────────────────────────────────────

function fmtHistoryDate(dateStr: string): string {
  const d = new Date(dateStr + 'T00:00:00');
  return d.toLocaleDateString('en-IN', { weekday: 'short', month: 'short', day: 'numeric' });
}

function FlightHistory({ number, available }: { number: string | null; available: boolean }) {
  const [history, setHistory]     = useState<any[] | null>(null);
  const [loading, setLoading]     = useState(false);
  const [open, setOpen]           = useState(true);

  useEffect(() => {
    if (!number || !available) return;
    setLoading(true);
    setHistory(null);
    api.flightHistory(number)
      .then(setHistory)
      .catch(() => setHistory([]))
      .finally(() => setLoading(false));
  }, [number, available]);

  if (!available) return null;

  const maxAbs = Math.max(...(history ?? []).map(r => Math.abs(r.delay ?? 0)), 1);

  const barColor = (r: any): string => {
    if (r.cancelled) return 'bg-red-500';
    if (r.delay == null) return 'bg-muted';
    if (r.delay >= 45) return 'bg-red-500';
    if (r.delay >= 15) return 'bg-amber-500';
    if (r.delay >  0)  return 'bg-yellow-400';
    return 'bg-emerald-500';
  };

  return (
    <div className="rounded-xl border border-border bg-card shadow-sm overflow-hidden animate-fade-in">
      <button
        onClick={() => setOpen(o => !o)}
        className="w-full flex items-center justify-between px-4 py-3 text-sm font-semibold hover:bg-accent/40 transition-colors select-none"
      >
        <span className="flex items-center gap-2">
          <span>📅</span>
          <span>Flight history · last 7 days</span>
        </span>
        <span className={`text-muted-foreground text-xs transition-transform duration-150 ${open ? '' : '-rotate-90'}`}>▼</span>
      </button>

      {open && (
        <div className="border-t border-border">
          {/* Skeleton while loading */}
          {loading && (
            <div className="divide-y divide-border">
              {Array.from({ length: 7 }).map((_, i) => (
                <div key={i} className="px-4 py-2.5 flex items-center gap-3">
                  <div className="skeleton h-3 w-28 rounded" />
                  <div className="skeleton flex-1 h-2 rounded mx-4" />
                  <div className="skeleton h-3 w-10 rounded" />
                </div>
              ))}
            </div>
          )}

          {!loading && history?.length === 0 && (
            <p className="px-4 py-6 text-center text-sm text-muted-foreground">No history data available</p>
          )}

          {!loading && history && history.length > 0 && (
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-muted text-muted-foreground text-xs uppercase tracking-wide">
                  <th className="px-4 py-2 text-left font-semibold w-36">Date</th>
                  <th className="px-4 py-2 text-left font-semibold">Delay</th>
                  <th className="px-4 py-2 text-right font-semibold w-24 pr-5">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {history.map((r, i) => {
                  const delay = r.delay ?? null;
                  const pct   = delay != null ? Math.min((Math.abs(delay) / maxAbs) * 100, 100) : 0;
                  const s     = STATUS_MAP[r.status ?? ''];
                  return (
                    <tr key={i} style={{ animationDelay: `${i * 35}ms` }} className="animate-fade-in">
                      <td className="px-4 py-2.5 text-xs text-muted-foreground tabular-nums">{fmtHistoryDate(r.date)}</td>
                      <td className="px-4 py-2.5">
                        <div className="flex items-center gap-2.5">
                          <div className="w-24 h-1.5 bg-muted rounded-full overflow-hidden shrink-0">
                            <div className={`h-1.5 rounded-full transition-all duration-500 ${barColor(r)}`}
                              style={{ width: `${pct}%` }} />
                          </div>
                          <span className={`text-xs font-medium tabular-nums ${delayClass(delay)}`}>
                            {r.cancelled ? 'Cancelled' : fmtDelayMinutes(delay) || 'On time'}
                          </span>
                        </div>
                      </td>
                      <td className="px-5 py-2.5 text-right">
                        {s ? (
                          <span className={`text-xs ${s.cls}`}>{s.icon} {s.label}</span>
                        ) : r.status ? (
                          <span className="text-xs text-muted-foreground">{r.status}</span>
                        ) : null}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Route Table ────────────────────────────────────────────────────────────

type SortKey = 'number' | 'dep' | 'arr' | 'delay';
type SortDir = 'asc' | 'desc';
type StatusFilter = 'all' | 'ontime' | 'delayed' | 'airborne' | 'landed' | 'cancelled';

const AIRBORNE = new Set(['Departed', 'EnRoute', 'Approaching']);
const LANDED   = new Set(['Arrived']);
const CANCELLED = new Set(['Canceled', 'CanceledUncertain']);

function RouteTable({ legs }: { legs: any[] }) {
  const [sort, setSort]         = useState<{ key: SortKey; dir: SortDir }>({ key: 'dep', dir: 'asc' });
  const [filter, setFilter]     = useState<StatusFilter>('all');

  const go = (number: string | null) => {
    if (!number) return;
    window.location.hash = `#flight/${encodeURIComponent(number)}`;
  };

  const toggleSort = (key: SortKey) => setSort(prev =>
    prev.key === key ? { key, dir: prev.dir === 'asc' ? 'desc' : 'asc' } : { key, dir: 'asc' }
  );

  // Stats
  const total     = legs.length;
  const onTime    = legs.filter(f => !f.status || ['Expected','CheckIn','Boarding','GateClosed'].includes(f.status)).length;
  const delayed   = legs.filter(f => f.status === 'Delayed' || (f.delayMin ?? 0) >= 15).length;
  const airborne  = legs.filter(f => AIRBORNE.has(f.status)).length;
  const landed    = legs.filter(f => LANDED.has(f.status)).length;
  const cancelled = legs.filter(f => CANCELLED.has(f.status)).length;
  const maxDelay  = Math.max(...legs.map(f => f.delayMin ?? 0), 1);

  // Filter
  const filtered = legs.filter(f => {
    if (filter === 'all')       return true;
    if (filter === 'ontime')    return !AIRBORNE.has(f.status) && !LANDED.has(f.status) && !CANCELLED.has(f.status) && (f.delayMin ?? 0) < 15 && f.status !== 'Delayed';
    if (filter === 'delayed')   return f.status === 'Delayed' || (f.delayMin ?? 0) >= 15;
    if (filter === 'airborne')  return AIRBORNE.has(f.status);
    if (filter === 'landed')    return LANDED.has(f.status);
    if (filter === 'cancelled') return CANCELLED.has(f.status);
    return true;
  });

  // Sort
  const sorted = [...filtered].sort((a, b) => {
    let av = 0, bv = 0;
    if (sort.key === 'number') return sort.dir === 'asc'
      ? (a.number ?? '').localeCompare(b.number ?? '')
      : (b.number ?? '').localeCompare(a.number ?? '');
    if (sort.key === 'dep')   { av = a.origin?.scheduled ?? 0;      bv = b.origin?.scheduled ?? 0; }
    if (sort.key === 'arr')   { av = a.destination?.scheduled ?? 0; bv = b.destination?.scheduled ?? 0; }
    if (sort.key === 'delay') { av = a.delayMin ?? 0;               bv = b.delayMin ?? 0; }
    return sort.dir === 'asc' ? av - bv : bv - av;
  });

  const SortIcon = ({ k }: { k: SortKey }) => (
    <span className="ml-1 text-[10px] opacity-60">
      {sort.key === k ? (sort.dir === 'asc' ? '▲' : '▼') : '⇅'}
    </span>
  );

  type FilterChip = { id: StatusFilter; label: string; count: number; cls: string };
  const FILTERS: FilterChip[] = ([
    { id: 'all',       label: 'All',       count: total,     cls: '' },
    { id: 'ontime',    label: 'On time',   count: onTime,    cls: 'text-emerald-600 dark:text-emerald-400' },
    { id: 'delayed',   label: 'Delayed',   count: delayed,   cls: 'text-amber-600 dark:text-amber-400' },
    { id: 'airborne',  label: 'Airborne',  count: airborne,  cls: 'text-sky-600 dark:text-sky-400' },
    { id: 'landed',    label: 'Landed',    count: landed,    cls: 'text-emerald-600 dark:text-emerald-400' },
    { id: 'cancelled', label: 'Cancelled', count: cancelled, cls: 'text-red-600 dark:text-red-400' },
  ] as FilterChip[]).filter(f => f.id === 'all' || f.count > 0); // typed before filter() so ids stay StatusFilter

  return (
    <div className="space-y-3 animate-fade-in">

      {/* Stats bar */}
      <div className="grid grid-cols-4 gap-2">
        {[
          { label: 'Total',     value: total,     color: 'text-foreground' },
          { label: 'On time',   value: onTime,    color: 'text-emerald-500' },
          { label: 'Delayed',   value: delayed,   color: 'text-amber-500' },
          { label: 'Cancelled', value: cancelled, color: 'text-red-500' },
        ].map(s => (
          <div key={s.label} className="rounded-xl border border-border bg-card px-3 py-2.5 text-center shadow-sm">
            <div className={`text-xl font-bold ${s.color}`}>{s.value}</div>
            <div className="text-[11px] text-muted-foreground">{s.label}</div>
          </div>
        ))}
      </div>

      {/* Filter chips */}
      <div className="flex flex-wrap gap-1.5">
        {FILTERS.map(f => (
          <button key={f.id} onClick={() => setFilter(f.id)}
            className={`flex items-center gap-1.5 px-3 py-1 text-xs font-medium rounded-full border transition-all
              ${filter === f.id
                ? 'bg-primary text-primary-foreground border-primary'
                : 'bg-card border-border text-muted-foreground hover:border-primary/50 hover:text-foreground'}`}>
            <span className={filter === f.id ? '' : f.cls}>{f.label}</span>
            <span className={`px-1.5 py-0.5 rounded-full text-[10px] font-bold
              ${filter === f.id ? 'bg-white/20' : 'bg-muted'}`}>
              {f.count}
            </span>
          </button>
        ))}
      </div>

      {/* Table */}
      <div className="rounded-xl border border-border overflow-hidden shadow-sm">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-muted text-muted-foreground text-xs uppercase tracking-wide">
              {([
                { key: 'number', label: 'Flight' },
                { key: 'dep',    label: 'Dep' },
                { key: 'arr',    label: 'Arr' },
                { key: 'delay',  label: 'Delay' },
              ] as { key: SortKey; label: string }[]).map(col => (
                <th key={col.key}
                  onClick={() => toggleSort(col.key)}
                  className="px-4 py-2.5 text-left font-semibold cursor-pointer hover:text-foreground hover:bg-accent/50 select-none transition-colors">
                  {col.label}<SortIcon k={col.key} />
                </th>
              ))}
              <th className="px-4 py-2.5 text-left font-semibold">Status</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {sorted.map((f, i) => {
              const delay = f.delayMin ?? null;
              const s = routeStatus(f.status);
              const delayPct = delay && delay > 0 ? Math.min((delay / maxDelay) * 100, 100) : 0;
              const isCancelled = CANCELLED.has(f.status);
              return (
                <tr
                  key={i}
                  onClick={() => go(f.number)}
                  style={{ animationDelay: `${i * 30}ms` }}
                  className={`cursor-pointer transition-colors group animate-fade-in
                    ${isCancelled ? 'opacity-50' : 'hover:bg-primary/10'}`}
                >
                  <td className="px-4 py-3">
                    <span className="font-mono font-semibold text-primary group-hover:underline underline-offset-2">
                      {f.number ?? '—'}
                    </span>
                    {f.airline?.name && (
                      <div className="text-[11px] text-muted-foreground mt-0.5">{f.airline.name}</div>
                    )}
                  </td>
                  <td className="px-4 py-3 font-medium tabular-nums">
                    {f.origin?.scheduledLocal ?? fmtClock(f.origin?.scheduled) ?? '—'}
                  </td>
                  <td className="px-4 py-3 font-medium tabular-nums">
                    {f.destination?.scheduledLocal ?? fmtClock(f.destination?.scheduled) ?? '—'}
                  </td>
                  <td className="px-4 py-3">
                    <div className={`font-medium text-sm ${delayClass(delay)}`}>
                      {fmtDelayMinutes(delay) || 'On time'}
                    </div>
                    {delayPct > 0 && (
                      <div className="mt-1 h-1 w-20 bg-muted rounded-full overflow-hidden">
                        <div className={`h-1 rounded-full transition-all duration-500
                          ${delay! >= 45 ? 'bg-red-500' : delay! >= 15 ? 'bg-amber-500' : 'bg-emerald-500'}`}
                          style={{ width: `${delayPct}%` }} />
                      </div>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center justify-between gap-2">
                      <span className={`flex items-center gap-1.5 text-xs font-medium ${s.cls}`}>
                        <span>{s.icon}</span>
                        <span>{s.label}</span>
                      </span>
                      <span className="opacity-0 group-hover:opacity-100 transition-opacity text-primary text-xs shrink-0">→</span>
                    </div>
                  </td>
                </tr>
              );
            })}
            {sorted.length === 0 && (
              <tr><td colSpan={5} className="px-4 py-8 text-center text-sm text-muted-foreground">No flights match this filter</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
