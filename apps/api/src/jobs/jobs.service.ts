import {
  HttpException,
  HttpStatus,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import {
  createJobBodySchema,
  type CreateJobBody,
} from '@aptos-translate/contracts';
import { PrismaService } from '../common/prisma/prisma.service';
import { JobEventsService } from '../common/job-events/job-events.service';
import { TranslateQueueService } from './translate-queue.service';

@Injectable()
export class JobsService {
  private readonly logger = new Logger(JobsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly translateQueue: TranslateQueueService,
    private readonly jobEvents: JobEventsService,
  ) {}

  /** DB missing `ALTER TYPE "JobStatus" ADD VALUE 'cancelled'` while Prisma client expects it. */
  private isLikelyMissingCancelledEnum(err: unknown): boolean {
    const msg = err instanceof Error ? err.message : String(err);
    return (
      /invalid input value for enum/i.test(msg) &&
      (/JobStatus/i.test(msg) || /"cancelled"/i.test(msg))
    );
  }

  private judgeThresholdFields(job: { minTranslationScore: number | null }) {
    const threshold01 = job.minTranslationScore ?? 0.7;
    const threshold10 = threshold01 <= 1 ? threshold01 * 10 : threshold01;
    return {
      minTranslationScoreStored: job.minTranslationScore,
      judgePassScoreMin01: threshold01,
      judgePassScoreMin10: threshold10,
    };
  }

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
        extractOptions: parsed.extractOptions ?? undefined,
        status: 'pending',
      },
    });
    await this.translateQueue.enqueue(job.id);
    return { jobId: job.id, status: job.status };
  }

  async cancelJob(tenantId: string, jobId: string) {
    const job = await this.prisma.job.findFirst({
      where: { id: jobId, tenantId },
    });
    if (!job) {
      throw new NotFoundException();
    }
    if (
      job.status === 'completed' ||
      job.status === 'failed' ||
      job.status === 'cancelled'
    ) {
      return { ok: true as const, status: job.status, alreadyTerminal: true };
    }

    try {
      await this.prisma.job.update({
        where: { id: jobId },
        data: {
          status: 'cancelled',
          errorMessage: 'Cancelled by user',
        },
      });
    } catch (e) {
      if (this.isLikelyMissingCancelledEnum(e)) {
        throw new HttpException(
          {
            statusCode: HttpStatus.FAILED_DEPENDENCY,
            message:
              "Cannot cancel: the database JobStatus enum does not include 'cancelled'. From apps/api run: pnpm exec prisma migrate deploy (or prisma db push in dev), then retry.",
            error: 'Failed Dependency',
          },
          HttpStatus.FAILED_DEPENDENCY,
        );
      }
      throw e;
    }

    let removedFromQueue = false;
    try {
      removedFromQueue = await this.translateQueue.removeWaitingJob(jobId);
    } catch (e) {
      this.logger.warn(
        `removeWaitingJob failed for ${jobId}: ${e instanceof Error ? e.message : String(e)}`,
      );
    }

    try {
      await this.jobEvents.publish(jobId, {
        phase: 'cancelled',
        percent: Math.round(job.progress),
      });
    } catch (e) {
      this.logger.warn(
        `jobEvents.publish(cancelled) failed for ${jobId}: ${e instanceof Error ? e.message : String(e)}`,
      );
    }

    return {
      ok: true as const,
      status: 'cancelled' as const,
      removedFromQueue,
    };
  }

  async getJob(tenantId: string, jobId: string) {
    const job = await this.prisma.job.findFirst({
      where: { id: jobId, tenantId },
      include: {
        _count: {
          select: { batches: true },
        },
      },
    });
    if (!job) {
      throw new NotFoundException();
    }
    const retriedBatchCount = await this.prisma.jobBatch.count({
      where: { jobId: job.id, attempt: { gt: 1 } },
    });
    const uploadFileLabel = job.fileKey.split('/').pop() ?? job.fileKey;
    return {
      id: job.id,
      status: job.status,
      progress: job.progress,
      sourceLang: job.sourceLang,
      targetLangs: job.targetLangs,
      stringsTotal: job.stringsTotal,
      batchTotal: job.batchTotal,
      batchesCompleted: job._count.batches,
      batchSize: job.batchSize,
      fileKey: job.fileKey,
      uploadFileLabel,
      retriedBatchCount,
      perTargetProgress: Object.fromEntries(
        job.targetLangs.map((l) => [l, job.progress]),
      ),
      failureSummary: null as null | { code: string; count: number }[],
      scoreHistogram: { underThreshold: 0, ok: 0 },
      createdAt: job.createdAt.toISOString(),
      updatedAt: job.updatedAt.toISOString(),
      errorMessage: job.errorMessage,
      resultUrls: job.resultUrls,
      ...this.judgeThresholdFields(job),
    };
  }

  async listJobs(tenantId: string, take = 40) {
    const jobs = await this.prisma.job.findMany({
      where: { tenantId },
      orderBy: { createdAt: 'desc' },
      take,
      include: {
        _count: {
          select: { batches: true },
        },
      },
    });
    return {
      jobs: jobs.map((job) => {
        const uploadFileLabel = job.fileKey.split('/').pop() ?? job.fileKey;
        return {
          id: job.id,
          status: job.status,
          progress: job.progress,
          sourceLang: job.sourceLang,
          targetLangs: job.targetLangs,
          batchSize: job.batchSize,
          stringsTotal: job.stringsTotal,
          batchTotal: job.batchTotal,
          batchesCompleted: job._count.batches,
          fileKey: job.fileKey,
          uploadFileLabel,
          createdAt: job.createdAt.toISOString(),
          updatedAt: job.updatedAt.toISOString(),
          errorMessage: job.errorMessage,
          resultUrls: job.resultUrls,
          ...this.judgeThresholdFields(job),
        };
      }),
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
