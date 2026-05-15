import { Injectable, NotFoundException } from '@nestjs/common';
import {
  createJobBodySchema,
  type CreateJobBody,
} from '@aptos-translate/contracts';
import { PrismaService } from '../common/prisma/prisma.service';
import { TranslateQueueService } from './translate-queue.service';

@Injectable()
export class JobsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly translateQueue: TranslateQueueService,
  ) {}

  async createJob(tenantId: string, body: CreateJobBody) {
    const parsed = createJobBodySchema.parse(body);
    const job = await this.prisma.job.create({
      data: {
        tenantId,
        fileKey: parsed.fileKey,
        sourceLang: parsed.sourceLang,
        targetLangs: parsed.targetLangs,
        batchSize: parsed.batchSize,
        minTranslationScore: parsed.minTranslationScore,
        maxBatchRetries: parsed.maxBatchRetries,
        status: 'pending',
      },
    });
    await this.translateQueue.enqueue(job.id);
    return { jobId: job.id, status: job.status };
  }

  async getJob(tenantId: string, jobId: string) {
    const job = await this.prisma.job.findFirst({
      where: { id: jobId, tenantId },
    });
    if (!job) {
      throw new NotFoundException();
    }
    return {
      id: job.id,
      status: job.status,
      progress: job.progress,
      targetLangs: job.targetLangs,
      perTargetProgress: Object.fromEntries(
        job.targetLangs.map((l) => [l, job.progress]),
      ),
      failureSummary: null as null | { code: string; count: number }[],
      scoreHistogram: { underThreshold: 0, ok: 0 },
    };
  }

  async getResult(tenantId: string, jobId: string) {
    const job = await this.prisma.job.findFirst({
      where: { id: jobId, tenantId },
    });
    if (!job) {
      throw new NotFoundException();
    }
    return {
      jobId: job.id,
      tenantId: job.tenantId,
      translatedFileUrls: job.resultUrls,
      reportUrl: null as string | null,
      qualitySummary: {
        averageJudgeScore: null as null | number,
        batchesRetried: 0,
      },
    };
  }

  async getBatch(tenantId: string, jobId: string, batchId: string) {
    const batch = await this.prisma.jobBatch.findFirst({
      where: { id: batchId, jobId, tenantId },
    });
    if (!batch) {
      throw new NotFoundException();
    }
    return {
      id: batch.id,
      jobId: batch.jobId,
      batchIndex: batch.batchIndex,
      lastErrorCode: batch.lastErrorCode,
      attempt: batch.attempt,
      judgeScore: batch.judgeScore,
      note: 'Support / diagnostics: why retries fired',
    };
  }
}
