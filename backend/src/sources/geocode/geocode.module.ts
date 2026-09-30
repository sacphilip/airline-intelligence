import { Module } from '@nestjs/common';
import { GeocodeService } from './geocode.service';

@Module({ providers: [GeocodeService], exports: [GeocodeService] })
export class GeocodeModule {}
