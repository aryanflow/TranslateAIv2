import Redis from 'ioredis';
import { Queue, Worker } from 'bullmq';
import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { TranslationOrchestratorService } from '../translation/translation-orchestrator.service';
import {
  attachRedisSocketGuards,
  redisConnectionOptions,
} from '../common/redis/ioredis-helpers';

export const TRANSLATE_QUEUE_NAME = 'translate-job';

function newRedis(config: ConfigService, logger: Logger, label: string): Redis {
  const url = config.get<string>('REDIS_URL', 'redis://127.0.0.1:6379');
  const redis = new Redis(url, redisConnectionOptions());
  attachRedisSocketGuards(redis, logger, label);
  return redis;
}

@Injectable()
export class TranslateWorkerService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(TranslateWorkerService.name);
  private worker?: Worker;

  constructor(
    private readonly config: ConfigService,
    private readonly orchestrator: TranslationOrchestratorService,
  ) {}

  onModuleInit(): void {
    if (this.config.get<string>('DISABLE_TRANSLATE_WORKER', '') === 'true') {
      this.logger.warn(
        'Translate worker disabled (DISABLE_TRANSLATE_WORKER=true)',
      );
      return;
    }

    const connection = newRedis(this.config, this.logger, 'TranslateWorker');

    this.worker = new Worker<{ jobId: string }>(
      TRANSLATE_QUEUE_NAME,
      async (bullJob) => {
        const { jobId } = bullJob.data;
        await this.orchestrator.run(jobId);
      },
      {
        connection,
        concurrency: Number(
          this.config.get<string>('TRANSLATE_WORKER_CONCURRENCY', '1'),
        ),
      },
    );

    this.worker.on('failed', (job, err) => {
      this.logger.error(`Job ${job?.id} failed: ${err?.message}`);
    });
  }

  async onModuleDestroy(): Promise<void> {
    await this.worker?.close();
  }
}

@Injectable()
export class TranslateQueueService implements OnModuleDestroy {
  private readonly logger = new Logger(TranslateQueueService.name);
  private queue?: Queue<{ jobId: string }>;
  private redis?: Redis;

  constructor(private readonly config: ConfigService) {}

  getQueue(): Queue<{ jobId: string }> {
    if (!this.queue) {
      this.redis = newRedis(this.config, this.logger, 'TranslateQueue');
      this.queue = new Queue<{ jobId: string }>(TRANSLATE_QUEUE_NAME, {
        connection: this.redis,
      });
    }
    return this.queue;
  }

  async enqueue(jobId: string): Promise<void> {
    await this.getQueue().add(
      'run',
      { jobId },
      {
        jobId,
        removeOnComplete: true,
        removeOnFail: false,
      },
    );
  }

  /** Remove a job still waiting in Redis (not yet active). Returns whether it was removed. */
  async removeWaitingJob(jobId: string): Promise<boolean> {
    const queue = this.getQueue();
    const bullJob = await queue.getJob(jobId);
    if (!bullJob) return false;
    const state = await bullJob.getState();
    if (state === 'waiting' || state === 'delayed') {
      await bullJob.remove();
      return true;
    }
    return false;
  }

  async onModuleDestroy(): Promise<void> {
    await this.queue?.close();
    await this.redis?.quit();
  }
}
