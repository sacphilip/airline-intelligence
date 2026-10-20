import { Controller, Get, Query, BadRequestException, NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import { RouteService, parseFlightNumber } from './route.service';
import { AeroDataBoxService } from '../sources/aerodatabox/aerodatabox.service';

function airportParam(code: string | undefined, msg: string) {
  const c = code?.trim().toUpperCase() ?? '';
  if (!/^[A-Z0-9]{3,4}$/.test(c)) throw new BadRequestException(msg);
  return c;
}

function dateParam(date: string | undefined, required = false) {
  if (!date && !required) return null;
  if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date) || Number.isNaN(Date.parse(`${date}T00:00Z`))) {
    throw new BadRequestException('Enter a valid date');
  }
  return date;
}

@Controller('api')
export class RouteController {
  constructor(
    private readonly routeService: RouteService,
    private readonly adb: AeroDataBoxService,
  ) {}

  @Get('search')
  async search(@Query('number') number: string, @Query('date') date: string) {
    const flight = parseFlightNumber(number);
    if (!flight) throw new BadRequestException('Enter a flight number like 6E 5321 or BA 117: the airline code followed by up to 4 digits');
    const result = await this.routeService.searchFlight(flight, dateParam(date));
    if (!result.legs.length) throw new NotFoundException(`No flight found for ${flight.display}`, flight.display);
    return result;
  }

  // US-009: route reliability overall and per airline, from recorded history (works without an AeroDataBox key).
  @Get('route/analytics')
  async routeAnalytics(@Query('from') from: string, @Query('to') to: string) {
    const msg = 'Enter 3-letter IATA or 4-letter ICAO codes for both airports, e.g. BLR and DEL';
    const fromCode = airportParam(from, msg);
    const toCode = airportParam(to, msg);
    if (fromCode === toCode) throw new BadRequestException('Departure and arrival airports must be different');
    return this.routeService.routeAnalytics(fromCode, toCode);
  }

  @Get('route')
  async route(@Query('from') from: string, @Query('to') to: string, @Query('date') date: string) {
    const msg = 'Enter 3-letter IATA or 4-letter ICAO codes for both airports, e.g. BLR and DEL';
    const fromCode = airportParam(from, msg);
    const toCode = airportParam(to, msg);
    if (fromCode === toCode) throw new BadRequestException('Departure and arrival airports must be different');
    const d = dateParam(date, true)!;
    if (!this.adb.isConfigured()) throw new ServiceUnavailableException('Route search needs an AeroDataBox key', 'needsKey');
    return this.routeService.searchRoute(fromCode, toCode, d);
  }
}
