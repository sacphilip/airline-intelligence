import { Injectable, HttpException, HttpStatus } from '@nestjs/common';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import { Inject } from '@nestjs/common';
import { Cache } from 'cache-manager';
import { AeroDataBoxService, AIRBORNE_STATUSES, DONE_STATUSES, CANCELLED_STATUSES } from '../sources/aerodatabox/aerodatabox.service';
import { AdsbService } from '../sources/adsb/adsb.service';
import { AirlinesService } from '../sources/airlines/airlines.service';
import { MovementRepository, legToMovements } from '../movement/movement.repository';

const SEARCH_TTL = 15 * 60_000;
const DEPARTURES_TTL = 30 * 60_000;

export function parseFlightNumber(input: string | null | undefined) {
  const s = String(input ?? '').toUpperCase().replace(/[\s-]/g, '');
  const m = s.match(/^([A-Z]{3}|[A-Z0-9]{2})(\d{1,4})([A-Z]?)$/);
  if (!m || /^\d\d$/.test(m[1])) return null;
  const [, airline, digits, suffix] = m;
  const number = `${Number(digits)}${suffix}`;
  return { airline, isIcao: airline.length === 3, number, display: `${airline} ${number}` };
}

@Injectable()
export class RouteService {
  constructor(
    @Inject(CACHE_MANAGER) private readonly cacheManager: Cache,
    private readonly adb: AeroDataBoxService,
    private readonly adsb: AdsbService,
    private readonly airlines: AirlinesService,
    private readonly movements: MovementRepository,
  ) {}

  private movement(m: any) {
    return {
      airport: this.adb.toAirport(m?.airport),
      scheduled: this.adb.adbTime(m, 'scheduledTime'),
      estimated: this.adb.bestTime(m),
      terminal: m?.terminal ?? null,
      checkInDesk: m?.checkInDesk ?? null,
      gate: m?.gate ?? null,
      baggageBelt: m?.baggageBelt ?? null,
    };
  }

  private async searchAeroDataBox(flight: any, date: string | null) {
    const raw = await this.adb.flights('number', `${flight.airline}${flight.number}`, date);
    await this.movements.record(raw.map((f: any) => this.adb.toLeg(f)).flatMap((l: any) => legToMovements(l, 'search')));
    return raw
      .map((f: any) => ({
        number: f.number ?? flight.display,
        callsign: f.callSign?.replace(/\s+/g, '') || null,
        airline: this.adb.toAirline(f.airline),
        status: f.status ?? null,
        origin: this.movement(f.departure),
        destination: this.movement(f.arrival),
        aircraft: f.aircraft ? { registration: f.aircraft.reg ?? null, model: f.aircraft.model ?? null, hex: f.aircraft.modeS?.toLowerCase() ?? null } : null,
      }))
      .sort((a: any, b: any) => (a.origin.scheduled ?? 0) - (b.origin.scheduled ?? 0));
  }

  private async searchAdsbRoute(flight: any) {
    const icaoCodes = flight.isIcao
      ? [flight.airline]
      : (await this.airlines.icaoCodesForIata(flight.airline)).slice(0, 5);
    const routes = await Promise.all(icaoCodes.map((icao: string) => this.adsb.lookupRoute(`${icao}${flight.number}`).catch(() => null)));
    const i = routes.findIndex(Boolean);
    if (i < 0) return { legs: [], callsign: icaoCodes[0] ? `${icaoCodes[0]}${flight.number}` : null };
    const icao = icaoCodes[i];
    const airline = await this.airlines.lookupAirline(icao);
    const blank = (airport: any) => ({ airport, scheduled: null, estimated: null, terminal: null, gate: null });
    return {
      callsign: `${icao}${flight.number}`,
      legs: [{ number: airline?.iata ? `${airline.iata} ${flight.number}` : flight.display, callsign: `${icao}${flight.number}`, airline, status: null, origin: blank(routes[i].origin), destination: blank(routes[i].destination), aircraft: null }],
    };
  }

