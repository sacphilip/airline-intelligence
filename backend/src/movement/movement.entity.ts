import {
  Entity, Column, PrimaryColumn, Index, CreateDateColumn, UpdateDateColumn,
} from 'typeorm';

@Entity('movements')
@Index('movements_airport', ['airportIata', 'direction', 'scheduled'])
@Index('movements_airline', ['airlineIcao', 'scheduled'])
export class Movement {
  @PrimaryColumn({ type: 'varchar', length: 20 })
  direction: string; // 'Departure' | 'Arrival'

  @PrimaryColumn({ type: 'varchar', length: 20 })
  number: string; // e.g. "BA117"

  @PrimaryColumn({ type: 'bigint' })
  scheduled: number; // epoch ms

  @Column({ name: 'airport_iata', type: 'varchar', length: 4, nullable: true })
  airportIata: string | null;

  @Column({ name: 'airport_icao', type: 'varchar', length: 4, nullable: true })
  airportIcao: string | null;

  @Column({ name: 'other_iata', type: 'varchar', length: 4, nullable: true })
  otherIata: string | null;

  @Column({ name: 'other_icao', type: 'varchar', length: 4, nullable: true })
  otherIcao: string | null;

  @Column({ name: 'airline_icao', type: 'varchar', length: 4, nullable: true })
  airlineIcao: string | null;

  @Column({ name: 'airline_iata', type: 'varchar', length: 3, nullable: true })
  airlineIata: string | null;

  @Column({ name: 'airline_name', type: 'varchar', length: 100, nullable: true })
  airlineName: string | null;

  @Column({ type: 'varchar', length: 10, nullable: true })
  reg: string | null;

  @Column({ type: 'bigint', nullable: true })
  best: number | null;

  @Column({ type: 'boolean', default: false })
  actual: boolean;

  @Column({ type: 'boolean', default: false })
  cancelled: boolean;

  @Column({ name: 'delay_min', type: 'integer', nullable: true })
  delayMin: number | null;

  @Column({ type: 'varchar', length: 30, nullable: true })
  status: string | null;

  @Column({ type: 'varchar', length: 20, nullable: true })
  source: string | null;

  @Column({ name: 'first_seen', type: 'bigint' })
  firstSeen: number;

  @Column({ name: 'last_seen', type: 'bigint' })
  lastSeen: number;
}
