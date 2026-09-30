import { Injectable } from '@nestjs/common';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import { Inject } from '@nestjs/common';
import { Cache } from 'cache-manager';
import { AeroDataBoxService, AIRBORNE_STATUSES } from '../sources/aerodatabox/aerodatabox.service';
import { AdsbService } from '../sources/adsb/adsb.service';
import { AirlinesService } from '../sources/airlines/airlines.service';
import { MovementRepository, legToMovements } from '../movement/movement.repository';
import { PredictionService, locateInChain } from '../prediction/prediction.service';
import { distanceNm } from '../geo/geo.util';
import { FlightLeg } from '../types/flight.types';

const SCHEDULE_TTL = 15 * 60_000;
const callsignAirline = (cs: string | null | undefined) => cs?.match(/^([A-Z]{3})\d/)?.[1] ?? null;
const byDeparture = (a: any, b: any) => (a.dep.sched ?? a.arr.sched ?? 0) - (b.dep.sched ?? b.arr.sched ?? 0);

@Injectable()
export class FlightService {
  constructor(
    @Inject(CACHE_MANAGER) private readonly cacheManager: Cache,
    private readonly adb: AeroDataBoxService,
    private readonly adsb: AdsbService,
    private readonly airlines: AirlinesService,
    private readonly movements: MovementRepository,
    private readonly prediction: PredictionService,
  ) {}

  private async loadSchedule(hex: string | null, callsign: string | null) {
    if (this.adb.isConfigured()) {
      try {
        const byAirframe = hex && !hex.startsWith('~')
          ? (await this.adb.flights('icao24', hex)).map(f => this.adb.toLeg(f))
          : [];
        if (byAirframe.length) {
          const legs = byAirframe.sort(byDeparture);
          await this.movements.record(legs.flatMap(l => legToMovements(l, 'aircraft')));
          return { kind: 'day' as const, legs };
        }
        const byCallsign = callsign
          ? (await this.adb.flights('callsign', callsign)).map(f => this.adb.toLeg(f))
          : [];
        if (byCallsign.length) {
          await this.movements.record(byCallsign.flatMap(l => legToMovements(l, 'flight')));
          return { kind: 'flight' as const, legs: byCallsign.sort(byDeparture) };
        }
      } catch (err: any) { console.warn(err.message); }
    }
    try {
      const route = await this.adsb.lookupRoute(callsign);
      return route ? { kind: 'route' as const, route } : { kind: 'none' as const };
    } catch (err: any) {
      console.warn(err.message);
      return { kind: 'none' as const };
    }
  }

  private pickFlight(legs: FlightLeg[], callsign: string | null, position: any): number {
    const byCallsign = legs.map((l, i) => [l, i] as const).filter(([l]) => callsign && (l as any).callSign === callsign);
    if (byCallsign.length) {
      const open = byCallsign.find(([l]) => l.status !== 'Arrived' && !l.cancelled);
      return (open ?? byCallsign[byCallsign.length - 1])[1] as number;
    }
    if (position.currentIndex >= 0) return position.currentIndex;
    const next = legs.findIndex((l, i) => i > position.lastArrivedIndex && !l.cancelled);
    return next >= 0 ? next : position.lastArrivedIndex;
  }

  private latestStarted(legs: FlightLeg[], now = Date.now()): FlightLeg {
    const dep = (l: any) => l.dep.best ?? l.dep.sched ?? 0;
    return legs.filter(l => dep(l) <= now + 30 * 60_000).sort((a, b) => dep(b) - dep(a))[0] ?? legs[0];
  }

  private flightFields(leg: any) {
    return {
      number: leg.number, airline: leg.airline, status: leg.status,
      origin: leg.dep.airport, destination: leg.arr.airport,
      sta: leg.arr.sched, eta: leg.cancelled ? null : leg.arr.best,
    };
  }

  private positionArrivalDelay(leg: any, live: any): number | null {
    const dest = leg.arr.airport;
    if (!live || live.onGround || !(live.groundSpeed > 50) || dest?.lat == null || leg.arr.sched == null) return null;
    const eta = Date.now() + (distanceNm(live.lat, live.lon, dest.lat, dest.lon) / live.groundSpeed) * 3_600_000;
    return Math.round((eta - leg.arr.sched) / 60_000);
  }

  async lookupAircraft(params: { hex: string | null; callsign: string | null; live?: { lat: number; lon: number; groundSpeed: number | null; onGround: boolean; type: string | null } | null }) {
    const { hex, callsign, live = null } = params;
    const cacheKey = `schedule:${hex || callsign}`;
    let schedule = await this.cacheManager.get<any>(cacheKey);
    if (!schedule) {
      schedule = await this.loadSchedule(hex, callsign);
      await this.cacheManager.set(cacheKey, schedule, SCHEDULE_TTL);
    }

    const result: any = { source: null, scheduleAvailable: this.adb.isConfigured(), chain: null, aircraft: null };

    if (schedule.kind === 'day') {
      const { legs } = schedule;
      const position = locateInChain(legs, { callsign, onGround: live?.onGround ?? false });
      const flightIndex = this.pickFlight(legs, callsign, position);
      const current = position.currentIndex >= 0 ? legs[position.currentIndex] : null;
      const chain = await this.prediction.predictChain(legs, {
        ...position,
        liveArrDelay: current && current.arr.best == null ? this.positionArrivalDelay(current, live) : null,
        typeCode: live?.type ?? null,
      });
      Object.assign(result, flightIndex >= 0 ? this.flightFields(legs[flightIndex]) : {}, {
        source: 'aerodatabox',
        aircraft: { reg: legs.find((l: any) => l.reg)?.reg ?? null, model: legs.find((l: any) => l.model)?.model ?? null },
        chain: { ...chain, flightIndex },
      });
    } else if (schedule.kind === 'flight') {
      Object.assign(result, this.flightFields(this.latestStarted(schedule.legs)), { source: 'aerodatabox' });
    } else if (schedule.kind === 'route') {
      const { route } = schedule;
      Object.assign(result, { source: 'adsb.lol', origin: route.origin, destination: route.destination, sta: null, eta: null });
      result.airline = await this.airlines.lookupAirline(route.airlineCode ?? callsignAirline(callsign));
      if (result.airline?.iata && route.routeNumber) result.number = `${result.airline.iata} ${route.routeNumber}`;
    }

    result.airline ??= await this.airlines.lookupAirline(callsignAirline(callsign));
    return result;
  }
}