  async searchFlight(flight: any, date: string | null = null) {
    const cacheKey = `search:${flight.display}|${date ?? ''}`;
    let cached = await this.cacheManager.get<any>(cacheKey);
    if (!cached) {
      if (this.adb.isConfigured()) {
        try {
          const legs = await this.searchAeroDataBox(flight, date);
          if (legs.length) { cached = { source: 'aerodatabox', legs, callsign: null }; }
        } catch (err: any) { console.warn(err.message); }
      }
      if (!cached) {
        const { legs, callsign } = await this.searchAdsbRoute(flight);
        cached = { source: legs.length ? 'adsb.lol' : null, legs, callsign };
      }
      await this.cacheManager.set(cacheKey, cached, SEARCH_TTL);
    }

    const { source, callsign } = cached;
    const now = Date.now();
    const legs = cached.legs.map((leg: any) => {
      const { status, inferred } = this.adb.settleStatus(leg.status, {
        depSched: leg.origin.scheduled, depBest: leg.origin.estimated,
        arrSched: leg.destination.scheduled, arrBest: leg.destination.estimated,
      }, now);
      return { ...leg, status, statusInferred: inferred, live: null, liveError: null };
    });

    const aroundNow = (l: any) =>
      l.origin.scheduled != null &&
      l.origin.scheduled - 60 * 60_000 <= now &&
      now <= (l.destination.estimated ?? l.destination.scheduled ?? l.origin.scheduled + 12 * 3_600_000) + 60 * 60_000;

    const current = source === 'aerodatabox'
      ? legs.find((l: any) => aroundNow(l) && AIRBORNE_STATUSES.has(l.status)) ??
        legs.find((l: any) => aroundNow(l) && !['Arrived', 'Canceled', 'CanceledUncertain'].includes(l.status))
      : legs[0];

    if (current) {
      const wanted = current.callsign ?? callsign;
      const { aircraft, error } = await this.adsb.findLive({ hex: current.aircraft?.hex, callsign: wanted });
      if (aircraft?.callsign && wanted && aircraft.callsign !== wanted) { current.live = null; }
      else { current.live = aircraft ?? null; }
      current.liveError = error ?? null;
      if (aircraft && !current.status) current.status = aircraft.onGround ? 'OnGround' : 'EnRoute';
      else if (aircraft && !aircraft.onGround && !AIRBORNE_STATUSES.has(current.status)) current.status = 'EnRoute';
    }

    return { query: flight.display, source, scheduleAvailable: this.adb.isConfigured(), legs };
  }

  // ---------- route search ----------
  private routeEnd(m: any, airport: any) {
    return {
      airport,
      scheduled: this.adb.adbTime(m, 'scheduledTime'),
      estimated: this.adb.bestTime(m),
      scheduledLocal: this.adb.localHHmm(m, 'scheduledTime'),
      estimatedLocal: this.adb.bestLocalHHmm(m),
      date: this.adb.localDate(m),
      terminal: m?.terminal ?? null,
      gate: m?.gate ?? null,
    };
  }

  private toRouteFlight(f: any, originCode: string, now = Date.now()) {
    const { status, inferred } = this.adb.settleFlightStatus(f, now);
    const cancelled = CANCELLED_STATUSES.has(status ?? '');
    const codeAirport = (code: string) => ({ [code.length === 3 ? 'iata' : 'icao']: code });
    const origin = this.routeEnd(f.departure ?? {}, codeAirport(originCode));
    const destination = this.routeEnd(f.arrival ?? {}, this.adb.toAirport(f.arrival?.airport));
    const delay = (end: any) =>
      end.scheduled != null && end.estimated != null ? Math.round((end.estimated - end.scheduled) / 60_000) : null;
    const departed = DONE_STATUSES.has(status ?? '');
    const [delayMin, delayOf] = cancelled ? [null, null]
      : departed && delay(destination) != null ? [delay(destination), 'arr']
      : delay(origin) != null ? [delay(origin), 'dep']
      : delay(destination) != null ? [delay(destination), 'arr']
      : [null, null];
    return {
      number: f.number ?? null,
      callsign: f.callSign?.replace(/\s+/g, '') || null,
      airline: this.adb.toAirline(f.airline),
      status, statusInferred: inferred, cancelled,
      aircraft: f.aircraft?.model ?? null,
      origin, destination,
      durationMin: origin.scheduled != null && destination.scheduled != null ? Math.round((destination.scheduled - origin.scheduled) / 60_000) : null,
      delayMin, delayOf,
    };
  }

  private async fetchDepartures(from: string, date: string) {
    const cacheKey = `departures:${from}|${date}`;
    const cached = await this.cacheManager.get<any[]>(cacheKey);
    if (cached) return cached;

    const departures: any[] = [];
    const codeAirport = (code: string) => ({ [code.length === 3 ? 'iata' : 'icao']: code });
    for (const [start, end] of [['00:00', '11:59'], ['12:00', '23:59']]) {
      const board = await this.adb.airportBoardRange(from, `${date}T${start}`, `${date}T${end}`, { direction: 'Departure', withLeg: true, withCargo: false });
      departures.push(...board.departures);
    }
    await this.movements.record(departures.map((f: any) => {
      const l = this.adb.toLeg(f);
      (l as any).dep.airport ??= codeAirport(from);
      return legToMovements(l, 'route');
    }).flat());

    await this.cacheManager.set(cacheKey, departures, DEPARTURES_TTL);
    return departures;
  }

  async searchRoute(from: string, to: string, date: string) {
    const toField = to.length === 3 ? 'iata' : 'icao';
    const departures = await this.fetchDepartures(from, date);
    const flights = departures
      .filter((f: any) => f.arrival?.airport?.[toField] === to)
      .map((f: any) => this.toRouteFlight(f, from))
      .filter((f: any) => f.origin.date === date)
      .sort((a: any, b: any) => (a.origin.scheduled ?? 0) - (b.origin.scheduled ?? 0));
    return { from, to, date, destination: flights[0]?.destination.airport ?? null, flights };
  }
}
