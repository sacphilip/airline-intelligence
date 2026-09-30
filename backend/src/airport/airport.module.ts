import { Module } from '@nestjs/common';
import { AirportController } from './airport.controller';
import { AirportService } from './airport.service';
import { AeroDataBoxModule } from '../sources/aerodatabox/aerodatabox.module';
import { MovementModule } from '../movement/movement.module';

@Module({
  imports: [AeroDataBoxModule, MovementModule],
  controllers: [AirportController],
  providers: [AirportService],
  exports: [AirportService],
})
export class AirportModule {}
