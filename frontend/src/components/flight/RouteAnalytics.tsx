'use client';

// US-009 — Route analytics: how reliable a route is overall, and airline by airline.
// Built from recorded flight history, so it needs no date and works without an AeroDataBox key.

import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { RouteAirline, RouteAnalytics as RouteAnalyticsData } from '@/lib/types';
import { fmt } from '@/lib/format';
import { ScoreBadge } from '@/components/airline/AirlineTab';

type SortKey = 'name' | 'flights' | 'onTimePct' | 'avgDelay' | 'cancellationRate' | 'score';
type SortDir = 'asc' | 'desc';

// The first click on a column sorts best-first: more is better for these, less for the rest.
const BEST_FIRST: Record<SortKey, SortDir> = {
  name: 'asc', flights: 'desc', onTimePct: 'desc', avgDelay: 'asc', cancellationRate: 'asc', score: 'desc',
};

const COLUMNS: { key: SortKey; label: string; align: 'left' | 'right' }[] = [
  { key: 'name',             label: 'Airline',      align: 'left' },
  { key: 'flights',          label: 'Flights',      align: 'right' },
  { key: 'onTimePct',        label: 'OTP',          align: 'right' },
  { key: 'avgDelay',         label: 'Avg delay',    align: 'right' },
  { key: 'cancellationRate', label: 'Cancellation', align: 'right' },
  { key: 'score',            label: 'Reliability',  align: 'right' },
];

const pct = (v: number | null, decimals = 0) => (v == null ? '—' : `${(v * 100).toFixed(decimals)}%`);
const mins = (v: number | null) => (v == null ? '—' : `${v} min`);
const fmtSince = (ms: number) =>
  new Date(ms).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });

function sortValue(a: RouteAirline, key: SortKey): string | number {
  if (key === 'name') return (a.name ?? a.iata).toLowerCase();
  return a[key] ?? (BEST_FIRST[key] === 'asc' ? Infinity : -Infinity); // unknowns sort last
}

function Tile({ label, value, testId }: { label: string; value: string; testId: string }) {
  return (
    <div className="rounded-xl border border-border bg-card px-3 py-3 text-center shadow-sm" data-testid={testId}>
      <div className="text-xl font-bold tabular-nums">{value}</div>
      <div className="text-[11px] text-muted-foreground mt-0.5">{label}</div>
    </div>
  );
}

