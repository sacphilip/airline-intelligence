'use client';

import { useState, useEffect, useRef } from 'react';
import { api } from '@/lib/api';
import { SearchResult, SearchLeg } from '@/lib/types';
import { flightStatus, flightTimeline, fmtDelayMinutes, DEPARTED } from '@/lib/flight-status';
import { airportCode, delayClass, fmtClock, fmtDay, todayLocal, DELAYED_MIN } from '@/lib/format';

const FLIGHT_RE = /^([A-Z]{3}|[A-Z0-9]{2})(\d{1,4})([A-Z]?)$/;
const AIRPORT_RE = /^[A-Z0-9]{3,4}$/;

interface Props {
  initialNumber: string | null;
  onConsumeNumber: () => void;
}

export function FlightSearchTab({ initialNumber, onConsumeNumber }: Props) {
  const [mode, setMode] = useState<'number' | 'route'>('number');
  const [input, setInput] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [date, setDate] = useState(todayLocal());
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<SearchResult | null>(null);
  const [error, setError] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (initialNumber) {
      setInput(initialNumber);
      onConsumeNumber();
      handleSearch(initialNumber);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialNumber]);

  async function handleSearch(numberOverride?: string) {
    const q = (numberOverride ?? input).trim().toUpperCase().replace(/\s+/g, ' ');
    if (!q) return;
    setLoading(true); setError(''); setResult(null);
    try {
      const data = await api.search(q, date !== todayLocal() ? date : undefined);
      setResult(data);
    } catch (err: any) {
      setError(err.data?.error ?? err.message ?? 'Search failed');
    } finally { setLoading(false); }
  }

  async function handleRoute() {
    const f = from.trim().toUpperCase(), t = to.trim().toUpperCase();
    if (!AIRPORT_RE.test(f) || !AIRPORT_RE.test(t)) { setError('Enter 3–4 letter airport codes'); return; }
    setLoading(true); setError(''); setResult(null);
    try {
      const data = await api.route(f, t, date);
      // Wrap route result in SearchResult shape for the table
      setResult({ query: `${f} → ${t}`, source: data.source ?? 'aerodatabox', scheduleAvailable: true, legs: data.flights ?? [] });
    } catch (err: any) {
      setError(err.data?.error ?? err.message ?? 'Route search failed');
    } finally { setLoading(false); }
  }

  return (
    <div className="max-w-2xl mx-auto p-4 space-y-4">
      {/* Mode tabs */}
      <div className="flex gap-2">
        {(['number', 'route'] as const).map(m => (
          <button key={m} onClick={() => setMode(m)}
            className={`px-3 py-1 text-sm rounded-full ${mode === m ? 'bg-primary text-primary-foreground' : 'bg-secondary text-secondary-foreground'}`}>
            {m === 'number' ? 'Flight number' : 'Route'}
          </button>
        ))}
      </div>

      {/* Search inputs */}
      {mode === 'number' ? (
        <form onSubmit={e => { e.preventDefault(); handleSearch(); }} className="flex gap-2">
          <input ref={inputRef} value={input} onChange={e => setInput(e.target.value)}
            className="flex-1 px-3 py-2 rounded border border-input bg-background text-sm"
            placeholder="e.g. 6E 5321 or BA 117" autoFocus />
          <input type="date" value={date} onChange={e => setDate(e.target.value)}
            className="px-2 py-2 rounded border border-input bg-background text-sm w-36" />
          <button type="submit" className="px-4 py-2 bg-primary text-primary-foreground rounded text-sm">Search</button>
        </form>
      ) : (
        <form onSubmit={e => { e.preventDefault(); handleRoute(); }} className="flex flex-wrap gap-2">
          <input value={from} onChange={e => setFrom(e.target.value)} placeholder="From (BLR)"
            className="w-24 px-3 py-2 rounded border border-input bg-background text-sm uppercase" maxLength={4} />
          <span className="self-center text-muted-foreground">→</span>
          <input value={to} onChange={e => setTo(e.target.value)} placeholder="To (DEL)"
            className="w-24 px-3 py-2 rounded border border-input bg-background text-sm uppercase" maxLength={4} />
          <input type="date" value={date} onChange={e => setDate(e.target.value)}
            className="px-2 py-2 rounded border border-input bg-background text-sm w-36" />
          <button type="submit" className="px-4 py-2 bg-primary text-primary-foreground rounded text-sm">Search</button>
        </form>
      )}

      {loading && <p className="text-sm text-muted-foreground">Searching…</p>}
      {error && <p className="text-sm text-destructive">{error}</p>}

      {result && mode === 'number' && result.legs.map((leg, i) => (
        <FlightCard key={i} leg={leg} />
      ))}

      {result && mode === 'route' && (
        <RouteTable legs={result.legs} />
      )}
    </div>
  );
}

