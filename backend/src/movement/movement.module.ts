import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Movement } from './movement.entity';
import { MovementRepository } from './movement.repository';

@Module({
  imports: [TypeOrmModule.forFeature([Movement])],
  providers: [MovementRepository],
  exports: [MovementRepository],
})
export class MovementModule {}
