import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { CacheModule } from '@nestjs/cache-manager';
import { BullModule } from '@nestjs/bull';
import { EventEmitterModule } from '@nestjs/event-emitter';
import { redisStore } from 'cache-manager-ioredis-yet';

import { Movement } from './movement/movement.entity';
import { User } from './auth/user.entity';
import { UserIdentity } from './auth/oauth/user-identity.entity';
import { AuthModule } from './auth/auth.module';
import { MovementModule } from './movement/movement.module';
import { AdsbModule } from './sources/adsb/adsb.module';
import { AeroDataBoxModule } from './sources/aerodatabox/aerodatabox.module';
import { AirlinesModule } from './sources/airlines/airlines.module';
import { WeatherModule } from './sources/weather/weather.module';
import { GeocodeModule } from './sources/geocode/geocode.module';
import { FlightModule } from './flight/flight.module';
import { AirlineModule } from './airline/airline.module';
import { RouteModule } from './route/route.module';
import { AirportModule } from './airport/airport.module';
import { AnalyticsModule } from './analytics/analytics.module';
import { GeoModule } from './geo/geo.module';
import { CollectorModule } from './collector/collector.module';
import { PredictionModule } from './prediction/prediction.module';
import { HealthModule } from './health/health.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),

    TypeOrmModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (cfg: ConfigService) => ({
        type: 'postgres',
        url: cfg.get('DATABASE_URL', 'postgresql://flight_tracker:flight_tracker@localhost:5432/flight_tracker'),
        entities: [Movement, User, UserIdentity],
        synchronize: true, // use migrations in production
        logging: cfg.get('DB_LOGGING') === 'true',
      }),
    }),

    CacheModule.registerAsync({
      isGlobal: true,
      inject: [ConfigService],
      useFactory: async (cfg: ConfigService) => ({
        store: await redisStore({
          host: cfg.get('REDIS_HOST', 'localhost'),
          port: Number(cfg.get('REDIS_PORT', 6379)),
        }),
      }),
    }),

    BullModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (cfg: ConfigService) => ({
        redis: {
          host: cfg.get('REDIS_HOST', 'localhost'),
          port: Number(cfg.get('REDIS_PORT', 6379)),
        },
      }),
    }),

    EventEmitterModule.forRoot(),

    AuthModule,
    MovementModule,
    AdsbModule,
    AeroDataBoxModule,
    AirlinesModule,
    WeatherModule,
    GeocodeModule,
    PredictionModule,
    FlightModule,
    AirlineModule,
    RouteModule,
    AirportModule,
    AnalyticsModule,
    GeoModule,
    CollectorModule,
    HealthModule,
  ],
})
export class AppModule {}
