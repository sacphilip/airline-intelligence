import { Injectable, Logger } from '@nestjs/common';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import { Inject } from '@nestjs/common';
import { Cache } from 'cache-manager';
import { WeatherAssessment, Airport } from '../../types/flight.types';

const TTL_S = 30 * 60; // 30 minutes

@Injectable()
export class WeatherService {
  private readonly logger = new Logger(WeatherService.name);

  constructor(@Inject(CACHE_MANAGER) private readonly cacheManager: Cache) {}

  private async hourlyForecast(lat: number, lon: number): Promise<any> {
    const key = `weather:${lat.toFixed(2)},${lon.toFixed(2)}`;
    const cached = await this.cacheManager.get<any>(key);
    if (cached) return cached;

    const url =
      `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}` +
      '&hourly=weather_code,wind_gusts_10m,visibility&forecast_days=3&timeformat=unixtime&timezone=GMT';
    const res = await fetch(url);
    if (!res.ok) throw new Error(`Open-Meteo request failed (${res.status})`);
    const data = (await res.json()).hourly;
    await this.cacheManager.set(key, data, TTL_S * 1000);
    return data;
  }

  assessWeather(params: { weatherCode?: number; gustKmh?: number; visibilityM?: number }, where: string): WeatherAssessment | null {
    const { weatherCode: wc, gustKmh: gust, visibilityM: vis } = params;
    if ([95, 96, 99].includes(wc!)) return { severity: 2, text: `Thunderstorms forecast ${where}` };
    if ([71, 73, 75, 77, 85, 86].includes(wc!)) return { severity: 2, text: `Snow forecast ${where}` };
    if ([56, 57, 66, 67].includes(wc!)) return { severity: 2, text: `Freezing rain forecast ${where}` };
    if (gust! >= 70) return { severity: 2, text: `Very strong gusts forecast ${where} (${Math.round(gust!)} km/h)` };
    if ([45, 48].includes(wc!) || (vis != null && vis < 1000)) return { severity: 1, text: `Fog / low visibility forecast ${where}` };
    if (gust! >= 50) return { severity: 1, text: `Strong gusts forecast ${where} (${Math.round(gust!)} km/h)` };
    if ([65, 82].includes(wc!)) return { severity: 1, text: `Heavy rain forecast ${where}` };
    return null;
  }

  async weatherAt(airport: Airport | null, time: number | null): Promise<WeatherAssessment | null> {
    if (airport?.lat == null || airport?.lon == null || time == null) return null;
    let hourly: any;
    try {
      hourly = await this.hourlyForecast(airport.lat, airport.lon);
    } catch (err: any) {
      this.logger.warn(err.message);
      return null;
    }
    const i = hourly?.time?.findIndex((t: number) => Math.abs(t * 1000 - time) <= 30 * 60_000) ?? -1;
    if (i < 0) return null;
    return this.assessWeather({
      weatherCode: hourly.weather_code?.[i],
      gustKmh: hourly.wind_gusts_10m?.[i],
      visibilityM: hourly.visibility?.[i],
    }, `at ${airport.iata || airport.icao}`);
  }
}
