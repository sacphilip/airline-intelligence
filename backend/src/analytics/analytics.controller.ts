import { Controller, Get } from '@nestjs/common';
import { MovementRepository } from '../movement/movement.repository';

@Controller('api')
export class AnalyticsController {
  constructor(private readonly movements: MovementRepository) {}

  @Get('history')
  async history() {
    return this.movements.summary();
  }
}
