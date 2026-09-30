import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, DataSource } from 'typeorm';
import { Movement } from './movement.entity';
import { FlightHistoryRecord, AirportHourRecord } from '../types/flight.types';

const DELAYED_MIN = 15;

export function normalizeNumber(n: string | null): string | null {
  return n ? String(n).toUpperCase().replace(/\s+/g, '') : null;
}

/** Convert a toLeg()-shaped leg into its two movement rows. */
export function legToMovements(leg: any, source: string): any[] {
  const delay = (end: any) =>
    end.sched != null && end.best != null
      ? Math.round((end.best - end.sched) / 60000)
      : null;
  const movement = (direction: string, here: any, there: any) => ({
    direction,
    number: leg.number,
    scheduled: here.sched,
    airport: here.airport,
    other: there.airport,
    airline: leg.airline,
    reg: leg.reg,
    best: here.best,
    actual: here.actual,
    cancelled: leg.cancelled,
    delayMin: leg.cancelled ? null : delay(here),
    status: leg.status,
    source,
  });
  return [
    movement('Departure', leg.dep, leg.arr),
    movement('Arrival', leg.arr, leg.dep),
  ];
}

@Injectable()
export class MovementRepository {
  constructor(
    @InjectRepository(Movement)
    private readonly repo: Repository<Movement>,
    private readonly dataSource: DataSource,
  ) {}

  async saveMovements(rows: any[]): Promise<void> {
    const now = Date.now();
    const queryRunner = this.dataSource.createQueryRunner();
    await queryRunner.connect();
    await queryRunner.startTransaction();
    try {
      for (const r of rows) {
        if (!r.number || r.scheduled == null) continue;
        const key = {
          direction: r.direction,
          number: normalizeNumber(r.number)!,
          scheduled: String(r.scheduled),
        };
        const existing = await queryRunner.manager.findOne(Movement, { where: key as any });
        if (existing) {
          // Refine without overwriting confirmed actual times
          await queryRunner.manager.update(Movement, key as any, {
            airportIata: r.airport?.iata ?? existing.airportIata,
            airportIcao: r.airport?.icao ?? existing.airportIcao,
            otherIata: r.other?.iata ?? existing.otherIata,
            otherIcao: r.other?.icao ?? existing.otherIcao,
            airlineIcao: r.airline?.icao ?? existing.airlineIcao,
            airlineIata: r.airline?.iata ?? existing.airlineIata,
            airlineName: r.airline?.name ?? existing.airlineName,
            reg: r.reg ?? existing.reg,
            best: existing.actual && !r.actual ? existing.best : (r.best ?? existing.best),
            delayMin: existing.actual && !r.actual ? existing.delayMin : (r.delayMin ?? existing.delayMin),
            actual: existing.actual || Boolean(r.actual),
            cancelled: Boolean(r.cancelled),
            status: r.status ?? existing.status,
            source: r.source ?? existing.source,
            lastSeen: now,
          });
        } else {
          await queryRunner.manager.save(Movement, {
            ...key,
            scheduled: Number(r.scheduled),
            airportIata: r.airport?.iata ?? null,
            airportIcao: r.airport?.icao ?? null,
            otherIata: r.other?.iata ?? null,
            otherIcao: r.other?.icao ?? null,
            airlineIcao: r.airline?.icao ?? null,
            airlineIata: r.airline?.iata ?? null,
            airlineName: r.airline?.name ?? null,
            reg: r.reg ?? null,
            best: r.best ?? null,
            actual: Boolean(r.actual),
            cancelled: Boolean(r.cancelled),
            delayMin: r.delayMin ?? null,
            status: r.status ?? null,
            source: r.source ?? null,
            firstSeen: now,
            lastSeen: now,
          });
        }
      }
      await queryRunner.commitTransaction();
    } catch (err) {
      await queryRunner.rollbackTransaction();
      throw err;
    } finally {
      await queryRunner.release();
    }
  }

  async flightHistory(number: string, direction = 'Departure'): Promise<FlightHistoryRecord | null> {
    const key = normalizeNumber(number);
    if (!key) return null;
    const now = Date.now();
    const result = await this.repo
      .createQueryBuilder('m')
      .select('COUNT(*)', 'n')
      .addSelect(`SUM(CASE WHEN m.delay_min >= ${DELAYED_MIN} THEN 1 ELSE 0 END)`, 'delayed')
      .addSelect('AVG(GREATEST(m.delay_min, 0))', 'avg_delay')
      .addSelect('MIN(m.scheduled)', 'since')
      .where('m.number = :key AND m.direction = :direction AND m.actual = true AND m.cancelled = false AND m.delay_min IS NOT NULL AND m.scheduled < :now',
        { key, direction, now })
      .getRawOne();

    const cancelled = await this.repo
      .createQueryBuilder('m')
      .select('COUNT(*)', 'n')
      .where('m.number = :key AND m.direction = :direction AND m.cancelled = true AND m.scheduled < :now',
        { key, direction, now })
      .getRawOne();

    if (!Number(result.n) && !Number(cancelled.n)) return null;
    const n = Number(result.n);
    const delayed = Number(result.delayed ?? 0);
    return {
      observed: n,
      delayed,
      delayedPct: n ? delayed / n : null,
      avgDelay: result.avg_delay == null ? null : Math.round(Number(result.avg_delay)),
      cancelled: Number(cancelled.n),
      since: result.since ? Number(result.since) : null,
    };
  }

  async airportHourHistory(airport: any, utcHour: number): Promise<AirportHourRecord | null> {
    if (!airport) return null;
    const result = await this.repo
      .createQueryBuilder('m')
      .select('COUNT(*)', 'n')
      .addSelect(`SUM(CASE WHEN m.delay_min >= ${DELAYED_MIN} THEN 1 ELSE 0 END)`, 'delayed')
      .addSelect('AVG(GREATEST(m.delay_min, 0))', 'avg_delay')
      .where(
        `(m.airport_iata = :iata OR m.airport_icao = :icao)
        AND m.direction = 'Departure'
        AND m.actual = true AND m.cancelled = false AND m.delay_min IS NOT NULL
        AND (
          (EXTRACT(HOUR FROM TO_TIMESTAMP(m.scheduled / 1000)) - :hour + 24)::int % 24 <= 1
          OR (EXTRACT(HOUR FROM TO_TIMESTAMP(m.scheduled / 1000)) - :hour + 24)::int % 24 = 23
        )`,
        { iata: airport.iata ?? '', icao: airport.icao ?? '', hour: utcHour },
      )
      .getRawOne();

    if (!Number(result.n)) return null;
    const n = Number(result.n);
    const delayed = Number(result.delayed ?? 0);
    return { observed: n, delayedPct: delayed / n, avgDelay: Math.round(Number(result.avg_delay ?? 0)) };
  }

  async summary(): Promise<{ n: number; since: number | null }> {
    const r = await this.repo
      .createQueryBuilder('m')
      .select('COUNT(*)', 'n')
      .addSelect('MIN(m.first_seen)', 'since')
      .getRawOne();
    return { n: Number(r.n), since: r.since ? Number(r.since) : null };
  }

  /** Record movements, swallowing errors so callers are never interrupted. */
  async record(rows: any[]): Promise<void> {
    try {
      if (rows.length) await this.saveMovements(rows);
    } catch (err: any) {
      console.warn(`history not saved: ${err.message}`);
    }
  }
}
