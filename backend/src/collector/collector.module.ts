import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bull';
import { CollectorProcessor, COLLECTOR_QUEUE } from './collector.processor';
import { AirportModule } from '../airport/airport.module';
import { AeroDataBoxModule } from '../sources/aerodatabox/aerodatabox.module';

@Module({
  imports: [
    BullModule.registerQueue({ name: COLLECTOR_QUEUE }),
    AirportModule,
    AeroDataBoxModule,
  ],
  providers: [CollectorProcessor],
})
export class CollectorModule {}
