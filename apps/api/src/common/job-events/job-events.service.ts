import Redis from 'ioredis';
import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  attachRedisSocketGuards,
  redisConnectionOptions,
} from '../redis/ioredis-helpers';

/** Redis pub/sub for SSE job progress (phase/batch %). */
@Injectable()
export class JobEventsService implements OnModuleDestroy {
  private readonly logger = new Logger(JobEventsService.name);
  private readonly pub: Redis;

  constructor(private readonly config: ConfigService) {
    const url = this.config.get<string>('REDIS_URL', 'redis://127.0.0.1:6379');
    this.pub = new Redis(url, redisConnectionOptions());
    attachRedisSocketGuards(this.pub, this.logger, 'JobEvents-pub');
  }

  async publish(
    jobId: string,
    payload: Record<string, unknown>,
  ): Promise<void> {
    try {
      await this.pub.publish(
        `job:${jobId}`,
        JSON.stringify({ jobId, ...payload }),
      );
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      this.logger.warn(`Redis publish failed for job ${jobId}: ${msg}`);
    }
  }

  subscribeToJob(jobId: string, onMessage: (data: string) => void): Redis {
    const url = this.config.get<string>('REDIS_URL', 'redis://127.0.0.1:6379');
    const sub = new Redis(url, redisConnectionOptions());
    attachRedisSocketGuards(sub, this.logger, 'JobEvents-sub');
    void sub.subscribe(`job:${jobId}`, (err) => {
      if (err) {
        this.logger.error(`Redis subscribe failed for job ${jobId}: ${err.message}`);
      }
    });
    sub.on('message', (_ch, message) => {
      onMessage(message);
    });
    return sub;
  }

  async onModuleDestroy(): Promise<void> {
    await this.pub.quit().catch(() => undefined);
  }
}
