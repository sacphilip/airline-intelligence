'use client';

import { useState } from 'react';
import { DelayFlight } from '@/lib/types';
import { DELAYED_MIN } from '@/lib/format';

// US-014: delays by scheduled hour (airport-local) + a "building up / clearing / steady" summary.
// Everything is computed from the board the Delays tab already loaded — no extra API calls.

const HOUR = 3_600_000;
const HEAVY_MIN = 60;
const TREND_SPAN = 2 * HOUR;
const TREND_MIN_FLIGHTS = 5;
const TREND_STEP_MIN = 10;

export interface HourBucket {
  /** Epoch ms of the start of this airport-local hour. */
  start: number;
  /** Airport-local label, e.g. "14:00". */
  label: string;
  flights: number;
  delayed: number;
  heavy: number;
  cancelled: number;
  /** Average delay of flights with a known delay (cancelled excluded); null when none. */
  avgDelay: number | null;
  /** The whole hour is after `now`: times are estimates. */
  future: boolean;
}

const knownDelay = (f: DelayFlight) => !f.cancelled && f.delayMin != null;

/**
 * Airport UTC offset in minutes, from flights that have both `scheduled` (epoch) and
 * `scheduledLocal` ("HH:mm"). Uses the most common value; falls back to the viewer's offset.
 */
export function airportOffsetMinutes(flights: DelayFlight[]): number {
  const counts = new Map<number, number>();
  for (const f of flights) {
    if (f.scheduled == null || !f.scheduledLocal) continue;
    const [h, m] = f.scheduledLocal.split(':').map(Number);
    if (!Number.isFinite(h) || !Number.isFinite(m)) continue;
    const utcMin = Math.floor(f.scheduled / 60_000) % 1440;
    let off = (h * 60 + m - utcMin) % 1440;
    if (off > 840) off -= 1440;          // UTC+14 is the largest offset
    if (off <= -720) off += 1440;        // UTC-12 the smallest
    counts.set(off, (counts.get(off) ?? 0) + 1);
  }
  let best: number | null = null;
  for (const [off, n] of counts) if (best == null || n > counts.get(best)!) best = off;
  return best ?? -new Date().getTimezoneOffset();
}

/** One bucket per airport-local hour across the board's period; hours without flights are kept (empty). */
export function buildHourBuckets(flights: DelayFlight[], range: { from: number; to: number }, now: number): HourBucket[] {
  const offMs = airportOffsetMinutes(flights) * 60_000;
  const hourStart = (t: number) => Math.floor((t + offMs) / HOUR) * HOUR - offMs;

  const times = flights.map(f => f.scheduled).filter((t): t is number => t != null);
  const from = hourStart(Math.min(range.from, ...times));
  const to = Math.max(range.to, ...times);

  const buckets: HourBucket[] = [];
  for (let start = from; start < to; start += HOUR) {
    const localHour = Math.floor((start + offMs) / HOUR) % 24;
    buckets.push({
      start,
      label: `${String((localHour + 24) % 24).padStart(2, '0')}:00`,
      flights: 0, delayed: 0, heavy: 0, cancelled: 0, avgDelay: null,
      future: start > now,
    });
  }

  const sums = new Map<number, { total: number; n: number }>();
  for (const f of flights) {
    if (f.scheduled == null) continue;
    const i = Math.floor((hourStart(f.scheduled) - from) / HOUR);
    const b = buckets[i];
    if (!b) continue;
    b.flights++;
    if (f.cancelled) { b.cancelled++; continue; }
    if (f.delayMin == null) continue;    // counted in flights, left out of the average
    if (f.delayMin >= DELAYED_MIN) b.delayed++;
    if (f.delayMin >= HEAVY_MIN) b.heavy++;
    const s = sums.get(i) ?? { total: 0, n: 0 };
    s.total += f.delayMin; s.n++;
    sums.set(i, s);
  }
  for (const [i, s] of sums) buckets[i].avgDelay = s.total / s.n;
  return buckets;
}

export type Trend =
  | { kind: 'building' | 'clearing'; before: number; after: number; text: string }
  | { kind: 'steady'; avg: number; text: string };

/** Last 2 h vs the 2 h before (by scheduled time); null if either span has < 5 flights with a known delay. */
export function delayTrend(flights: DelayFlight[], now: number): Trend | null {
  const avgIn = (from: number, to: number) => {
    const d = flights.filter(f => knownDelay(f) && f.scheduled != null && f.scheduled >= from && f.scheduled < to).map(f => f.delayMin!);
    return d.length >= TREND_MIN_FLIGHTS ? { avg: d.reduce((a, b) => a + b, 0) / d.length, n: d.length } : null;
  };
  const after = avgIn(now - TREND_SPAN, now);
  const before = avgIn(now - 2 * TREND_SPAN, now - TREND_SPAN);
  if (!after || !before) return null;

  const a = Math.round(before.avg), b = Math.round(after.avg);
  if (after.avg - before.avg >= TREND_STEP_MIN) return { kind: 'building', before: a, after: b, text: `Delays are building up (avg ${a} → ${b} min)` };
  if (before.avg - after.avg >= TREND_STEP_MIN) return { kind: 'clearing', before: a, after: b, text: `Delays are clearing (avg ${a} → ${b} min)` };
  const avg = Math.round((before.avg * before.n + after.avg * after.n) / (before.n + after.n));
  return { kind: 'steady', avg, text: `Delays are steady (avg ~${avg} min)` };
}

