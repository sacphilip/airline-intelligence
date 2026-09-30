import { Module } from '@nestjs/common';
import { AirlinesService } from './airlines.service';

@Module({ providers: [AirlinesService], exports: [AirlinesService] })
export class AirlinesModule {}
