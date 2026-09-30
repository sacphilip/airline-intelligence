// Ported from public/js/flight-status.js — pure functions, no DOM.
import { DELAYED_MIN } from './format';
import { SearchLeg } from './types';

const SEVERE_MIN = 60;
export const DEPARTED = new Set(['Departed', 'EnRoute', 'Approaching', 'Arrived', 'Diverted']);
const AIRBORNE_LABELS: Record<string, string> = { Departed: 'Departed', EnRoute: 'In the air', Approaching: 'Approaching' };
const GROUND_STAGES: Record<string, string> = { CheckIn: 'Check-in open', Boarding: 'Boarding', GateClosed: 'Gate closed' };

export function minutesBetween(later: number | null | undefined, earlier: number | null | undefined): number | null {
  if (later == null || earlier == null) return null;
  return Math.round((later - earlier) / 60_000);
}

export const delayOf = (end: { scheduled?: number | null; estimated?: number | null } | null | undefined) =>
  minutesBetween(end?.estimated, end?.scheduled);

export function fmtDelayMinutes(minutes: number | null): string {
  if (minutes == null) return '–';
  if (minutes === 0) return 'On time';
  const abs = Math.abs(minutes);
  const text = abs < 60 ? `${abs} min` : `${Math.floor(abs / 60)} h ${String(abs % 60).padStart(2, '0')} min`;
  return `${minutes > 0 ? '+' : '-'}${text}`;
}

const STAGE: Record<string, number> = {
  Expected: 0, Delayed: 0, CheckIn: 1, Boarding: 2, GateClosed: 3,
  Departed: 4, EnRoute: 4, Approaching: 4, Diverted: 4, Arrived: 5,
};
const CANCELLED = new Set(['Canceled', 'CanceledUncertain']);

interface TimelineStep {
  key: string;
  label: string;
  state: string;
  time: number | null;
  timeZone: string | null;
  timeKind: string | null;
  delay: number | null;
  detail: string | null;
}

export function flightTimeline(leg: SearchLeg): TimelineStep[] {
  const { origin: o, destination: d, status } = leg;
  const departed = DEPARTED.has(status ?? '');
  const join = (...parts: (string | null | undefined)[]) => parts.filter(Boolean).join(' · ') || null;

  const steps: TimelineStep[] = [
    { key: 'scheduled', label: 'Scheduled', state: '', time: o.scheduled, timeZone: (o as any).airport?.timeZone ?? null, timeKind: 'sched', delay: null, detail: null },
    { key: 'checkin', label: 'Check-in', state: '', time: null, timeZone: null, timeKind: null, delay: null, detail: join((o as any).terminal && `Terminal ${(o as any).terminal}`, (o as any).checkInDesk && `Desk ${(o as any).checkInDesk}`) },
    { key: 'boarding', label: 'Boarding', state: '', time: null, timeZone: null, timeKind: null, delay: null, detail: (o as any).gate ? `Gate ${(o as any).gate}` : null },
    { key: 'gate', label: 'Gate', state: '', time: null, timeZone: null, timeKind: null, delay: null, detail: (o as any).gate ? `Gate ${(o as any).gate}${STAGE[status ?? ''] >= 3 ? ' closed' : ''}` : STAGE[status ?? ''] >= 3 ? 'Closed' : null },
    {
      key: 'departure', label: 'Departure', state: '',
      time: o.estimated ?? o.scheduled, timeZone: (o as any).airport?.timeZone ?? null,
      timeKind: o.estimated == null ? 'sched' : departed ? 'actual' : 'est',
      delay: delayOf(o), detail: null,
    },
    {
      key: 'arrival', label: 'Arrival', state: '',
      time: d.estimated ?? d.scheduled, timeZone: (d as any).airport?.timeZone ?? null,
      timeKind: d.estimated == null ? 'sched' : status === 'Arrived' && !leg.statusInferred ? 'actual' : 'est',
      delay: delayOf(d),
      detail: join((leg as any).statusInferred && 'Landing time not reported', (d as any).terminal && `Terminal ${(d as any).terminal}`, (d as any).baggageBelt && `Belt ${(d as any).baggageBelt}`),
    },
  ];

  const stage = STAGE[status ?? ''];
  steps.forEach((s, i) => {
    if (CANCELLED.has(status ?? '')) s.state = i === 0 ? 'done' : 'cancelled';
    else if (stage == null) s.state = 'unknown';
    else if (status === 'Arrived') s.state = 'done';
    else if (stage === 4) s.state = i < 5 ? 'done' : status === 'Diverted' ? 'diverted' : 'current';
    else s.state = i < stage ? 'done' : i === stage ? 'current' : 'upcoming';
  });

  const current = steps.find(s => s.state === 'current');
  if (current) {
    if (status === 'EnRoute' || status === 'Departed') current.detail = join('In the air', current.detail);
    if (status === 'Approaching') current.detail = join('Approaching', current.detail);
  }
  if (status === 'Diverted') steps[5].detail = 'Diverted';
  if (CANCELLED.has(status ?? '')) steps[1].detail = status === 'Canceled' ? 'Flight cancelled' : 'Flight possibly cancelled';
  return steps;
}

export interface FlightStatusResult {
  icon: string;
  text: string;
  tone: 'good' | 'warn' | 'bad' | 'live' | 'neutral';
  detail: string | null;
  depDelay: number | null;
  arrDelay: number | null;
}

export function flightStatus(leg: SearchLeg): FlightStatusResult {
  const depDelay = delayOf(leg.origin);
  const arrDelay = delayOf(leg.destination);
  const s = leg.status;
  const result = (icon: string, text: string, tone: FlightStatusResult['tone'], detail: string | null = null): FlightStatusResult =>
    ({ icon, text, tone, detail, depDelay, arrDelay });

  if (!s) return result('⚪', leg.liveError ? 'Live status unavailable' : 'Not currently tracked', 'neutral');
  if (s === 'Canceled') return result('🔴', 'Cancelled', 'bad');
  if (s === 'CanceledUncertain') return result('🔴', 'Possibly cancelled', 'bad');
  if (s === 'Diverted') return result('🔴', 'Diverted', 'bad');
  if (s === 'Arrived' && leg.statusInferred) return result('🟢', 'Landed', 'good', 'Arrival time not reported');
  if (s === 'Arrived') return (arrDelay ?? 0) >= DELAYED_MIN ? result('🟠', 'Landed late', 'warn') : result('🟢', 'Landed', 'good');
  if (AIRBORNE_LABELS[s]) return result('✈️', AIRBORNE_LABELS[s], 'live', (arrDelay ?? 0) >= DELAYED_MIN ? 'Running late' : null);
  if (s === 'OnGround') return result('⚪', 'On the ground', 'neutral');

  const stage = GROUND_STAGES[s] ?? null;
  if ((depDelay ?? 0) >= SEVERE_MIN) return result('🔴', 'Delayed', 'bad', stage);
  if ((depDelay ?? 0) >= DELAYED_MIN || s === 'Delayed') return result('🟠', 'Delayed', 'warn', stage);
  if (stage) return result('🟢', stage, 'good');
  if (s === 'Expected') return result('🟢', depDelay == null ? 'Scheduled' : 'On time', 'good');
  return result('⚪', s === 'Unknown' ? 'Status unknown' : s, 'neutral');
}
