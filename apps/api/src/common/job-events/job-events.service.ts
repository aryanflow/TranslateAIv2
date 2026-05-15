import Redis from 'ioredis';
import { Injectable, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

/** Redis pub/sub for SSE job progress (phase/batch %). */
@Injectable()
export class JobEventsService implements OnModuleDestroy {
  private readonly pub: Redis;

  constructor(private readonly config: ConfigService) {
    const url = this.config.get<string>('REDIS_URL', 'redis://127.0.0.1:6379');
    this.pub = new Redis(url, { maxRetriesPerRequest: null });
  }

  async publish(
    jobId: string,
    payload: Record<string, unknown>,
  ): Promise<void> {
    await this.pub.publish(
      `job:${jobId}`,
      JSON.stringify({ jobId, ...payload }),
    );
  }

  subscribeToJob(jobId: string, onMessage: (data: string) => void): Redis {
    const url = this.config.get<string>('REDIS_URL', 'redis://127.0.0.1:6379');
    const sub = new Redis(url, { maxRetriesPerRequest: null });
    void sub.subscribe(`job:${jobId}`, (err) => {
      if (err) throw err;
    });
    sub.on('message', (_ch, message) => {
      onMessage(message);
    });
    return sub;
  }

  async onModuleDestroy(): Promise<void> {
    await this.pub.quit();
  }
}
