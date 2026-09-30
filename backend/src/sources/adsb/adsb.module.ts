import { Module } from '@nestjs/common';
import { AdsbService } from './adsb.service';

@Module({ providers: [AdsbService], exports: [AdsbService] })
export class AdsbModule {}