const severity = (avg: number) =>
  avg >= HEAVY_MIN ? { bar: 'bg-red-500', label: 'Heavily delayed' }
  : avg >= DELAYED_MIN ? { bar: 'bg-amber-500', label: 'Delayed' }
  : { bar: 'bg-green-500', label: 'On time' };

const TREND_STYLE: Record<Trend['kind'], string> = {
  building: 'text-red-600 dark:text-red-400',
  clearing: 'text-green-600 dark:text-green-400',
  steady: 'text-muted-foreground',
};

const describe = (b: HourBucket) =>
  `${b.label} · ${b.flights} flight${b.flights === 1 ? '' : 's'} · ${b.delayed} delayed · ${b.cancelled} cancelled · ` +
  (b.avgDelay == null ? 'no delay data' : `avg ${Math.round(b.avgDelay)} min`) +
  (b.future ? ' (estimated)' : '');

interface Props {
  flights: DelayFlight[];
  /** The board's period; defaults to 6 h either side of `now`. */
  range?: { from: number; to: number };
  now?: number;
}

export function DelayTrendChart({ flights, range, now = Date.now() }: Props) {
  const [active, setActive] = useState<number | null>(null);
  const period = range ?? { from: now - 6 * HOUR, to: now + 6 * HOUR };
  const buckets = buildHourBuckets(flights, period, now);
  const trend = delayTrend(flights, now);
  if (!buckets.length) return null;

  // Scale to the worst hour, but never below an hour so short delays don't look dramatic.
  const maxAvg = Math.max(HEAVY_MIN, ...buckets.map(b => b.avgDelay ?? 0));
  const nowIdx = buckets.findIndex(b => now >= b.start && now < b.start + HOUR);
  const nowPos = nowIdx < 0 ? null : ((nowIdx + (now - buckets[nowIdx].start) / HOUR) / buckets.length) * 100;
  const shown = active != null ? buckets[active] : null;

  return (
    <section aria-labelledby="delay-trend-title" className="rounded-xl border border-border bg-card shadow-sm p-4">
      <div className="flex flex-wrap items-center justify-between gap-2 mb-1">
        <h2 id="delay-trend-title" className="text-sm font-semibold">Delays by hour</h2>
        <div className="flex items-center gap-3 text-[11px] text-muted-foreground">
          {[['bg-green-500', 'On time'], ['bg-amber-500', 'Delayed'], ['bg-red-500', 'Heavily delayed']].map(([c, l]) => (
            <span key={l} className="flex items-center gap-1"><span className={`w-2.5 h-2.5 rounded-sm ${c}`} />{l}</span>
          ))}
          <span className="flex items-center gap-1"><span className="text-red-600 dark:text-red-400 font-bold">✕</span>Cancelled</span>
        </div>
      </div>

      <p data-testid="delay-trend-summary" className={`text-sm mb-3 min-h-5 ${trend ? TREND_STYLE[trend.kind] : ''}`}>
        {trend?.text}
      </p>

      <div className="relative">
        {nowPos != null && (
          <div className="absolute top-0 bottom-5 z-10 pointer-events-none" style={{ left: `${nowPos}%` }} aria-hidden="true">
            <div className="h-full border-l-2 border-dashed border-foreground/50" />
            <span className="absolute -top-0.5 left-1 whitespace-nowrap text-[10px] text-muted-foreground">now · estimated →</span>
          </div>
        )}

        <div className="flex items-end gap-1 h-40 pt-4" role="group" aria-label="Average delay by scheduled hour">
          {buckets.map((b, i) => {
            const height = b.avgDelay == null ? 0 : Math.max(4, (Math.max(0, b.avgDelay) / maxAvg) * 100);
            const sev = b.avgDelay == null ? null : severity(b.avgDelay);
            return (
              <button
                key={b.start}
                type="button"
                aria-label={describe(b)}
                title={describe(b)}
                onMouseEnter={() => setActive(i)}
                onMouseLeave={() => setActive(a => (a === i ? null : a))}
                onFocus={() => setActive(i)}
                onClick={() => setActive(a => (a === i ? null : i))}
                className={`relative flex-1 h-full flex flex-col justify-end items-center rounded-sm transition
                  focus:outline-none focus-visible:ring-2 focus-visible:ring-primary ${active === i ? 'bg-accent/60' : 'hover:bg-accent/40'}`}
              >
                {b.cancelled > 0 && (
                  <span className="text-[10px] font-bold leading-none mb-0.5 text-red-600 dark:text-red-400">✕{b.cancelled}</span>
                )}
                {b.flights === 0 ? (
                  <span className="w-full border-b border-dashed border-border" />
                ) : sev ? (
                  <span
                    className={`w-full rounded-t-sm ${sev.bar} ${b.future ? 'opacity-40' : ''}`}
                    style={{ height: `${height}%` }}
                  />
                ) : (
                  <span className="w-full h-1 rounded-sm bg-muted-foreground/30" />
                )}
              </button>
            );
          })}
        </div>

        <div className="flex gap-1 mt-1 h-4">
          {buckets.map((b, i) => (
            <span key={b.start}
              className={`flex-1 text-center text-[10px] tabular-nums ${b.future ? 'italic text-muted-foreground/60' : 'text-muted-foreground'}`}>
              {i % 2 === 0 ? b.label.slice(0, 2) : ''}
            </span>
          ))}
        </div>
      </div>

      <p className="mt-2 text-xs text-muted-foreground min-h-4" aria-live="polite">
        {shown ? describe(shown) : 'Hover or tap a bar for details. Hours are local to the airport; lighter bars are estimated.'}
      </p>
    </section>
  );
}
