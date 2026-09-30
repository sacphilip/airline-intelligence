import { Controller, Get } from '@nestjs/common';
import { AirlinesService } from '../sources/airlines/airlines.service';

@Controller('api')
export class AirlineController {
  constructor(private readonly airlines: AirlinesService) {}

  @Get('airlines')
  async airlineNames() {
    return this.airlines.airlineNames();
  }
}
