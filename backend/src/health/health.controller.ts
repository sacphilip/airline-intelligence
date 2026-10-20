import { Controller, Get, ServiceUnavailableException } from '@nestjs/common';
import { DataSource } from 'typeorm';

// Readiness check for CI wait loops, smoke tests and container health checks.
// 200 once the app is up and the database answers; 503 if the database is unreachable.
@Controller()
export class HealthController {
  constructor(private readonly db: DataSource) {}

  @Get('health')
  async health() {
    try {
      await this.db.query('SELECT 1');
    } catch {
      throw new ServiceUnavailableException({ status: 'error', database: 'unreachable' });
    }
    return { status: 'ok', database: 'ok', uptimeSeconds: Math.round(process.uptime()) };
  }
}
