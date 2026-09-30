import { Module } from '@nestjs/common';
import { AeroDataBoxService } from './aerodatabox.service';

@Module({ providers: [AeroDataBoxService], exports: [AeroDataBoxService] })
export class AeroDataBoxModule {}
