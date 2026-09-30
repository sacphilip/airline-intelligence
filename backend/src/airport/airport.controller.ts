import { Controller, Get, Query, BadRequestException, ServiceUnavailableException } from '@nestjs/common';
import { AirportService } from './airport.service';
import { AeroDataBoxService } from '../sources/aerodatabox/aerodatabox.service';

@Controller('api')
export class AirportController {
  constructor(
    private readonly airportService: AirportService,
    private readonly adb: AeroDataBoxService,
  ) {}

  @Get('delays')
  async delays(@Query('airport') airport: string) {
    const code = airport?.trim().toUpperCase() ?? '';
    if (!/^[A-Z0-9]{3,4}$/.test(code)) throw new BadRequestException('Enter a 3-letter IATA or 4-letter ICAO airport code');
    if (!this.adb.isConfigured()) throw new ServiceUnavailableException('Delay data needs an AeroDataBox key', 'needsKey');
    return this.airportService.airportDelays(code);
  }
}
