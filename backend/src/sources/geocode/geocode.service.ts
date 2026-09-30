import { Injectable } from '@nestjs/common';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import { Inject } from '@nestjs/common';
import { Cache } from 'cache-manager';

@Injectable()
export class GeocodeService {
  constructor(@Inject(CACHE_MANAGER) private readonly cacheManager: Cache) {}

  async findPlace(query: string): Promise<{ name: string; lat: number; lon: number } | null> {
    const key = `geocode:${query.toLowerCase()}`;
    const cached = await this.cacheManager.get<any>(key);
    if (cached) return cached;

    const res = await fetch(
      `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(query)}&count=1`,
    );
    if (!res.ok) throw new Error(`Place search failed (${res.status})`);
    const data = await res.json();
    const place = data.results?.[0];
    if (!place) return null;

    const result = {
      name: [place.name, place.admin1, place.country].filter(Boolean).join(', '),
      lat: place.latitude,
      lon: place.longitude,
    };
    await this.cacheManager.set(key, result, 60 * 60_000);
    return result;
  }
}