export function RouteAnalytics({ from, to }: { from: string; to: string }) {
  const [data, setData]       = useState<RouteAnalyticsData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError]     = useState('');
  const [sort, setSort]       = useState<{ key: SortKey; dir: SortDir }>({ key: 'score', dir: 'desc' });

  useEffect(() => {
    let cancelled = false; // ignore a slow response for a route the user has already moved on from
    setLoading(true); setError(''); setData(null);
    api.routeAnalytics(from, to)
      .then(d => { if (!cancelled) setData(d); })
      .catch((err: any) => { if (!cancelled) setError(err.data?.message ?? err.message ?? 'Could not load route analytics'); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [from, to]);

  const toggleSort = (key: SortKey) => setSort(prev =>
    prev.key === key ? { key, dir: prev.dir === 'asc' ? 'desc' : 'asc' } : { key, dir: BEST_FIRST[key] });

  const sorted = [...(data?.airlines ?? [])].sort((a, b) => {
    const av = sortValue(a, sort.key), bv = sortValue(b, sort.key);
    const cmp = av < bv ? -1 : av > bv ? 1 : 0;
    if (cmp !== 0) return sort.dir === 'asc' ? cmp : -cmp;
    // Ties: higher score, then more flights, whichever way the column is sorted (as the backend ranks).
    return (b.score - a.score) || (b.flights - a.flights);
  });

  return (
    <section className="rounded-xl border border-border bg-card shadow-sm overflow-hidden animate-fade-in" data-testid="route-analytics">
      <div className="px-4 py-3 border-b border-border bg-muted/30 flex items-baseline justify-between gap-3 flex-wrap">
        <h2 className="text-sm font-semibold">
          Route analytics · <span data-testid="route-analytics-route">{from} → {to}</span>
        </h2>
        {data?.since != null && (
          <span className="text-[11px] text-muted-foreground" data-testid="route-analytics-since">
            Based on flights since {fmtSince(data.since)}
          </span>
        )}
      </div>

      <div className="p-4 space-y-4">
        {loading && (
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
            {Array.from({ length: 4 }).map((_, i) => <div key={i} className="skeleton h-16 rounded-xl" />)}
          </div>
        )}

        {error && (
          <p className="text-sm text-destructive" data-testid="route-analytics-error">⚠ {error}</p>
        )}

        {data && data.summary.flights === 0 && (
          <p className="py-4 text-center text-sm text-muted-foreground" data-testid="route-analytics-empty">
            No data for this route yet. Analytics build up as flights on it are searched or collected.
          </p>
        )}

        {data && data.summary.flights > 0 && (
          <>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
              <Tile label="Flights analyzed"  value={fmt(data.summary.flights)}               testId="route-flights" />
              <Tile label="Average delay"     value={mins(data.summary.avgDelay)}             testId="route-avg-delay" />
              <Tile label="On-time rate"      value={pct(data.summary.onTimePct)}             testId="route-on-time" />
              <Tile label="Cancellation rate" value={pct(data.summary.cancellationRate, 1)}   testId="route-cancellation" />
            </div>

            {sorted.length > 0 && (
              <div className="overflow-x-auto -mx-4 px-4">
                <table className="w-full text-sm" data-testid="route-airlines-table">
                  <thead>
                    <tr className="text-xs text-muted-foreground border-b border-border">
                      {COLUMNS.map(col => (
                        <th key={col.key} onClick={() => toggleSort(col.key)}
                          aria-sort={sort.key === col.key ? (sort.dir === 'asc' ? 'ascending' : 'descending') : 'none'}
                          className={`pb-2 pr-3 last:pr-0 font-semibold cursor-pointer select-none hover:text-foreground transition-colors
                            ${col.align === 'right' ? 'text-right' : 'text-left'}`}>
                          {col.label}
                          <span className="ml-1 text-[10px] opacity-60">
                            {sort.key === col.key ? (sort.dir === 'asc' ? '▲' : '▼') : '⇅'}
                          </span>
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {sorted.map(a => (
                      <tr key={a.iata} data-testid={`route-airline-${a.iata}`}
                        onClick={() => { window.location.hash = `#airline/${encodeURIComponent(a.iata)}`; }}
                        title={`Open ${a.name ?? a.iata}'s profile`}
                        className="border-b border-border/50 last:border-0 cursor-pointer hover:bg-muted/40 transition-colors">
                        <td className="py-2.5 pr-3">
                          <div className="font-medium leading-tight">{a.name ?? a.iata}</div>
                          <div className="flex items-center gap-1.5 mt-0.5">
                            {a.name && <span className="text-xs text-muted-foreground font-mono">{a.iata}</span>}
                            {/* On phones the Reliability column scrolls out of view; keep the score in sight. */}
                            <span className="sm:hidden"><ScoreBadge score={a.score} /></span>
                          </div>
                        </td>
                        <td className="py-2.5 pr-3 text-right tabular-nums text-xs">{fmt(a.flights)}</td>
                        <td className="py-2.5 pr-3 text-right tabular-nums text-xs">{pct(a.onTimePct)}</td>
                        <td className="py-2.5 pr-3 text-right tabular-nums text-xs">{mins(a.avgDelay)}</td>
                        <td className="py-2.5 pr-3 text-right tabular-nums text-xs">{pct(a.cancellationRate, 1)}</td>
                        <td className="py-2.5 text-right"><ScoreBadge score={a.score} /></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            {data.insufficient.length > 0 && (
              <div className="text-xs text-muted-foreground" data-testid="route-insufficient">
                <span className="font-semibold text-foreground">Not enough data</span>
                {' '}(fewer than {data.minFlights} completed flights, no score):{' '}
                {data.insufficient.map((a, i) => (
                  <span key={a.iata}>
                    {i > 0 && ' · '}{a.name ?? a.iata} ({a.iata}) {fmt(a.flights)} flight{a.flights === 1 ? '' : 's'}
                  </span>
                ))}
              </div>
            )}

            <p className="text-[11px] text-muted-foreground">
              On time = departed less than 15 min late. Early flights count as 0 delay. Codeshares are counted once,
              under the operating airline. Reliability uses the airline score formula on this route only. Click an airline for its profile.
            </p>
          </>
        )}
      </div>
    </section>
  );
}
