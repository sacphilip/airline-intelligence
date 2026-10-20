import { Controller, Get, Query, BadRequestException } from '@nestjs/common';
import { AirlinesService } from '../sources/airlines/airlines.service';
import { MovementRepository } from '../movement/movement.repository';

@Controller('api')
export class AirlineController {
  constructor(
    private readonly airlines: AirlinesService,
    private readonly movements: MovementRepository,
  ) {}

  @Get('airlines')
  async airlineNames() {
    return this.airlines.airlineNames();
  }

  @Get('airline/profile')
  async airlineProfile(@Query('iata') iata: string) {
    if (!iata?.trim()) throw new BadRequestException('iata is required');
    const code = iata.trim().toUpperCase();
    if (!/^[A-Z0-9]{2,3}$/.test(code)) throw new BadRequestException('invalid IATA code');

    const icaos = await this.airlines.icaoCodesForIata(code);
    const airline = icaos.length ? await this.airlines.lookupAirline(icaos[0]) : null;
    const profile = await this.movements.airlineProfile(code);

    return { iata: code, airline, ...profile };
  }

  @Get('airline/rankings')
  async airlineRankings() {
    return this.movements.airlineRankings();
  }

  @Get('airline/trend')
  async airlineTrend(
    @Query('iata') iata: string,
    @Query('months') monthsRaw?: string,
  ) {
    if (!iata?.trim()) throw new BadRequestException('iata is required');
    const code = iata.trim().toUpperCase();
    if (!/^[A-Z0-9]{2,3}$/.test(code)) throw new BadRequestException('invalid IATA code');
    const months = Math.min(24, Math.max(1, Number(monthsRaw) || 9));
    return this.movements.airlineTrend(code, months);
  }
}