function FlightCard({ leg }: { leg: SearchLeg }) {
  const status = flightStatus(leg);
  const timeline = flightTimeline(leg);
  const tz = (leg.origin as any).airport?.timeZone;

  return (
    <div className="border border-border rounded-lg p-4 space-y-3 bg-card">
      <div className="flex items-start justify-between">
        <div>
          <div className="font-semibold text-lg">{leg.number ?? '—'}</div>
          <div className="text-sm text-muted-foreground">
            {leg.airline?.name} · {leg.aircraft?.model ?? '—'}
          </div>
        </div>
        <span className={`text-sm font-medium px-2 py-1 rounded-full ${
          status.tone === 'good' ? 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200' :
          status.tone === 'warn' ? 'bg-amber-100 text-amber-800 dark:bg-amber-900 dark:text-amber-200' :
          status.tone === 'bad' ? 'bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200' :
          status.tone === 'live' ? 'bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200' :
          'bg-secondary text-secondary-foreground'}`}>
          {status.icon} {status.text}
          {status.detail && <span className="ml-1 opacity-75">· {status.detail}</span>}
        </span>
      </div>

      {/* Route bar */}
      <div className="flex items-center gap-3">
        <div className="text-center">
          <div className="text-2xl font-bold">{airportCode(leg.origin.airport)}</div>
          <div className="text-xs text-muted-foreground">{fmtClock(leg.origin.scheduled, tz)}</div>
          {leg.origin.estimated && leg.origin.estimated !== leg.origin.scheduled && (
            <div className={`text-xs ${delayClass(status.depDelay)}`}>{fmtClock(leg.origin.estimated, tz)} {fmtDelayMinutes(status.depDelay)}</div>
          )}
        </div>
        <div className="flex-1 border-t border-dashed border-muted-foreground/50" />
        <div className="text-center">
          <div className="text-2xl font-bold">{airportCode(leg.destination.airport)}</div>
          <div className="text-xs text-muted-foreground">{fmtClock(leg.destination.scheduled, (leg.destination as any).airport?.timeZone)}</div>
          {leg.destination.estimated && (
            <div className={`text-xs ${delayClass(status.arrDelay)}`}>{fmtClock(leg.destination.estimated, (leg.destination as any).airport?.timeZone)}</div>
          )}
        </div>
      </div>

      {/* Timeline */}
      <ol className="flex gap-0 text-xs overflow-x-auto">
        {timeline.map(step => (
          <li key={step.key} className={`flex-1 text-center py-1 px-0.5 ${
            step.state === 'done' ? 'text-muted-foreground' :
            step.state === 'current' ? 'text-primary font-semibold' :
            step.state === 'cancelled' ? 'text-destructive line-through' :
            'text-muted-foreground/50'}`}>
            <div>{step.label}</div>
            {step.time && <div>{fmtClock(step.time, step.timeZone)}</div>}
          </li>
        ))}
      </ol>
    </div>
  );
}

function RouteTable({ legs }: { legs: any[] }) {
  return (
    <div className="overflow-x-auto rounded-lg border border-border">
      <table className="w-full text-sm">
        <thead className="bg-muted text-muted-foreground">
          <tr>
            {['Flight', 'Dep', 'Arr', 'Delay', 'Status'].map(h => (
              <th key={h} className="px-3 py-2 text-left font-medium">{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {legs.map((f, i) => (
            <tr key={i} className="border-t border-border hover:bg-accent/50">
              <td className="px-3 py-2 font-mono">{f.number ?? '—'}</td>
              <td className="px-3 py-2">{f.origin?.scheduledLocal ?? fmtClock(f.origin?.scheduled)}</td>
              <td className="px-3 py-2">{f.destination?.scheduledLocal ?? fmtClock(f.destination?.scheduled)}</td>
              <td className={`px-3 py-2 ${delayClass(f.delayMin)}`}>{fmtDelayMinutes(f.delayMin)}</td>
              <td className="px-3 py-2">{f.status ?? '—'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
