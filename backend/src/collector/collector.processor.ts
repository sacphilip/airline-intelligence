import { Processor, Process, InjectQueue } from '@nestjs/bull';
import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Queue, Job } from 'bull';
import { AirportService } from '../airport/airport.service';
import { AeroDataBoxService } from '../sources/aerodatabox/aerodatabox.service';

export const COLLECTOR_QUEUE = 'collector';
export const COLLECT_JOB = 'collect-airports';

@Injectable()
@Processor(COLLECTOR_QUEUE)
export class CollectorProcessor implements OnModuleInit {
  private readonly logger = new Logger(CollectorProcessor.name);
  private readonly airports: string[];
  private readonly intervalHours: number;

  constructor(
    @InjectQueue(COLLECTOR_QUEUE) private readonly queue: Queue,
    private readonly airportService: AirportService,
    private readonly adb: AeroDataBoxService,
    private readonly cfg: ConfigService,
  ) {
    this.airports = (cfg.get('COLLECT_AIRPORTS', ''))
      .split(',').map((s: string) => s.trim().toUpperCase()).filter((s: string) => /^[A-Z0-9]{3,4}$/.test(s));
    this.intervalHours = Math.max(1, Number(cfg.get('COLLECT_INTERVAL_HOURS', 12)));
  }

  async onModuleInit() {
    if (!this.airports.length) return;
    if (!this.adb.isConfigured()) {
      this.logger.warn('COLLECT_AIRPORTS is set but AERODATABOX_KEY is not; not collecting history');
      return;
    }
    // Remove stale repeating jobs and create a fresh one.
    await this.queue.removeRepeatable(COLLECT_JOB, { every: this.intervalHours * 3_600_000 });
    await this.queue.add(COLLECT_JOB, { airports: this.airports }, {
      repeat: { every: this.intervalHours * 3_600_000 },
      removeOnComplete: true,
    });
    // Run once immediately on startup.
    await this.queue.add(COLLECT_JOB, { airports: this.airports }, { removeOnComplete: true });
    this.logger.log(`Collecting ${this.airports.join(', ')} every ${this.intervalHours}h`);
  }

  @Process(COLLECT_JOB)
  async handleCollect(job: Job<{ airports: string[] }>) {
    for (const code of job.data.airports) {
      try {
        const flights = await this.airportService.fetchBoard(code, { offsetMinutes: -720, durationMinutes: 720 });
        this.logger.log(`history: recorded ${flights.length} movements at ${code}`);
      } catch (err: any) {
        this.logger.warn(`history: ${code} failed: ${err.message}`);
      }
      await new Promise(r => setTimeout(r, 1500)); // free plan: ~1 req/s
    }
  }
}
