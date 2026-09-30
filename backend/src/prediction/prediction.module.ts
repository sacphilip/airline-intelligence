import { Module } from '@nestjs/common';
import { PredictionService } from './prediction.service';
import { WeatherModule } from '../sources/weather/weather.module';
import { MovementModule } from '../movement/movement.module';

@Module({
  imports: [WeatherModule, MovementModule],
  providers: [PredictionService],
  exports: [PredictionService],
})
export class PredictionModule {}
