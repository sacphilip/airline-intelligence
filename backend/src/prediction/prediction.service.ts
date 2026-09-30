import { Injectable } from '@nestjs/common';
import { WeatherService } from '../sources/weather/weather.service';
import { MovementRepository } from '../movement/movement.repository';
import { FlightLeg, LegPrediction, ChainResult, Turnaround } from '../types/flight.types';

const DELAYED_MIN = 15;
const HIGH_MIN = 45;
const MAX_LEGS_AHEAD = 4;
const MIN_HISTORY = 5;
const MIN_AIRPORT_HISTORY = 20;
const LEVELS = ['low', 'moderate', 'high'] as const;
const AIRBORNE = new Set(['Departed', 'EnRoute', 'Approaching']);

const WIDEBODY_TYPE = /^(A30|A31|A33|A34|A35|A38|B74|B76|B77|B78|IL96|MD11|DC10)/;
const REGIONAL_TYPE = /^(AT4|AT7|DH8|E1[0-9]|E17|E19|E75|CRJ|SF34|JS4|D328|B19|C208|L410|SW4)/;
const WIDEBODY_MODEL = /(A30[06]|A310|A33|A34|A35|A380|747|767|777|787)/;
const REGIONAL_MODEL = /(ATR|Dash 8|DHC-8|Q400|ERJ|Embraer 1[79]|E1[79]|E-Jet|CRJ|Saab)/i;

export function minTurnaround(typeCode: string | null, model: string | null): Turnaround {
  if ((typeCode && WIDEBODY_TYPE.test(typeCode)) || (model && WIDEBODY_MODEL.test(model))) return { minutes: 75, kind: 'wide-body' };
  if ((typeCode && REGIONAL_TYPE.test(typeCode)) || (model && REGIONAL_MODEL.test(model))) return { minutes: 25, kind: 'regional' };
  return { minutes: 35, kind: 'narrow-body' };
}

const minutesBetween = (later: number | null, earlier: number | null) =>
  later == null || earlier == null ? null : Math.round((later - earlier) / 60000);
const levelOf = (delay: number) => (delay >= HIGH_MIN ? 2 : delay >= DELAYED_MIN ? 1 : 0);
const code = (ap: any) => ap?.iata || ap?.icao || '?';
const signed = (m: number) => `${m > 0 ? '+' : m < 0 ? '-' : ''}${Math.abs(m)} min`;
const depTime = (l: any) => l.dep.best ?? l.dep.sched;
const arrTime = (l: any) => l.arr.best ?? l.arr.sched;

export function locateInChain(legs: FlightLeg[], opts: { callsign?: string | null; onGround: boolean; now?: number }) {
  const { callsign, onGround, now = Date.now() } = opts;
  const cs = callsign?.replace(/\s+/g, '').toUpperCase();
  if (!onGround) {
    let i = legs.findIndex(l => cs && (l as any).callSign === cs && l.status !== 'Arrived' && !l.cancelled);
    if (i < 0) i = legs.findIndex(l => AIRBORNE.has(l.status ?? ''));
    if (i < 0) i = legs.findIndex(l => !l.cancelled && depTime(l) != null && arrTime(l) != null && depTime(l) <= now && now <= arrTime(l) + 15 * 60_000);
    if (i >= 0) return { currentIndex: i, lastArrivedIndex: i - 1 };
  }
  let last = -1;
  legs.forEach((l, i) => { if (!l.cancelled && (l.arr.actual || (arrTime(l) != null && arrTime(l) <= now))) last = i; });
  return { currentIndex: -1, lastArrivedIndex: last };
}

function ordinal(n: number) {
  const s = ['th', 'st', 'nd', 'rd'];
  const v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
}

@Injectable()
export class PredictionService {
  constructor(
    private readonly weather: WeatherService,
    private readonly movements: MovementRepository,
  ) {}

  async predictChain(
    legs: FlightLeg[],
    position: { currentIndex: number; lastArrivedIndex: number; liveArrDelay?: number | null; typeCode?: string | null; model?: string | null },
  ): Promise<ChainResult> {
    const { currentIndex, lastArrivedIndex, liveArrDelay = null, typeCode = null } = position;
    const turn = minTurnaround(typeCode, position.model ?? (legs.find(l => l.model) as any)?.model ?? null);

    const described = legs.map((l, i) => {
      let arrDelay = l.cancelled ? null : minutesBetween((l as any).arr.best, (l as any).arr.sched);
      let arrSource: string | null = arrDelay == null ? null : l.arr.actual ? 'actual' : 'airline';
      if (i === currentIndex && arrDelay == null && liveArrDelay != null) { arrDelay = liveArrDelay; arrSource = 'position'; }
      const state = l.cancelled ? 'cancelled'
        : i === currentIndex ? 'current'
        : i <= lastArrivedIndex || l.arr.actual ? 'done'
        : 'upcoming';
      return { ...l, index: i, state, depDelay: l.cancelled ? null : minutesBetween((l as any).dep.best, (l as any).dep.sched), arrDelay, arrSource };
    });

    const anchor = currentIndex >= 0 ? currentIndex : lastArrivedIndex;
    const upcoming = described.filter(l => l.state === 'upcoming' && l.index > anchor).slice(0, MAX_LEGS_AHEAD);
    const inbound = anchor >= 0 ? described[anchor] : null;
    const sectorsFlown = described.filter(l => l.state === 'done' || l.state === 'current').length;

    let prev = { leg: inbound, arrDelay: Math.max(0, inbound?.arrDelay ?? 0), arrSched: (inbound as any)?.arr?.sched ?? null };
    const predictions: LegPrediction[] = [];

    for (const [k, leg] of upcoming.entries()) {
      const p = await this.predictLeg(leg, k, prev, { turn, sectorsFlown, inboundDelay: k === 0 ? inbound?.arrDelay ?? null : prev.arrDelay });
      predictions.push(p);
      prev = { leg, arrDelay: Math.max(p.depDelay, Math.max(0, minutesBetween((leg as any).arr.best, (leg as any).arr.sched) ?? 0)), arrSched: (leg as any).arr.sched };
    }

    const flightIndex = described.findIndex(l => l.state === 'current') >= 0
      ? described.findIndex(l => l.state === 'current')
      : lastArrivedIndex;

    return { legs: described as any, predictions, turnaround: turn, flightIndex };
  }

