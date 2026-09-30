import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Airline } from '../../types/flight.types';

const AIRLINES_CSV = 'https://raw.githubusercontent.com/vradarserver/standing-data/main/airlines/schema-01/airlines.csv';

interface AirlineIndex {
  byIcao: Map<string, { name: string; iata: string | null }>;
  byIata: Map<string, string[]>;
}

const EMPTY: AirlineIndex = { byIcao: new Map(), byIata: new Map() };

@Injectable()
export class AirlinesService {
  private readonly logger = new Logger(AirlinesService.name);
  private cache: AirlineIndex = EMPTY;
  private cacheAt = 0;
  private pending: Promise<AirlineIndex> | null = null;
  private readonly userAgent: string;
  private readonly TTL = 24 * 60 * 60_000;

  constructor(cfg: ConfigService) {
    const contact = cfg.get('ADSB_CONTACT', '');
    this.userAgent = `flight-tracker/1.0 (${contact ? `contact: ${contact}` : 'personal'})`;
  }

  private parseCsvLine(line: string): string[] {
    const fields: string[] = [];
    let field = '', quoted = false;
    for (let i = 0; i < line.length; i++) {
      const c = line[i];
      if (quoted) {
        if (c === '"' && line[i + 1] === '"') { field += '"'; i++; }
        else if (c === '"') quoted = false;
        else field += c;
      } else if (c === '"') quoted = true;
      else if (c === ',') { fields.push(field); field = ''; }
      else field += c;
    }
    fields.push(field);
    return fields;
  }

  private parseAirlines(csv: string): AirlineIndex {
    const byIcao = new Map<string, { name: string; iata: string | null }>();
    const byIata = new Map<string, string[]>();
    const [header, ...rows] = csv.replace(/^﻿/, '').split(/\r?\n/);
    const cols = this.parseCsvLine(header);
    const [iName, iIcao, iIata] = ['Name', 'ICAO', 'IATA'].map(c => cols.indexOf(c));
    for (const row of rows) {
      if (!row) continue;
      const f = this.parseCsvLine(row);
      if (!f[iIcao] || byIcao.has(f[iIcao])) continue;
      byIcao.set(f[iIcao], { name: f[iName].replace(/&amp;/g, '&'), iata: f[iIata] || null });
      if (f[iIata]) byIata.set(f[iIata], [...(byIata.get(f[iIata]) ?? []), f[iIcao]]);
    }
    return { byIcao, byIata };
  }

  private async load(): Promise<AirlineIndex> {
    if (Date.now() - this.cacheAt < this.TTL && this.cache !== EMPTY) return this.cache;
    if (this.pending) return this.pending;
    this.pending = (async () => {
      try {
        const res = await fetch(AIRLINES_CSV, { headers: { 'User-Agent': this.userAgent } });
        if (!res.ok) throw new Error(`airline list request failed (${res.status})`);
        this.cache = this.parseAirlines(await res.text());
        this.cacheAt = Date.now();
        return this.cache;
      } catch (err: any) {
        this.logger.warn(err.message);
        return EMPTY;
      } finally {
        this.pending = null;
      }
    })();
    return this.pending;
  }

  async airlineNames(): Promise<Record<string, string>> {
    const { byIcao } = await this.load();
    return Object.fromEntries([...byIcao].map(([icao, a]) => [icao, a.name]));
  }

  async lookupAirline(icao: string | null): Promise<Airline | null> {
    if (!icao || !/^[A-Z]{3}$/.test(icao)) return null;
    const a = (await this.load()).byIcao.get(icao);
    return a ? { icao, iata: a.iata, name: a.name } : null;
  }

  async icaoCodesForIata(iata: string): Promise<string[]> {
    return (await this.load()).byIata.get(iata) ?? [];
  }
}
