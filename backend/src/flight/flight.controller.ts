import { Controller, Get, Query, BadRequestException } from '@nestjs/common';
import { FlightService } from './flight.service';
import { AdsbService, RateLimitedError } from '../sources/adsb/adsb.service';

@Controller('api')
export class FlightController {
  constructor(
    private readonly flightService: FlightService,
    private readonly adsb: AdsbService,
  ) {}

  @Get('aircraft')
  async aircraft(
    @Query('lat') latRaw: string,
    @Query('lon') lonRaw: string,
    @Query('dist') distRaw?: string,
  ) {
    const lat = Number(latRaw), lon = Number(lonRaw), dist = Number(distRaw ?? 50);
    if (!Number.isFinite(lat) || lat < -90 || lat > 90) throw new BadRequestException('lat must be a valid number');
    if (!Number.isFinite(lon) || lon < -180 || lon > 180) throw new BadRequestException('lon must be a valid number');
    if (!Number.isFinite(dist) || dist < 1 || dist > 100_000) throw new BadRequestException('dist must be a valid number');
    return this.adsb.aircraftNear(lat, lon, dist);
  }

  @Get('flight/history')
  async flightHistory(
    @Query('number') number: string,
    @Query('days') daysRaw?: string,
  ) {
    if (!number?.trim()) throw new BadRequestException('number is required');
    const days = Math.min(14, Math.max(1, Number(daysRaw) || 7));
    return this.flightService.flightHistory(number.trim(), days);
  }

  @Get('flight')
  async flight(
    @Query('callsign') rawCallsign: string,
    @Query('hex') rawHex: string,
    @Query('lat') latRaw: string,
    @Query('lon') lonRaw: string,
    @Query('gs') gsRaw: string,
    @Query('ground') groundRaw: string,
    @Query('type') typeRaw: string,
  ) {
    const callsign = rawCallsign?.toUpperCase().replace(/[^A-Z0-9]/g, '') || null;
    const hex = rawHex?.trim().toLowerCase() || null;
    if (!callsign && !hex) throw new BadRequestException('callsign or hex is required');
    if ((callsign && !/^[A-Z0-9]{2,8}$/.test(callsign)) || (hex && !/^~?[0-9a-f]{6}$/.test(hex))) {
      throw new BadRequestException('invalid callsign or hex');
    }
    const lat = Number(latRaw), lon = Number(lonRaw);
    const live = Number.isFinite(lat) && Number.isFinite(lon) ? {
      lat, lon,
      groundSpeed: Number.isFinite(Number(gsRaw)) ? Number(gsRaw) : null,
      onGround: groundRaw === '1',
      type: typeRaw?.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 4) || null,
    } : null;
    return this.flightService.lookupAircraft({ hex, callsign, live });
  }
}
