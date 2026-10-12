'use client';

import { useState, useEffect, useRef } from 'react';
import { api } from '@/lib/api';

interface Props {
  initialIata?: string | null;
  onConsumeIata: () => void;
}

// ── Score ring ───────────────────────────────────────────────────────────────

function ScoreRing({ score }: { score: number }) {
  const r = 38, circ = 2 * Math.PI * r;
  const pct = Math.max(0, Math.min(100, score)) / 100;
  const dash = circ * pct;
  const color = score >= 80 ? '#22c55e' : score >= 60 ? '#eab308' : '#ef4444';
  return (
    <svg width="100" height="100" className="rotate-[-90deg]">
      <circle cx="50" cy="50" r={r} fill="none" stroke="hsl(var(--muted))" strokeWidth="8" />
      <circle cx="50" cy="50" r={r} fill="none" stroke={color} strokeWidth="8"
        strokeDasharray={`${dash} ${circ}`} strokeLinecap="round"
        style={{ transition: 'stroke-dasharray 0.8s ease' }} />
    </svg>
  );
}

// ── Score badge ───────────────────────────────────────────────────────────────

export function ScoreBadge({ score }: { score: number }) {
  const color = score >= 80
    ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300'
    : score >= 60
    ? 'bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300'
    : 'bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-300';
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-bold tabular-nums ${color}`}>
      {score}
    </span>
  );
}

// ── Metric card ──────────────────────────────────────────────────────────────

function Metric({ label, value, sub, color = '' }: { label: string; value: string; sub?: string; color?: string }) {
  return (
    <div className="rounded-xl border border-border bg-card px-4 py-3 shadow-sm text-center">
      <div className={`text-2xl font-bold tabular-nums ${color}`}>{value}</div>
      <div className="text-xs font-medium text-foreground mt-0.5">{label}</div>
      {sub && <div className="text-[10px] text-muted-foreground mt-0.5">{sub}</div>}
    </div>
  );
}

// ── Score breakdown bar ───────────────────────────────────────────────────────

function ScoreBar({ label, pts, max }: { label: string; pts: number; max: number }) {
  const pct = max > 0 ? (pts / max) * 100 : 0;
  const color = pct >= 75 ? 'bg-emerald-500' : pct >= 50 ? 'bg-amber-500' : 'bg-red-500';
  return (
    <div>
      <div className="flex justify-between text-xs mb-1">
        <span className="text-muted-foreground">{label}</span>
        <span className="font-medium tabular-nums">{Math.round(pts)}/{max}</span>
      </div>
      <div className="h-2 bg-muted rounded-full overflow-hidden">
        <div className={`h-2 rounded-full transition-all duration-700 ${color}`} style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

// ── Delay distribution ────────────────────────────────────────────────────────

function DelayDist({ dist, total }: { dist: Record<string, number>; total: number }) {
  const bars = [
    { key: 'early',    label: 'Early',      color: 'bg-sky-500' },
    { key: 'ontime',   label: 'On time',    color: 'bg-emerald-500' },
    { key: 'slight',   label: '+15–30 min', color: 'bg-yellow-400' },
    { key: 'moderate', label: '+30–60 min', color: 'bg-amber-500' },
    { key: 'severe',   label: '+60 min',    color: 'bg-red-500' },
  ];
  const max = Math.max(...bars.map(b => dist[b.key] ?? 0), 1);
  return (
    <div className="space-y-2.5">
      {bars.map(b => {
        const n = dist[b.key] ?? 0;
        const pct = total > 0 ? (n / total) * 100 : 0;
        const barPct = (n / max) * 100;
        return (
          <div key={b.key}>
            <div className="flex justify-between text-xs mb-1">
              <span className="text-muted-foreground">{b.label}</span>
              <span className="font-medium tabular-nums">{n} · {pct.toFixed(1)}%</span>
            </div>
            <div className="h-2 bg-muted rounded-full overflow-hidden">
              <div className={`h-2 rounded-full transition-all duration-700 ${b.color}`}
                style={{ width: `${barPct}%` }} />
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ── Section wrapper ───────────────────────────────────────────────────────────

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-xl border border-border bg-card shadow-sm overflow-hidden">
      <div className="px-4 py-3 border-b border-border bg-muted/30">
        <h2 className="text-sm font-semibold">{title}</h2>
      </div>
      <div className="p-4">{children}</div>
    </section>
  );
}

// ── Rankings leaderboard ──────────────────────────────────────────────────────

function RankingsLeaderboard({ rankings, onSelect }: { rankings: any[]; onSelect: (iata: string) => void }) {
  return (
    <Section title="Airline reliability rankings">
      <div className="overflow-x-auto -mx-4 px-4">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-xs text-muted-foreground border-b border-border">
              <th className="pb-2 pr-3 w-8">#</th>
              <th className="pb-2 pr-3">Airline</th>
              <th className="pb-2 pr-3 text-right">Score</th>
              <th className="pb-2 pr-3 text-right">On-time</th>
              <th className="pb-2 pr-3 text-right">Avg delay</th>
              <th className="pb-2 text-right">Cancel</th>
            </tr>
          </thead>
          <tbody>
            {rankings.map((r, i) => (
              <tr key={r.iata}
                onClick={() => onSelect(r.iata)}
                className="border-b border-border/50 last:border-0 cursor-pointer hover:bg-muted/40 transition-colors">
                <td className="py-2.5 pr-3 text-muted-foreground tabular-nums font-mono text-xs">{i + 1}</td>
                <td className="py-2.5 pr-3">
                  <div className="font-medium leading-tight">{r.name ?? r.iata}</div>
                  {r.name && <div className="text-xs text-muted-foreground font-mono">{r.iata}</div>}
                </td>
                <td className="py-2.5 pr-3 text-right">
                  <ScoreBadge score={r.score} />
                </td>
                <td className="py-2.5 pr-3 text-right tabular-nums text-xs">
                  {r.onTimePct != null ? `${(r.onTimePct * 100).toFixed(0)}%` : '—'}
                </td>
                <td className="py-2.5 pr-3 text-right tabular-nums text-xs">
                  {r.avgDelay != null ? `${r.avgDelay} min` : '—'}
                </td>
                <td className="py-2.5 text-right tabular-nums text-xs">
                  {r.cancellationRate != null ? `${(r.cancellationRate * 100).toFixed(1)}%` : '—'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="text-[11px] text-muted-foreground mt-3">
        {rankings.length} airlines · minimum 5 flights required · click a row to view profile
      </p>
    </Section>
  );
}

// ── Trend chart ───────────────────────────────────────────────────────────────

function TrendChart({ trend }: { trend: any }) {
  const points: Array<{ month: string; score: number; observed: number }> = trend.months ?? [];
  if (points.length === 0) {
    return (
      <div className="text-sm text-muted-foreground text-center py-4">
        Not enough monthly data to show a trend yet.
      </div>
    );
  }

  const sorted = [...points].sort((a, b) => a.month.localeCompare(b.month));
  const minDate = new Date(sorted[0].month + '-01').getTime();
  const maxDate = new Date(sorted[sorted.length - 1].month + '-01').getTime();
  const span = maxDate - minDate || 1;

  const W = 480, H = 175;
  const padL = 30, padR = 12, padT = 18, padB = 32;
  const cW = W - padL - padR;
  const cH = H - padT - padB;

  const px = (m: string) => padL + ((new Date(m + '-01').getTime() - minDate) / span) * cW;
  const py = (s: number) => padT + (1 - s / 100) * cH;

  const linePoints = sorted.map(p => `${px(p.month)},${py(p.score)}`).join(' ');

  const fmtMonth = (m: string) => {
    const d = new Date(m + '-01');
    return d.toLocaleString('default', { month: 'short' });
  };

  const gridScores = [25, 50, 75, 100];

  const abs = Math.abs(trend.pctChange ?? 0);
  const dir: string = trend.direction ?? 'stable';
  const dirIcon = dir === 'up' ? '📈' : dir === 'down' ? '📉' : '—';
  const dirWord = dir === 'up' ? 'improved' : dir === 'down' ? 'declined' : 'remained stable';
  const dirColor = dir === 'up' ? 'text-emerald-500' : dir === 'down' ? 'text-red-500' : 'text-muted-foreground';

  return (
    <div>
      <p className="text-sm font-medium mb-3">
        {dirIcon} Reliability{' '}
        <span className={dirColor}>
          {dirWord}{dir !== 'stable' && ` ${abs.toFixed(1)}%`}
        </span>
        {' '}over the last {sorted.length} month{sorted.length !== 1 ? 's' : ''}
      </p>
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full" style={{ height: '175px' }}>
        {/* Grid lines + y labels */}
        {gridScores.map(s => (
          <g key={s}>
            <line x1={padL} x2={W - padR} y1={py(s)} y2={py(s)}
              stroke="hsl(var(--border))" strokeWidth="1" strokeDasharray="3,3" />
            <text x={padL - 4} y={py(s) + 4} textAnchor="end" fontSize="9"
              fill="hsl(var(--muted-foreground))">{s}</text>
          </g>
        ))}
        {/* X axis */}
        <line x1={padL} x2={W - padR} y1={padT + cH} y2={padT + cH}
          stroke="hsl(var(--border))" strokeWidth="1" />
        {/* Connecting line */}
        {sorted.length > 1 && (
          <polyline points={linePoints} fill="none" stroke="hsl(var(--primary))"
            strokeWidth="2.5" strokeLinejoin="round" strokeLinecap="round" />
        )}
        {/* Data points + score labels */}
        {sorted.map((p, i) => {
          const cx = px(p.month);
          const cy = py(p.score);
          const showLabel = sorted.length <= 6 || i === 0 || i === sorted.length - 1 || i % Math.ceil(sorted.length / 5) === 0;
          return (
            <g key={p.month}>
              <circle cx={cx} cy={cy} r="4" fill="hsl(var(--primary))" stroke="hsl(var(--card))" strokeWidth="1.5" />
              <text x={cx} y={cy - 9} textAnchor="middle" fontSize="9"
                fill="hsl(var(--foreground))" fontWeight="bold">{p.score}</text>
              {showLabel && (
                <text x={cx} y={H - 4} textAnchor="middle" fontSize="9"
                  fill="hsl(var(--muted-foreground))">{fmtMonth(p.month)}</text>
              )}
            </g>
          );
        })}
      </svg>
    </div>
  );
}

// ── Main tab ─────────────────────────────────────────────────────────────────

export function AirlineTab({ initialIata, onConsumeIata }: Props) {
  const [input, setInput]             = useState('');
  const [profile, setProfile]         = useState<any>(null);
  const [loading, setLoading]         = useState(false);
  const [error, setError]             = useState('');
  const [rankings, setRankings]       = useState<any[] | null>(null);
  const [rankLoading, setRankLoading] = useState(false);
  const [trend, setTrend]             = useState<any>(null);
  const [trendLoading, setTrendLoading] = useState(false);
  const inputRef                      = useRef<HTMLInputElement>(null);

  // Load rankings once on mount
  useEffect(() => {
    setRankLoading(true);
    api.airlineRankings()
      .then(data => setRankings(data))
      .catch(() => setRankings([]))
      .finally(() => setRankLoading(false));
  }, []);

  const search = async (iata: string) => {
    const code = iata.trim().toUpperCase();
    if (!code) return;
    setLoading(true);
    setError('');
    setProfile(null);
    setTrend(null);
    try {
      const data = await api.airlineProfile(code);
      setProfile(data);
      // Load trend in background
      setTrendLoading(true);
      api.airlineTrend(code)
        .then(t => setTrend(t))
        .catch(() => {})
        .finally(() => setTrendLoading(false));
    } catch (err: any) {
      setError(err.data?.message ?? err.message ?? 'Lookup failed');
    } finally {
      setLoading(false);
    }
  };

  // Triggered from outside (e.g. clicking airline name in FlightCard)
  useEffect(() => {
    if (initialIata) {
      setInput(initialIata);
      onConsumeIata();
      search(initialIata);
    }
  }, [initialIata]);

  const p = profile;
  const fmt = (n: number | null, suffix = '') =>
    n == null ? '—' : `${n}${suffix}`;
  const fmtPct = (r: number | null) =>
    r == null ? '—' : `${(r * 100).toFixed(1)}%`;

  // Score breakdown
  const onTimeScore      = p ? Math.round((p.onTimePct  ?? 0) * 40) : 0;
  const cancelScore      = p ? Math.round(Math.max(0, 20 * (1 - (p.cancellationRate ?? 0) * 5))) : 0;
  const avgDelayScore    = p ? Math.round(Math.max(0, 25 * (1 - (p.avgDelay ?? 0) / 60))) : 0;
  const consistencyScore = p?.delayStddev != null ? Math.round(Math.max(0, 15 * (1 - p.delayStddev / 45))) : 0;

  return (
    <div className="max-w-2xl mx-auto p-5 space-y-5">

      {/* Search */}
      <form onSubmit={e => { e.preventDefault(); search(input); }}
        className="rounded-xl border border-border bg-card p-4 shadow-sm flex gap-2">
        <input ref={inputRef} value={input} onChange={e => setInput(e.target.value)}
          placeholder="IATA code, e.g. 6E, AI, EK"
          className="flex-1 min-w-0 px-3 py-2.5 rounded-lg border border-input bg-background text-sm focus:outline-none focus:ring-2 focus:ring-primary/40 focus:border-primary transition" />
        <button type="submit" disabled={loading}
          className="px-5 py-2.5 bg-primary text-primary-foreground rounded-lg text-sm font-medium hover:opacity-90 active:scale-95 transition disabled:opacity-60 shrink-0">
          Search
        </button>
      </form>

      {/* Loading */}
      {loading && (
        <div className="flex items-center gap-3 px-4 py-3 rounded-xl border border-border bg-card animate-fade-in">
          <svg className="animate-spin-slow w-4 h-4 text-primary shrink-0" fill="none" viewBox="0 0 24 24">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z"/>
          </svg>
          <span className="text-sm text-muted-foreground">Loading airline profile…</span>
        </div>
      )}

      {/* Error */}
      {error && (
        <div className="flex items-start gap-2 px-4 py-3 rounded-xl border border-destructive/30 bg-destructive/10 text-destructive text-sm animate-fade-in">
          <span>⚠</span> {error}
        </div>
      )}

      {/* Profile */}
      {p && !loading && (
        <div className="space-y-4 animate-fade-in">

          {/* Back to rankings */}
          {rankings && rankings.length > 0 && (
            <button onClick={() => { setProfile(null); setTrend(null); setInput(''); setError(''); }}
              className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors">
              ← All airlines
            </button>
          )}

          {/* Overview header */}
          <div className="rounded-xl border border-border bg-card shadow-sm p-5">
            <div className="flex items-start gap-6">

              {/* Score ring */}
              <div className="relative shrink-0">
                {p.score != null ? (
                  <>
                    <ScoreRing score={p.score} />
                    <div className="absolute inset-0 flex flex-col items-center justify-center rotate-0">
                      <span className="text-2xl font-extrabold leading-none">{p.score}</span>
                      <span className="text-[10px] text-muted-foreground">/100</span>
                    </div>
                  </>
                ) : (
                  <div className="w-[100px] h-[100px] flex items-center justify-center rounded-full border-4 border-muted text-muted-foreground text-xs text-center leading-tight px-2">
                    Not enough data
                  </div>
                )}
              </div>

              {/* Name + quick stats */}
              <div className="flex-1 min-w-0">
                <div className="text-xl font-bold truncate">{p.airline?.name ?? p.iata}</div>
                <div className="text-sm text-muted-foreground mt-0.5">
                  {[p.airline?.iata, p.airline?.icao].filter(Boolean).join(' · ')}
                </div>
                <div className="text-xs text-muted-foreground mt-2">
                  Based on {p.observed} observed flights
                  {p.total > 0 && p.cancelled > 0 && ` + ${p.cancelled} cancellations`}
                </div>
                {p.score != null && (
                  <div className={`mt-2 inline-flex items-center gap-1.5 text-xs font-semibold px-2.5 py-1 rounded-full
                    ${p.score >= 80 ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300'
                    : p.score >= 60 ? 'bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300'
                    : 'bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-300'}`}>
                    {p.score >= 80 ? '⭐ Excellent' : p.score >= 70 ? '✅ Good' : p.score >= 60 ? '⚠ Average' : '⛔ Poor'}
                  </div>
                )}
              </div>
            </div>

            {/* Key metrics */}
            <div className="grid grid-cols-3 gap-3 mt-5">
              <Metric label="On-time"
                value={fmtPct(p.onTimePct)}
                color={p.onTimePct != null && p.onTimePct >= 0.8 ? 'text-emerald-500' : p.onTimePct != null && p.onTimePct >= 0.6 ? 'text-amber-500' : 'text-red-500'} />
              <Metric label="Avg delay"
                value={fmt(p.avgDelay, ' min')}
                color={p.avgDelay != null && p.avgDelay < 15 ? 'text-emerald-500' : p.avgDelay != null && p.avgDelay < 30 ? 'text-amber-500' : 'text-red-500'} />
              <Metric label="Cancellation"
                value={fmtPct(p.cancellationRate)}
                color={p.cancellationRate != null && p.cancellationRate < 0.02 ? 'text-emerald-500' : p.cancellationRate != null && p.cancellationRate < 0.05 ? 'text-amber-500' : 'text-red-500'} />
            </div>
          </div>

          {/* Score breakdown */}
          {p.score != null && (
            <Section title="Reliability score breakdown">
              <div className="space-y-3">
                <ScoreBar label="On-time performance"    pts={onTimeScore}      max={40} />
                <ScoreBar label="Cancellation rate"      pts={cancelScore}      max={20} />
                <ScoreBar label="Average delay"          pts={avgDelayScore}    max={25} />
                <ScoreBar label="Delay consistency"      pts={consistencyScore} max={15} />
              </div>
              <p className="text-[11px] text-muted-foreground mt-3">
                Score = on-time (40) + cancellation (20) + avg-delay (25) + consistency (15). Min 5 flights required.
              </p>
            </Section>
          )}

          {/* Reliability trend (US-008) */}
          {(trend || trendLoading) && (
            <Section title="Reliability trend">
              {trendLoading ? (
                <div className="flex items-center gap-2 text-sm text-muted-foreground py-2">
                  <svg className="animate-spin-slow w-4 h-4 text-primary shrink-0" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z"/>
                  </svg>
                  Loading trend data…
                </div>
              ) : trend && (
                <TrendChart trend={trend} />
              )}
            </Section>
          )}

          {/* Delay analysis */}
          {p.observed > 0 && (
            <Section title="Delay analysis">
              <DelayDist dist={p.delayDist} total={p.observed} />
              {p.delayStddev != null && (
                <p className="text-xs text-muted-foreground mt-3">
                  Std deviation: <span className="font-medium text-foreground">{p.delayStddev} min</span>
                  {' '}— {p.delayStddev < 15 ? 'very consistent' : p.delayStddev < 30 ? 'moderately consistent' : 'inconsistent'}
                </p>
              )}
            </Section>
          )}

          {/* Top routes */}
          {p.topRoutes?.length > 0 && (
            <Section title="Routes">
              <div className="space-y-1.5">
                {p.topRoutes.map((r: any, i: number) => {
                  const maxCount = p.topRoutes[0].count;
                  return (
                    <div key={i} className="flex items-center gap-3 text-sm">
                      <span className="font-mono font-semibold w-20 shrink-0">{r.from} → {r.to}</span>
                      <div className="flex-1 h-1.5 bg-muted rounded-full overflow-hidden">
                        <div className="h-1.5 bg-primary/60 rounded-full transition-all duration-500"
                          style={{ width: `${(r.count / maxCount) * 100}%` }} />
                      </div>
                      <span className="text-xs text-muted-foreground tabular-nums w-8 text-right">{r.count}</span>
                    </div>
                  );
                })}
              </div>
            </Section>
          )}

          {/* Top airports */}
          {p.topAirports?.length > 0 && (
            <Section title="Airports">
              <div className="flex flex-wrap gap-2">
                {p.topAirports.map((a: any, i: number) => (
                  <span key={i}
                    className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg border border-border bg-muted/50 text-xs font-mono font-semibold">
                    {a.iata}
                    <span className="text-muted-foreground font-normal">{a.count}</span>
                  </span>
                ))}
              </div>
            </Section>
          )}

          {/* Fleet */}
          {p.regs?.length > 0 && (
            <Section title={`Fleet · ${p.regs.length} aircraft`}>
              <div className="flex flex-wrap gap-1.5">
                {p.regs.map((reg: string) => (
                  <span key={reg}
                    className="px-2 py-0.5 rounded border border-border bg-muted/40 text-xs font-mono text-muted-foreground">
                    {reg}
                  </span>
                ))}
              </div>
            </Section>
          )}

          {/* No data */}
          {p.observed === 0 && p.cancelled === 0 && (
            <div className="rounded-xl border border-border bg-card p-6 text-center text-sm text-muted-foreground">
              No historical data for <span className="font-semibold">{p.iata}</span> yet.
              History builds up as flights are looked up via the Find Flight tab.
            </div>
          )}

        </div>
      )}

      {/* Rankings leaderboard (US-007) — shown when no profile is loaded */}
      {!p && !loading && (
        <>
          {rankLoading && (
            <div className="flex items-center gap-3 px-4 py-3 rounded-xl border border-border bg-card">
              <svg className="animate-spin-slow w-4 h-4 text-primary shrink-0" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z"/>
              </svg>
              <span className="text-sm text-muted-foreground">Loading rankings…</span>
            </div>
          )}
          {rankings && rankings.length > 0 && (
            <RankingsLeaderboard
              rankings={rankings}
              onSelect={(iata) => { setInput(iata); search(iata); }}
            />
          )}
          {rankings && rankings.length === 0 && !rankLoading && (
            <div className="rounded-xl border border-border bg-card p-6 text-center text-sm text-muted-foreground">
              No airline rankings available yet.
              History builds up as flights are looked up via the Find Flight tab.
            </div>
          )}
        </>
      )}

    </div>
  );
}
