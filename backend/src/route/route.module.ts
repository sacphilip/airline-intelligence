import { Module } from '@nestjs/common';
import { RouteController } from './route.controller';
import { RouteService } from './route.service';
import { AdsbModule } from '../sources/adsb/adsb.module';
import { AeroDataBoxModule } from '../sources/aerodatabox/aerodatabox.module';
import { AirlinesModule } from '../sources/airlines/airlines.module';
import { MovementModule } from '../movement/movement.module';

@Module({
  imports: [AdsbModule, AeroDataBoxModule, AirlinesModule, MovementModule],
  controllers: [RouteController],
  providers: [RouteService],
  exports: [RouteService],
})
export class RouteModule {}
