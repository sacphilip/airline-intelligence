import { Module } from '@nestjs/common';
import { AnalyticsController } from './analytics.controller';
import { MovementModule } from '../movement/movement.module';

@Module({ imports: [MovementModule], controllers: [AnalyticsController] })
export class AnalyticsModule {}
