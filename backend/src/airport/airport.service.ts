import { Injectable } from '@nestjs/common';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import { Inject } from '@nestjs/common';
import { Cache } from 'cache-manager';
import { AeroDataBoxService, DONE_STATUSES, CANCELLED_STATUSES } from '../sources/aerodatabox/aerodatabox.service';
import { MovementRepository } from '../movement/movement.repository';

const BOARD_TTL = 15 * 60_000;

@Injectable()
export class AirportService {
  constructor(
    @Inject(CACHE_MANAGER) private readonly cacheManager: Cache,
    private readonly adb: AeroDataBoxService,
    private readonly movements: MovementRepository,
  ) {}

  toDelayFlight(f: any, direction: 'Arrival' | 'Departure') {
    const m = f.movement ?? {};
    const sched = this.adb.adbTime(m, 'scheduledTime');
    const best = this.adb.bestTime(m);
    const { status, inferred } = direction === 'Arrival'
      ? this.adb.settleStatus(f.status ?? null, { arrSched: sched, arrBest: best })
      : { status: f.status ?? null, inferred: false };
    const cancelled = CANCELLED_STATUSES.has(status ?? '');
    const actual = direction === 'Arrival'
      ? status === 'Arrived' && !inferred
      : DONE_STATUSES.has(status ?? '');
    return {
      number: f.number ?? null,
      direction,
      status,
      statusInferred: inferred,
      cargo: Boolean(f.isCargo),
      airline: this.adb.toAirline(f.airline),
      other: m.airport ? { iata: m.airport.iata ?? null, icao: m.airport.icao ?? null, name: m.airport.shortName ?? m.airport.name ?? null } : null,
      scheduled: sched,
      scheduledLocal: this.adb.localHHmm(m, 'scheduledTime'),
      best: cancelled ? null : best,
      bestLocal: cancelled ? null : this.adb.bestLocalHHmm(m),
      actual: !cancelled && actual,
      cancelled,
      delayMin: !cancelled && sched != null && best != null ? Math.round((best - sched) / 60_000) : null,
    };
  }

  async fetchBoard(code: string, window: { offsetMinutes: number; durationMinutes: number }) {
    const board = await this.adb.airportBoard(code, window);
    const codeAirport = (c: string) => ({ [c.length === 3 ? 'iata' : 'icao']: c });
    const flights = [
      ...board.arrivals.map((f: any) => this.toDelayFlight(f, 'Arrival')),
      ...board.departures.map((f: any) => this.toDelayFlight(f, 'Departure')),
    ];
    await this.movements.record(flights.map(f => ({ ...f, airport: codeAirport(code), source: 'board' })));
    return flights;
  }

  async airportDelays(code: string) {
    const cacheKey = `board:${code}`;
    const cached = await this.cacheManager.get<any[]>(cacheKey);
    if (cached) return { airport: code, flights: cached };

    const flights = await this.fetchBoard(code, { offsetMinutes: -360, durationMinutes: 720 });
    await this.cacheManager.set(cacheKey, flights, BOARD_TTL);
    return { airport: code, fetchedAt: Date.now(), flights };
  }
}
