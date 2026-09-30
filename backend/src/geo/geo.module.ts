import { Module } from '@nestjs/common';
import { GeoController } from './geo.controller';
import { GeocodeModule } from '../sources/geocode/geocode.module';

@Module({ imports: [GeocodeModule], controllers: [GeoController] })
export class GeoModule {}
