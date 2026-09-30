import { Module } from '@nestjs/common';
import { AirlineController } from './airline.controller';
import { AirlinesModule } from '../sources/airlines/airlines.module';

@Module({ imports: [AirlinesModule], controllers: [AirlineController] })
export class AirlineModule {}
