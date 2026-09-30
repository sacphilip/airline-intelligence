import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { LiveAircraft } from '../../types/flight.types';

const API = 'https://api.adsb.lol/v2';
const ROUTES = 'https://vrs-standing-data.adsb.lol/routes';
const FRESH_MS = 8_000;
const MIN_GAP_MS = 2_000;
const STALE_MAX_MS = 5 * 60_000;

export class RateLimitedError extends Error {
  constructor(public readonly retryAt: number) {
    super('adsb.lol is rate-limiting requests');
  }
}

interface CacheEntry { at: number; data: any }

@Injectable()
export class AdsbService {
  private readonly logger = new Logger(AdsbService.name);
  private readonly cache = new Map<string, CacheEntry>();
  private lastRequestAt = 0;
  private blockedUntil = 0;
  private backoffMs = 0;
  private readonly userAgent: string;

  constructor(private readonly cfg: ConfigService) {
    const contact = cfg.get('ADSB_CONTACT', '');
    this.userAgent = `flight-tracker/1.0 (personal non-commercial map${contact ? `; contact: ${contact}` : ''})`;
  }

  private cacheGet(key: string, maxAgeMs = STALE_MAX_MS): any {
    const e = this.cache.get(key);
    if (!e) return undefined;
    return Date.now() - e.at < maxAgeMs ? e.data : undefined;
  }
  private cacheSet(key: string, data: any): any {
    const now = Date.now();
    for (const [k, v] of this.cache) if (now - v.at > STALE_MAX_MS) this.cache.delete(k);
    this.cache.set(key, { at: now, data });
    return data;
  }
  private recent(maxAgeMs: number): any[] {
    const now = Date.now();
    return [...this.cache.values()].reverse()
      .filter(e => now - e.at <= maxAgeMs)
      .map(e => e.data);
  }

  private async fetchThrottled(url: string): Promise<any> {
    const fresh = this.cacheGet(url, FRESH_MS);
    if (fresh) return fresh;
    const stale = this.cacheGet(url);

    const now = Date.now();
    if (now < this.blockedUntil || now - this.lastRequestAt < MIN_GAP_MS) {
      if (stale) return stale;
      if (now < this.blockedUntil) throw new RateLimitedError(this.blockedUntil);
      await new Promise(r => setTimeout(r, MIN_GAP_MS - (now - this.lastRequestAt)));
    }

    this.lastRequestAt = Date.now();
    const res = await fetch(url, { headers: { 'User-Agent': this.userAgent } });

    if (res.status === 429 || res.status === 420) {
      const retryAfter = Number(res.headers.get('retry-after')) * 1000;
      this.backoffMs = Math.min(this.backoffMs ? this.backoffMs * 2 : 30_000, 5 * 60_000);
      this.blockedUntil = Date.now() + (retryAfter || this.backoffMs);
      this.logger.warn(`adsb.lol rate limit; pausing ${Math.round((this.blockedUntil - Date.now()) / 1000)}s`);
      if (stale) return stale;
      throw new RateLimitedError(this.blockedUntil);
    }
    if (!res.ok) throw new Error(`Upstream request failed (${res.status})`);
    const data = await res.json();
    this.backoffMs = 0;
    return this.cacheSet(url, data);
  }

  private normalizeAircraft(ac: any): LiveAircraft {
    const onGround = ac.alt_baro === 'ground';
    const squawk = ac.squawk ?? null;
    const emergency =
      (ac.emergency && ac.emergency !== 'none' ? ac.emergency : null) ??
      ({ '7500': 'hijack', '7600': 'radio failure', '7700': 'general emergency' }[squawk] ?? null);
    return {
      hex: ac.hex,
      callsign: ac.flight?.trim() || null,
      registration: ac.r ?? null,
      type: ac.t ?? null,
      description: ac.desc ?? null,
      lat: ac.lat,
      lon: ac.lon,
      onGround,
      altitude: onGround ? 0 : (typeof ac.alt_baro === 'number' ? ac.alt_baro : ac.alt_geom ?? null),
      groundSpeed: ac.gs ?? null,
      track: ac.track ?? ac.true_heading ?? ac.mag_heading ?? null,
      verticalRate: ac.baro_rate ?? ac.geom_rate ?? null,
      squawk,
      emergency,
      distance: ac.dst ?? null,
      seen: ac.seen ?? null,
    };
  }

  async aircraftNear(lat: number, lon: number, dist: number) {
    const grid = dist <= 40 ? 0.1 : 0.5;
    const pad = grid === 0.1 ? 5 : 25;
    const RADIUS_STEPS = [10, 25, 50, 100, 150, 200, 250];
    const radius = RADIUS_STEPS.find(s => s >= dist + pad) ?? 250;
    const snap = (v: number) => (Math.round(v / grid) * grid).toFixed(1);
    const data = await this.fetchThrottled(`${API}/point/${snap(lat)}/${snap(lon)}/${radius}`);
    return {
      now: data.now ?? Date.now(),
      radius,
      aircraft: (data.ac ?? [])
        .filter((a: any) => typeof a.lat === 'number' && typeof a.lon === 'number')
        .map((a: any) => this.normalizeAircraft(a)),
    };
  }

  async findLive(params: { hex?: string | null; callsign?: string | null }): Promise<{ aircraft: LiveAircraft | null; error?: string }> {
    const { hex, callsign } = params;
    const url = hex ? `${API}/hex/${hex}` : callsign ? `${API}/callsign/${callsign}` : null;
    if (!url) return { aircraft: null };

    const matches = (a: any) =>
      (hex ? a.hex === hex : a.flight?.trim() === callsign) &&
      typeof a.lat === 'number' && typeof a.lon === 'number';

    for (const data of this.recent(60_000)) {
      const ac = data?.ac?.find(matches);
      if (ac) return { aircraft: this.normalizeAircraft(ac) };
    }

    try {
      const data = await this.fetchThrottled(url);
      const ac = (data.ac ?? []).find((a: any) => typeof a.lat === 'number' && typeof a.lon === 'number');
      return { aircraft: ac ? this.normalizeAircraft(ac) : null };
    } catch (err: any) {
      return { error: err instanceof RateLimitedError ? 'adsb.lol is rate-limiting requests' : err.message };
    }
  }

  async lookupRoute(callsign: string | null): Promise<any | null> {
    if (!callsign) return null;
    const res = await fetch(`${ROUTES}/${callsign.slice(0, 2)}/${callsign}.json`, {
      headers: { 'User-Agent': this.userAgent },
    });
    if (res.status === 404) return null;
    if (!res.ok) throw new Error(`adsb.lol route lookup failed (${res.status})`);
    const route = await res.json();
    const airports = route?._airports;
    if (!Array.isArray(airports) || airports.length < 2) return null;
    const toAirport = (ap: any) => ({
      iata: ap.iata ?? null, icao: ap.icao ?? null, name: ap.name ?? null, city: ap.location ?? null,
      lat: ap.lat ?? null, lon: ap.lon ?? null, timeZone: null,
    });
    return {
      airlineCode: route.airline_code ?? null,
      routeNumber: route.number ?? null,
      origin: toAirport(airports[0]),
      destination: toAirport(airports[airports.length - 1]),
    };
  }
}
