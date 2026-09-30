import { Injectable, HttpException, HttpStatus, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Airport, Airline, FlightLeg } from '../../types/flight.types';

const HOST = 'aerodatabox.p.rapidapi.com';

export const DONE_STATUSES = new Set(['Departed', 'EnRoute', 'Approaching', 'Arrived']);
export const AIRBORNE_STATUSES = new Set(['Departed', 'EnRoute', 'Approaching']);
export const CANCELLED_STATUSES = new Set(['Canceled', 'CanceledUncertain']);

@Injectable()
export class AeroDataBoxService {
  private readonly logger = new Logger(AeroDataBoxService.name);
  private readonly key: string | null;

  constructor(private readonly cfg: ConfigService) {
    this.key = cfg.get('AERODATABOX_KEY') ?? null;
  }

  isConfigured(): boolean { return Boolean(this.key); }

  private async request(path: string, params?: Record<string, any>, onStatus: Record<number, () => any> = {}): Promise<any> {
    const qs = params ? '?' + new URLSearchParams(
      Object.fromEntries(Object.entries(params).map(([k, v]) => [k, String(v)])),
    ) : '';
    const res = await fetch(`https://${HOST}${path}${qs}`, {
      headers: { 'X-RapidAPI-Key': this.key!, 'X-RapidAPI-Host': HOST },
    });
    if (res.status === 204) return null;
    if (onStatus[res.status]) {
      const outcome = onStatus[res.status]();
      if (outcome instanceof Error) throw outcome;
      return outcome;
    }
    if (res.status === 429) throw new HttpException('AeroDataBox quota or rate limit reached, try again later', HttpStatus.SERVICE_UNAVAILABLE);
    if (!res.ok) throw new Error(`AeroDataBox request failed (${res.status})`);
    return res.json();
  }

  // --- time helpers ---
  adbTime(movement: any, field: string): number | null {
    const utc = movement?.[field]?.utc ?? movement?.[`${field}Utc`];
    const ms = utc ? Date.parse(utc.replace(' ', 'T')) : NaN;
    return Number.isFinite(ms) ? ms : null;
  }
  bestTime(m: any): number | null {
    return this.adbTime(m, 'revisedTime') ?? this.adbTime(m, 'runwayTime') ?? this.adbTime(m, 'predictedTime');
  }
  localHHmm(m: any, field: string): string | null { return m?.[field]?.local?.slice(11, 16) ?? null; }
  bestLocalHHmm(m: any): string | null {
    return this.localHHmm(m, 'revisedTime') ?? this.localHHmm(m, 'runwayTime') ?? this.localHHmm(m, 'predictedTime');
  }
  localDate(m: any): string | null { return m?.scheduledTime?.local?.slice(0, 10) ?? null; }

  settleStatus(status: string | null, times: { depSched?: number | null; depBest?: number | null; arrSched?: number | null; arrBest?: number | null }, now = Date.now()) {
    if (!AIRBORNE_STATUSES.has(status ?? '')) return { status, inferred: false };
    const LANDED_GRACE_MS = 60 * 60_000;
    const depDelay = times.depSched != null && times.depBest != null ? Math.max(0, times.depBest - times.depSched) : 0;
    const expectedArrival = times.arrBest ?? (times.arrSched == null ? null : times.arrSched + depDelay);
    if (expectedArrival != null && now > expectedArrival + LANDED_GRACE_MS) return { status: 'Arrived', inferred: true };
    return { status, inferred: false };
  }

  settleFlightStatus(f: any, now = Date.now()) {
    return this.settleStatus(f.status ?? null, {
      depSched: this.adbTime(f.departure, 'scheduledTime'),
      depBest: this.bestTime(f.departure),
      arrSched: this.adbTime(f.arrival, 'scheduledTime'),
      arrBest: this.bestTime(f.arrival),
    }, now);
  }

