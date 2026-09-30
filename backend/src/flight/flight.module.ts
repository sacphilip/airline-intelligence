import { Module } from '@nestjs/common';
import { FlightController } from './flight.controller';
import { FlightService } from './flight.service';
import { AdsbModule } from '../sources/adsb/adsb.module';
import { AeroDataBoxModule } from '../sources/aerodatabox/aerodatabox.module';
import { AirlinesModule } from '../sources/airlines/airlines.module';
import { MovementModule } from '../movement/movement.module';
import { PredictionModule } from '../prediction/prediction.module';

@Module({
  imports: [AdsbModule, AeroDataBoxModule, AirlinesModule, MovementModule, PredictionModule],
  controllers: [FlightController],
  providers: [FlightService],
  exports: [FlightService],
})
export class FlightModule {}
