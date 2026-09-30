'use client';

import { useState, useEffect } from 'react';
import { api } from '@/lib/api';
import { DelaysResult, DelayFlight } from '@/lib/types';
import { delayClass, fmtDuration, airportCode, DELAYED_MIN } from '@/lib/format';
import { fmtDelayMinutes } from '@/lib/flight-status';

interface Props { initialAirport: string | null; onConsumeAirport: () => void }

type Direction = 'Both' | 'Arrival' | 'Departure';

export function DelaysTab({ initialAirport, onConsumeAirport }: Props) {
  const [airportInput, setAirportInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [data, setData] = useState<DelaysResult | null>(null);
  const [error, setError] = useState('');
  const [direction, setDirection] = useState<Direction>('Both');
  const [rankMetric, setRankMetric] = useState<'total' | 'delayed' | 'pct' | 'avg'>('total');

  useEffect(() => {
    if (initialAirport) {
      setAirportInput(initialAirport);
      onConsumeAirport();
      load(initialAirport);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialAirport]);

  async function load(code?: string) {
    const c = (code ?? airportInput).trim().toUpperCase();
    if (!/^[A-Z0-9]{3,4}$/.test(c)) { setError('Enter a 3 or 4 letter airport code'); return; }
    setLoading(true); setError(''); setData(null);
    try {
      const result = await api.delays(c);
      setData(result);
    } catch (err: any) {
      setError(err.data?.error ?? err.message ?? 'Failed to load delays');
    } finally { setLoading(false); }
  }

  const flights = (data?.flights ?? []).filter(f => direction === 'Both' || f.direction === direction);

  // Airline rankings
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
    total: { label: 'Total delay', value: (r: any) => r.totalMin, fmt: (v: number) => fmtDuration(v) },
    delayed: { label: 'Delayed flights', value: (r: any) => r.delayed, fmt: (v: number) => String(v) },
    pct: { label: '% delayed', value: (r: any) => r.delayed / r.flights, fmt: (v: number) => `${(v * 100).toFixed(0)}%` },
    avg: { label: 'Avg delay', value: (r: any) => r.totalMin / r.flights, fmt: (v: number) => fmtDuration(Math.round(v)) },
  };
  const ranked = [...byAirline.values()].sort((a, b) => METRICS[rankMetric].value(b) - METRICS[rankMetric].value(a)).slice(0, 15);
  const maxRank = ranked[0] ? METRICS[rankMetric].value(ranked[0]) : 1;

  return (
    <div className="max-w-3xl mx-auto p-4 space-y-4">
      <form onSubmit={e => { e.preventDefault(); load(); }} className="flex gap-2">
        <input
          value={airportInput}
          onChange={e => setAirportInput(e.target.value.toUpperCase())}
          placeholder="Airport (BLR, VABB…)"
          maxLength={4}
          className="w-32 px-3 py-2 rounded border border-input bg-background text-sm font-mono uppercase"
        />
        <button type="submit" className="px-4 py-2 bg-primary text-primary-foreground rounded text-sm">Load</button>
      </form>

      {loading && <p className="text-sm text-muted-foreground">Loading…</p>}
      {error && <p className="text-sm text-destructive">{error}</p>}

      {data && (
        <>
          {/* Direction filter */}
          <div className="flex gap-2">
            {(['Both', 'Departure', 'Arrival'] as Direction[]).map(d => (
              <button key={d} onClick={() => setDirection(d)}
                className={`px-3 py-1 text-sm rounded-full ${direction === d ? 'bg-primary text-primary-foreground' : 'bg-secondary text-secondary-foreground'}`}>
                {d}
              </button>
            ))}
          </div>

          {/* Airline ranking chart */}
          {ranked.length > 0 && (
            <div className="border border-border rounded-lg p-4 bg-card">
              <div className="flex items-center justify-between mb-3">
                <h2 className="text-sm font-semibold">Airlines by delay</h2>
                <select
                  value={rankMetric}
                  onChange={e => setRankMetric(e.target.value as any)}
                  className="text-xs border border-input bg-background rounded px-2 py-1"
                >
                  {Object.entries(METRICS).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
                </select>
              </div>
              <div className="space-y-1">
                {ranked.map(r => {
                  const val = METRICS[rankMetric].value(r);
                  const pct = maxRank > 0 ? (val / maxRank) * 100 : 0;
                  return (
                    <div key={r.name} className="flex items-center gap-2 text-xs">
                      <span className="w-32 truncate text-muted-foreground">{r.name}</span>
                      <div className="flex-1 bg-muted rounded-full h-2">
                        <div className="bg-primary h-2 rounded-full" style={{ width: `${pct}%` }} />
                      </div>
                      <span className="w-16 text-right">{METRICS[rankMetric].fmt(val)}</span>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Flight table */}
          <div className="overflow-x-auto rounded-lg border border-border">
            <table className="w-full text-sm">
              <thead className="bg-muted text-muted-foreground">
                <tr>
                  {['Flight', 'Dir', 'Other', 'Sched', 'Best', 'Delay', 'Status'].map(h => (
                    <th key={h} className="px-2 py-2 text-left font-medium">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {flights.slice(0, 300).map((f, i) => (
                  <tr key={i} className={`border-t border-border ${f.cancelled ? 'opacity-50' : ''} hover:bg-accent/50`}>
                    <td className="px-2 py-1 font-mono">{f.number ?? '—'}</td>
                    <td className="px-2 py-1 text-muted-foreground">{f.direction.slice(0, 3)}</td>
                    <td className="px-2 py-1">{f.other?.iata ?? f.other?.icao ?? '—'}</td>
                    <td className="px-2 py-1">{f.scheduledLocal ?? '—'}</td>
                    <td className="px-2 py-1">{f.bestLocal ?? (f.cancelled ? '✕' : '—')}</td>
                    <td className={`px-2 py-1 ${delayClass(f.delayMin)}`}>{fmtDelayMinutes(f.delayMin)}</td>
                    <td className="px-2 py-1 text-xs text-muted-foreground">{f.status ?? '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}
