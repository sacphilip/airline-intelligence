import { Module } from '@nestjs/common';
import { AirlineController } from './airline.controller';
import { AirlinesModule } from '../sources/airlines/airlines.module';
import { MovementModule } from '../movement/movement.module';

@Module({ imports: [AirlinesModule, MovementModule], controllers: [AirlineController] })
export class AirlineModule {}