  private async predictLeg(leg: any, k: number, prev: any, ctx: { turn: Turnaround; sectorsFlown: number; inboundDelay: number | null }): Promise<LegPrediction> {
    const { turn, sectorsFlown, inboundDelay } = ctx;
    const reasons: any[] = [];

    const scheduledTurn = minutesBetween(leg.dep.sched, prev.arrSched);
    const slack = scheduledTurn == null ? 0 : Math.max(0, scheduledTurn - turn.minutes);
    const knockOn = Math.max(0, prev.arrDelay - slack);
    if (prev.leg) {
      const label = k === 0
        ? `Inbound ${prev.leg.number ?? 'flight'} (${code(prev.leg.dep?.airport)}→${code(prev.leg.arr?.airport)})`
        : `Previous flight ${prev.leg.number ?? ''}`.trim();
      reasons.push({
        kind: 'inbound', severity: levelOf(inboundDelay ?? 0),
        text: inboundDelay == null ? `${label}: arrival time unknown`
          : inboundDelay >= 5 ? `${label} ${k === 0 ? 'is running' : 'is expected to arrive'} ${signed(inboundDelay)} late`
          : `${label} ${k === 0 ? 'is' : 'is expected'} on time`,
      });
      if (scheduledTurn != null) {
        reasons.push({
          kind: 'turnaround', severity: prev.arrDelay > slack ? 1 : 0,
          text: `Scheduled turnaround ${scheduledTurn} min; a ${turn.kind} aircraft needs about ${turn.minutes} min` +
            (slack > 0 ? `, so up to ${slack} min of delay can be recovered on the ground` : ', so there is no spare time to recover delay'),
        });
      }
    }

    const airlineDelay = minutesBetween(leg.dep.best, leg.dep.sched);
    const depDelay = Math.max(knockOn, airlineDelay ?? 0);
    if (airlineDelay != null && airlineDelay >= 5) {
      reasons.push({ kind: 'airline', severity: levelOf(airlineDelay), text: `Airline currently estimates departure ${signed(airlineDelay)}` });
    }
    let level = levelOf(depDelay);
    let widen = 10 + 5 * k;

    const forecasts = await Promise.all([
      this.weather.weatherAt(leg.dep.airport, leg.dep.sched),
      this.weather.weatherAt(leg.arr.airport, leg.arr.sched),
    ]);
    for (const w of forecasts.filter(Boolean)) {
      reasons.push({ kind: 'weather', severity: w!.severity, text: w!.text });
      widen += w!.severity === 2 ? 20 : 10;
      if (w!.severity === 2) level = Math.min(2, level + 1);
    }

    const record = await this.movements.flightHistory(leg.number, 'Departure');
    if (record && record.observed >= MIN_HISTORY) {
      reasons.push({
        kind: 'history', severity: record.delayedPct! >= 0.5 ? 1 : 0,
        text: `${leg.number} has left ${DELAYED_MIN}+ min late on ${Math.round(record.delayedPct! * 100)}% of ${record.observed} recorded flights (avg ${record.avgDelay} min)`,
      });
      widen += Math.round((record.avgDelay ?? 0) / 2);
      if (record.delayedPct! >= 0.5) level = Math.max(level, 1);
    }
    const airportRecord = leg.dep.sched == null ? null : await this.movements.airportHourHistory(leg.dep.airport, new Date(leg.dep.sched).getUTCHours());
    if (airportRecord && airportRecord.observed >= MIN_AIRPORT_HISTORY && airportRecord.delayedPct >= 0.3) {
      reasons.push({
        kind: 'airport', severity: 1,
        text: `Departures from ${code(leg.dep.airport)} around this time leave ${DELAYED_MIN}+ min late ${Math.round(airportRecord.delayedPct * 100)}% of the time (${airportRecord.observed} recorded)`,
      });
      widen += 5;
    }

    const nth = sectorsFlown + k + 1;
    if (nth >= 4) reasons.push({ kind: 'rotation', severity: 0, text: `This will be the aircraft's ${ordinal(nth)} flight today, so delays have had more chances to build up` });

    const window: [number, number] = [Math.max(0, depDelay - 5), depDelay + widen];
    const arrAirline = Math.max(0, minutesBetween(leg.arr.best, leg.arr.sched) ?? 0);
    const shift = (t: number | null, m: number) => t == null ? null : t + m * 60_000;
    return {
      index: leg.index,
      level: LEVELS[level],
      depDelay,
      window,
      expectedDep: [shift(leg.dep.sched, window[0]), shift(leg.dep.sched, window[1])],
      expectedArr: [shift(leg.arr.sched, Math.max(window[0], arrAirline)), shift(leg.arr.sched, Math.max(window[1], arrAirline))],
      reasons,
    };
  }
}
