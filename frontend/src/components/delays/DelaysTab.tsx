'use client';

import { useState, useEffect } from 'react';
import { api } from '@/lib/api';
import { DelaysResult, DelayFlight } from '@/lib/types';
import { delayClass, fmtDuration, airportCode, DELAYED_MIN } from '@/lib/format';
import { fmtDelayMinutes } from '@/lib/flight-status';

interface Props { initialAirport: string | null; onConsumeAirport: () => void }
type Direction = 'Both' | 'Arrival' | 'Departure';

const DIR_ICONS: Record<Direction, string> = { Both: '↕', Arrival: '↓', Departure: '↑' };

export function DelaysTab({ initialAirport, onConsumeAirport }: Props) {
  const [airportInput, setAirportInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [data, setData] = useState<DelaysResult | null>(null);
  const [error, setError] = useState('');
  const [direction, setDirection] = useState<Direction>('Both');
  const [rankMetric, setRankMetric] = useState<'total' | 'delayed' | 'pct' | 'avg'>('total');
  const [now, setNow] = useState(() => Date.now());

  // Keeps "updated N min ago" current while the board is on screen.
  useEffect(() => {
    if (!data) return;
    setNow(Date.now());
    const t = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(t);
  }, [data]);

  useEffect(() => {
    if (initialAirport) { setAirportInput(initialAirport); onConsumeAirport(); load(initialAirport); }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialAirport]);

  async function load(code?: string) {
    const c = (code ?? airportInput).trim().toUpperCase();
    if (!/^[A-Z0-9]{3,4}$/.test(c)) { setError('Enter a 3 or 4 letter airport code'); return; }
    setLoading(true); setError(''); setData(null);
    try { setData(await api.delays(c)); }
    catch (err: any) { setError(err.data?.error ?? err.message ?? 'Failed to load delays'); }
    finally { setLoading(false); }
  }

  const flights = (data?.flights ?? []).filter(f => direction === 'Both' || f.direction === direction);

  const byAirline = new Map<string, { name: string; flights: number; delayed: number; totalMin: number }>();
  for (const f of flights) {
    if (!f.airline?.name) continue;
    const key = f.airline.name;
    if (!byAirline.has(key)) byAirline.set(key, { name: key, flights: 0, delayed: 0, totalMin: 0 });
    const r = byAirline.get(key)!;
    r.flights++;
    if ((f.delayMin ?? 0) >= DELAYED_MIN) { r.delayed++; r.totalMin += f.delayMin ?? 0; }
  }

  const METRICS = {
    total:   { label: 'Total delay',     value: (r: any) => r.totalMin,             fmt: (v: number) => fmtDuration(v) },
    delayed: { label: 'Delayed flights', value: (r: any) => r.delayed,              fmt: (v: number) => `${v} flights` },
    pct:     { label: '% delayed',       value: (r: any) => r.delayed / r.flights,  fmt: (v: number) => `${(v * 100).toFixed(0)}%` },
    avg:     { label: 'Avg delay',       value: (r: any) => r.totalMin / r.flights, fmt: (v: number) => fmtDuration(Math.round(v)) },
  };

  const ranked = [...byAirline.values()]
    .sort((a, b) => METRICS[rankMetric].value(b) - METRICS[rankMetric].value(a))
    .slice(0, 12);
  const maxRank = ranked[0] ? METRICS[rankMetric].value(ranked[0]) : 1;

  const delayedCount = flights.filter(f => (f.delayMin ?? 0) >= DELAYED_MIN).length;
  const cancelledCount = flights.filter(f => f.cancelled).length;

  return (
    <div className="max-w-3xl mx-auto p-5 space-y-5">

      {/* Search */}
      <div className="rounded-xl border border-border bg-card shadow-sm p-4">
        <form onSubmit={e => { e.preventDefault(); load(); }} className="flex gap-2">
          <input
            value={airportInput}
            onChange={e => setAirportInput(e.target.value.toUpperCase())}
            placeholder="Airport code (BLR, VABB…)"
            maxLength={4}
            className="flex-1 px-3 py-2.5 rounded-lg border border-input bg-background text-sm font-mono uppercase focus:outline-none focus:ring-2 focus:ring-primary/40 focus:border-primary transition"
          />
          <button type="submit" disabled={loading}
            className="px-5 py-2.5 bg-primary text-primary-foreground rounded-lg text-sm font-medium hover:opacity-90 active:scale-95 transition disabled:opacity-60">
            Load
          </button>
        </form>
      </div>

      {/* Loading */}
      {loading && (
        <div className="flex items-center gap-3 px-4 py-3 rounded-xl border border-border bg-card animate-fade-in">
          <svg className="animate-spin-slow w-4 h-4 text-primary shrink-0" fill="none" viewBox="0 0 24 24">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z"/>
          </svg>
          <span className="text-sm text-muted-foreground">Loading airport board…</span>
        </div>
      )}

      {error && (
        <div className="flex items-start gap-2 px-4 py-3 rounded-xl border border-destructive/30 bg-destructive/10 text-destructive text-sm animate-fade-in">
          <span>⚠</span> {error}
        </div>
      )}

      {data && (
        <div className="space-y-4 animate-fade-in">
          <BoardPeriod data={data} now={now} />

          {/* Stats row */}
          <div className="grid grid-cols-3 gap-3">
            {[
              { label: 'Total flights', value: flights.length, icon: '✈', color: 'text-foreground' },
              { label: 'Delayed',       value: delayedCount,   icon: '🟠', color: 'text-amber-600 dark:text-amber-400' },
              { label: 'Cancelled',     value: cancelledCount, icon: '🔴', color: 'text-red-600 dark:text-red-400' },
            ].map(s => (
              <div key={s.label} className="rounded-xl border border-border bg-card px-4 py-3 text-center shadow-sm">
                <div className={`text-2xl font-bold ${s.color}`}>{s.value}</div>
                <div className="text-xs text-muted-foreground mt-0.5">{s.label}</div>
              </div>
            ))}
          </div>

          {/* Direction filter */}
          <div className="inline-flex rounded-lg border border-border bg-muted p-0.5 gap-0.5">
            {(['Both', 'Departure', 'Arrival'] as Direction[]).map(d => (
              <button key={d} onClick={() => setDirection(d)}
                className={`flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium rounded-md transition-all duration-150
                  ${direction === d ? 'bg-card text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'}`}>
                <span className="text-xs">{DIR_ICONS[d]}</span>{d}
              </button>
            ))}
          </div>

          {/* Airline ranking */}
          {ranked.length > 0 && (
            <div className="rounded-xl border border-border bg-card shadow-sm p-4">
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-sm font-semibold">Airlines by delay</h2>
                <div className="inline-flex rounded-md border border-border bg-muted p-0.5 gap-0.5">
                  {Object.entries(METRICS).map(([k, v]) => (
                    <button key={k} onClick={() => setRankMetric(k as any)}
                      className={`px-2.5 py-1 text-xs font-medium rounded transition-all duration-150
                        ${rankMetric === k ? 'bg-card text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'}`}>
                      {v.label}
                    </button>
                  ))}
                </div>
              </div>
              <div className="space-y-2">
                {ranked.map((r, i) => {
                  const val = METRICS[rankMetric].value(r);
                  const pct = maxRank > 0 ? (val / maxRank) * 100 : 0;
                  const hue = 220 - i * 8;
                  return (
                    <div key={r.name} className="flex items-center gap-3 text-xs group">
                      <span className="w-4 text-muted-foreground text-right">{i + 1}</span>
                      <span className="w-36 truncate text-muted-foreground group-hover:text-foreground transition-colors">{r.name}</span>
                      <div className="flex-1 bg-muted rounded-full h-2.5 overflow-hidden">
                        <div className="h-2.5 rounded-full transition-all duration-500"
                          style={{ width: `${pct}%`, background: `hsl(${hue} 70% 55%)` }} />
                      </div>
                      <span className="w-20 text-right font-medium">{METRICS[rankMetric].fmt(val)}</span>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Flight table */}
          <div className="rounded-xl border border-border overflow-hidden shadow-sm">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-muted text-muted-foreground text-xs uppercase tracking-wide">
                  {['Flight', 'Dir', 'Airport', 'Scheduled', 'Estimated', 'Delay', 'Status'].map(h => (
                    <th key={h} className="px-3 py-2.5 text-left font-semibold whitespace-nowrap">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {flights.slice(0, 300).map((f, i) => (
                  <tr key={i} className={`transition-colors hover:bg-accent/40 ${f.cancelled ? 'opacity-40' : ''}`}>
                    <td className="px-3 py-2 font-mono font-medium">{f.number ?? '—'}</td>
                    <td className="px-3 py-2">
                      <span className={`inline-flex items-center gap-1 text-xs px-1.5 py-0.5 rounded font-medium
                        ${f.direction === 'Departure' ? 'bg-sky-100 text-sky-700 dark:bg-sky-950 dark:text-sky-300' : 'bg-violet-100 text-violet-700 dark:bg-violet-950 dark:text-violet-300'}`}>
                        {f.direction === 'Departure' ? '↑' : '↓'} {f.direction.slice(0, 3)}
                      </span>
                    </td>
                    <td className="px-3 py-2 font-mono text-muted-foreground">{f.other?.iata ?? f.other?.icao ?? '—'}</td>
                    <td className="px-3 py-2 text-muted-foreground">{f.scheduledLocal ?? '—'}</td>
                    <td className="px-3 py-2 text-muted-foreground">{f.bestLocal ?? (f.cancelled ? '✕ Cancelled' : '—')}</td>
                    <td className={`px-3 py-2 font-semibold ${delayClass(f.delayMin)}`}>{fmtDelayMinutes(f.delayMin)}</td>
                    <td className="px-3 py-2 text-xs text-muted-foreground">{f.status ?? '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

const HOUR_MS = 3_600_000;

/** "Last 6 h · next 6 h · updated 4 min ago" — the period the board covers and how old it is. */
function BoardPeriod({ data, now }: { data: DelaysResult; now: number }) {
  const { window: w, fetchedAt } = data;
  const back = w ? Math.round((fetchedAt - w.from) / HOUR_MS) : 6;
  const ahead = w ? Math.round((w.to - fetchedAt) / HOUR_MS) : 6;
  const mins = fetchedAt ? Math.max(0, Math.floor((now - fetchedAt) / 60_000)) : null;
  const age = mins == null ? null : mins < 1 ? 'updated just now' : `updated ${mins} min ago`;
  const time = (t: number) => new Date(t).toLocaleString([], { weekday: 'short', hour: '2-digit', minute: '2-digit' });
  const range = w ? `${time(w.from)} – ${time(w.to)} (your time)` : undefined;

  return (
    <p className="text-xs text-muted-foreground" title={range}>
      <span className="font-medium text-foreground">{data.airport}</span>
      {' · '}Last {back} h · next {ahead} h{age && ` · ${age}`}
    </p>
  );
}
