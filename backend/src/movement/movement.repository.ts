import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, DataSource } from 'typeorm';
import { Movement } from './movement.entity';
import { FlightHistoryRecord, AirportHourRecord } from '../types/flight.types';

const DELAYED_MIN = 15;
const MIN_FLIGHTS = 5;

function computeScore(
  total: number,
  onTimePct: number | null,
  avgDelay: number | null,
  stddev: number | null,
  cancelRate: number | null,
): number | null {
  if (total < MIN_FLIGHTS) return null;
  const onTimeScore      = (onTimePct  ?? 0) * 40;
  const cancelScore      = Math.max(0, 20 * (1 - (cancelRate ?? 0) * 5));
  const avgDelayScore    = Math.max(0, 25 * (1 - (avgDelay   ?? 0) / 60));
  const consistencyScore = stddev != null ? Math.max(0, 15 * (1 - stddev / 45)) : 0;
  return Math.round(Math.min(100, Math.max(0, onTimeScore + cancelScore + avgDelayScore + consistencyScore)));
}

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

  async airlineProfile(iata: string) {
    const code = iata.toUpperCase();

    const stats = await this.repo.createQueryBuilder('m')
      .select('COUNT(*)', 'n')
      .addSelect(`SUM(CASE WHEN m.delay_min < ${DELAYED_MIN} THEN 1 ELSE 0 END)`, 'on_time')
      .addSelect('AVG(GREATEST(m.delay_min, 0))', 'avg_delay')
      .addSelect('STDDEV(GREATEST(m.delay_min, 0))', 'stddev_delay')
      .where('m.airline_iata = :code AND m.direction = :dir AND m.actual = true AND m.cancelled = false AND m.delay_min IS NOT NULL',
        { code, dir: 'Departure' })
      .getRawOne();

    const cancelStats = await this.repo.createQueryBuilder('m')
      .select('COUNT(*)', 'n')
      .where('m.airline_iata = :code AND m.direction = :dir AND m.cancelled = true', { code, dir: 'Departure' })
      .getRawOne();

    const observed    = Number(stats?.n ?? 0);
    const cancelled   = Number(cancelStats?.n ?? 0);
    const total       = observed + cancelled;
    const onTimePct   = observed > 0 ? Number(stats.on_time ?? 0) / observed : null;
    const avgDelay    = stats?.avg_delay    != null ? Math.round(Number(stats.avg_delay))    : null;
    const stddev      = stats?.stddev_delay != null ? Number(stats.stddev_delay)             : null;
    const cancelRate  = total > 0 ? cancelled / total : null;

    // Delay distribution buckets
    const dist = await this.repo.createQueryBuilder('m')
      .select(`SUM(CASE WHEN m.delay_min <  0 THEN 1 ELSE 0 END)`, 'early')
      .addSelect(`SUM(CASE WHEN m.delay_min >= 0  AND m.delay_min < 15 THEN 1 ELSE 0 END)`, 'ontime')
      .addSelect(`SUM(CASE WHEN m.delay_min >= 15 AND m.delay_min < 30 THEN 1 ELSE 0 END)`, 'slight')
      .addSelect(`SUM(CASE WHEN m.delay_min >= 30 AND m.delay_min < 60 THEN 1 ELSE 0 END)`, 'moderate')
      .addSelect(`SUM(CASE WHEN m.delay_min >= 60 THEN 1 ELSE 0 END)`, 'severe')
      .where('m.airline_iata = :code AND m.direction = :dir AND m.actual = true AND m.cancelled = false AND m.delay_min IS NOT NULL',
        { code, dir: 'Departure' })
      .getRawOne();

    const score = computeScore(total, onTimePct, avgDelay, stddev, cancelRate);

    const routes = await this.repo.createQueryBuilder('m')
      .select('m.airport_iata', 'from').addSelect('m.other_iata', 'to').addSelect('COUNT(*)', 'cnt')
      .where('m.airline_iata = :code AND m.direction = :dir AND m.airport_iata IS NOT NULL AND m.other_iata IS NOT NULL',
        { code, dir: 'Departure' })
      .groupBy('m.airport_iata, m.other_iata').orderBy('cnt', 'DESC').limit(10)
      .getRawMany();

    const airports = await this.repo.createQueryBuilder('m')
      .select('m.airport_iata', 'iata').addSelect('COUNT(*)', 'cnt')
      .where('m.airline_iata = :code AND m.airport_iata IS NOT NULL', { code })
      .groupBy('m.airport_iata').orderBy('cnt', 'DESC').limit(12)
      .getRawMany();

    const regRows = await this.repo.createQueryBuilder('m')
      .select('DISTINCT m.reg', 'reg')
      .where('m.airline_iata = :code AND m.reg IS NOT NULL', { code })
      .getRawMany();

    return {
      observed, cancelled, total,
      onTimePct, avgDelay, delayStddev: stddev != null ? Math.round(stddev) : null,
      cancellationRate: cancelRate,
      score,
      delayDist: {
        early:    Number(dist?.early    ?? 0),
        ontime:   Number(dist?.ontime   ?? 0),
        slight:   Number(dist?.slight   ?? 0),
        moderate: Number(dist?.moderate ?? 0),
        severe:   Number(dist?.severe   ?? 0),
      },
      topRoutes:   routes.map(r => ({ from: r.from, to: r.to, count: Number(r.cnt) })),
      topAirports: airports.map(a => ({ iata: a.iata, count: Number(a.cnt) })),
      regs: regRows.map(r => r.reg).filter(Boolean).sort(),
    };
  }

  async airlineRankings(): Promise<unknown[]> {
    const rows = await this.repo.createQueryBuilder('m')
      .select('m.airline_iata', 'iata')
      .addSelect('MAX(m.airline_name)', 'name')
      .addSelect(`COUNT(*) FILTER (WHERE m.actual = true AND m.cancelled = false AND m.delay_min IS NOT NULL)`, 'observed')
      .addSelect(`SUM(CASE WHEN m.delay_min < ${DELAYED_MIN} THEN 1 ELSE 0 END) FILTER (WHERE m.actual = true AND m.cancelled = false AND m.delay_min IS NOT NULL)`, 'on_time')
      .addSelect(`AVG(GREATEST(m.delay_min, 0)) FILTER (WHERE m.actual = true AND m.cancelled = false AND m.delay_min IS NOT NULL)`, 'avg_delay')
      .addSelect(`STDDEV(GREATEST(m.delay_min, 0)) FILTER (WHERE m.actual = true AND m.cancelled = false AND m.delay_min IS NOT NULL)`, 'stddev_delay')
      .addSelect(`COUNT(*) FILTER (WHERE m.cancelled = true)`, 'cancelled')
      .where('m.direction = :dir AND m.airline_iata IS NOT NULL', { dir: 'Departure' })
      .groupBy('m.airline_iata')
      .getRawMany();

    return rows
      .map(r => {
        const observed   = Number(r.observed  ?? 0);
        const cancelled  = Number(r.cancelled ?? 0);
        const total      = observed + cancelled;
        const onTimePct  = observed > 0 ? Number(r.on_time ?? 0) / observed : null;
        const avgDelay   = r.avg_delay    != null ? Math.round(Number(r.avg_delay))    : null;
        const stddev     = r.stddev_delay != null ? Number(r.stddev_delay)             : null;
        const cancelRate = total > 0 ? cancelled / total : null;
        const score      = computeScore(total, onTimePct, avgDelay, stddev, cancelRate);
        return { iata: r.iata, name: r.name ?? null, score, observed, total, onTimePct, avgDelay, cancellationRate: cancelRate };
      })
      .filter(r => r.score !== null)
      .sort((a, b) => (b.score ?? 0) - (a.score ?? 0));
  }

  async airlineTrend(iata: string, months: number): Promise<unknown> {
    const code   = iata.toUpperCase();
    const cutoff = Date.now() - months * 31 * 24 * 60 * 60 * 1000;

    const rows = await this.repo.createQueryBuilder('m')
      .select(`TO_CHAR(DATE_TRUNC('month', TO_TIMESTAMP(m.scheduled / 1000.0)), 'YYYY-MM')`, 'month')
      .addSelect(`COUNT(*) FILTER (WHERE m.actual = true AND m.cancelled = false AND m.delay_min IS NOT NULL)`, 'observed')
      .addSelect(`SUM(CASE WHEN m.delay_min < ${DELAYED_MIN} THEN 1 ELSE 0 END) FILTER (WHERE m.actual = true AND m.cancelled = false AND m.delay_min IS NOT NULL)`, 'on_time')
      .addSelect(`AVG(GREATEST(m.delay_min, 0)) FILTER (WHERE m.actual = true AND m.cancelled = false AND m.delay_min IS NOT NULL)`, 'avg_delay')
      .addSelect(`STDDEV(GREATEST(m.delay_min, 0)) FILTER (WHERE m.actual = true AND m.cancelled = false AND m.delay_min IS NOT NULL)`, 'stddev_delay')
      .addSelect(`COUNT(*) FILTER (WHERE m.cancelled = true)`, 'cancelled')
      .where('m.airline_iata = :code AND m.direction = :dir AND m.scheduled >= :cutoff',
        { code, dir: 'Departure', cutoff })
      .groupBy(`DATE_TRUNC('month', TO_TIMESTAMP(m.scheduled / 1000.0))`)
      .orderBy(`DATE_TRUNC('month', TO_TIMESTAMP(m.scheduled / 1000.0))`, 'ASC')
      .getRawMany();

    const monthData = rows
      .map(r => {
        const observed   = Number(r.observed  ?? 0);
        const cancelled  = Number(r.cancelled ?? 0);
        const total      = observed + cancelled;
        const onTimePct  = observed > 0 ? Number(r.on_time ?? 0) / observed : null;
        const avgDelay   = r.avg_delay    != null ? Math.round(Number(r.avg_delay))    : null;
        const stddev     = r.stddev_delay != null ? Number(r.stddev_delay)             : null;
        const cancelRate = total > 0 ? cancelled / total : null;
        const score      = computeScore(total, onTimePct, avgDelay, stddev, cancelRate);
        return { month: r.month as string, score, observed };
      })
      .filter(m => m.score !== null && m.observed >= MIN_FLIGHTS);

    let pctChange: number | null = null;
    let direction: 'up' | 'down' | 'stable' = 'stable';
    if (monthData.length >= 2) {
      const first = monthData[0].score!;
      const last  = monthData[monthData.length - 1].score!;
      pctChange = first > 0 ? Math.round(((last - first) / first) * 1000) / 10 : null;
      if (pctChange !== null) direction = pctChange > 1 ? 'up' : pctChange < -1 ? 'down' : 'stable';
    }

    return { iata: code, months: monthData, pctChange, direction };
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