  toAirport(ap: any): Airport | null {
    if (!ap) return null;
    return {
      iata: ap.iata ?? null, icao: ap.icao ?? null,
      name: ap.shortName ?? ap.name ?? null,
      city: ap.municipalityName ?? null,
      lat: ap.location?.lat ?? null, lon: ap.location?.lon ?? null,
      timeZone: ap.timeZone ?? null,
    };
  }

  toAirline(a: any): Airline | null {
    return a?.name ? { name: a.name, iata: a.iata ?? null, icao: a.icao ?? null } : null;
  }

  toLeg(f: any): FlightLeg {
    const { status, inferred } = this.settleFlightStatus(f);
    const cancelled = CANCELLED_STATUSES.has(status ?? '');
    const end = (m: any, happened: boolean) => ({
      airport: this.toAirport(m?.airport),
      sched: this.adbTime(m, 'scheduledTime'),
      best: cancelled ? null : this.bestTime(m),
      actual: !cancelled && happened,
      terminal: m?.terminal ?? null,
      gate: m?.gate ?? null,
    });
    return {
      number: f.number ?? null,
      callSign: f.callSign?.replace(/\s+/g, '').toUpperCase() || null,
      status: status ?? null,
      statusInferred: inferred,
      cancelled,
      airline: this.toAirline(f.airline),
      reg: f.aircraft?.reg ?? null,
      model: f.aircraft?.model ?? null,
      hex: f.aircraft?.modeS?.toLowerCase() ?? null,
      dep: end(f.departure, DONE_STATUSES.has(status ?? '')),
      arr: end(f.arrival, status === 'Arrived' && !inferred),
    };
  }

  // --- endpoints ---
  async flights(by: string, id: string, date?: string | null): Promise<any[]> {
    const data = await this.request(
      `/flights/${by}/${encodeURIComponent(id)}${date ? `/${date}` : ''}`,
      { withAircraftImage: 'false', withLocation: 'false' },
      { 404: () => [] },
    );
    return Array.isArray(data) ? data : [];
  }

  private BOARD_DEFAULTS = { withCancelled: 'true', withCodeshared: 'false', withPrivate: 'false', withLocation: 'false' };
  private airportPath(code: string) { return `/flights/airports/${code.length === 3 ? 'iata' : 'icao'}/${code}`; }

  async airportBoard(code: string, opts: { offsetMinutes: number; durationMinutes: number; direction?: string; withLeg?: boolean; withCargo?: boolean }) {
    const data = await this.request(this.airportPath(code), {
      ...this.BOARD_DEFAULTS,
      offsetMinutes: opts.offsetMinutes,
      durationMinutes: opts.durationMinutes,
      direction: opts.direction ?? 'Both',
      withLeg: opts.withLeg ?? false,
      withCargo: opts.withCargo ?? true,
    }, {
      400: () => new HttpException(`Unknown airport "${code}"`, HttpStatus.NOT_FOUND),
      404: () => new HttpException(`Unknown airport "${code}"`, HttpStatus.NOT_FOUND),
    });
    return { arrivals: data?.arrivals ?? [], departures: data?.departures ?? [] };
  }

  async airportBoardRange(code: string, fromLocal: string, toLocal: string, opts: { direction?: string; withLeg?: boolean; withCargo?: boolean }) {
    const date = fromLocal.slice(0, 10);
    const data = await this.request(`${this.airportPath(code)}/${fromLocal}/${toLocal}`, {
      ...this.BOARD_DEFAULTS,
      direction: opts.direction ?? 'Both',
      withLeg: opts.withLeg ?? false,
      withCargo: opts.withCargo ?? true,
    }, {
      400: () => new HttpException(`No schedule data for ${code} on ${date}.`, HttpStatus.NOT_FOUND),
      404: () => new HttpException(`Unknown airport "${code}"`, HttpStatus.NOT_FOUND),
    });
    return { arrivals: data?.arrivals ?? [], departures: data?.departures ?? [] };
  }
}
