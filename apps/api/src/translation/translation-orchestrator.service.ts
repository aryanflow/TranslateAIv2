import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../common/prisma/prisma.service';
import { JobEventsService } from '../common/job-events/job-events.service';
import { FilesService } from '../files/files.service';
import { ExtractorsService } from '../extractors/extractors.service';
import { RegeneratorsService } from '../regenerators/regenerators.service';
import { TranslationRouterService } from '../llm/translation-router.service';
import { ScoringService } from '../scoring/scoring.service';
import { PromptsService } from '../prompts/prompts.service';

function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) {
    out.push(arr.slice(i, i + size));
  }
  return out;
}

function extForFormat(format: string): string {
  switch (format) {
    case 'xml':
      return 'xml';
    case 'json':
      return 'json';
    case 'csv':
      return 'csv';
    case 'excel':
      return 'xlsx';
    default:
      return 'bin';
  }
}

/** Streams from S3 → extract → batched dual-LLM → regenerate → S3 (see docs/ARCHITECTURE.md). */
@Injectable()
export class TranslationOrchestratorService {
  private readonly logger = new Logger(TranslationOrchestratorService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly files: FilesService,
    private readonly extractors: ExtractorsService,
    private readonly regenerators: RegeneratorsService,
    private readonly translationRouter: TranslationRouterService,
    private readonly scoring: ScoringService,
    private readonly events: JobEventsService,
    private readonly prompts: PromptsService,
  ) {}

  async run(jobId: string): Promise<void> {
    const job = await this.prisma.job.findUnique({
      where: { id: jobId },
      include: { tenant: true },
    });
    if (!job) {
      this.logger.warn(`Job ${jobId} not found`);
      return;
    }

    const threshold01 = job.minTranslationScore ?? 0.7;
    const threshold10 = threshold01 <= 1 ? threshold01 * 10 : threshold01;

    const translatorKind =
      job.tenant.activeTranslator === 'langdock' ? 'langdock' : 'gemini';
    const scorerKind =
      job.tenant.activeScorer === 'gemini' ? 'gemini' : 'langdock';

    const maxRetries = Math.max(1, job.maxBatchRetries ?? 3);
    const batchSize = Math.max(1, job.batchSize);

    try {
      await this.prisma.job.update({
        where: { id: jobId },
        data: { status: 'extracting', progress: 2, errorMessage: null },
      });
      await this.events.publish(jobId, { phase: 'extracting', percent: 2 });

      const buf = await this.files.getObjectBytes(job.fileKey);
      const extracted = this.extractors.extract(buf, job.fileKey, {});

      await this.prisma.job.update({
        where: { id: jobId },
        data: { status: 'chunking', progress: 5 },
      });
      await this.events.publish(jobId, {
        phase: 'chunking',
        stringsTotal: extracted.originals.length,
        percent: 5,
      });

      const batches = chunk(extracted.originals, batchSize);
      const resultUrls: string[] = [];
      let globalBatchIndex = 0;

      for (const targetLang of job.targetLangs) {
        const terms = await this.prisma.termPreference.findMany({
          where: {
            tenantId: job.tenantId,
            sourceLang: job.sourceLang,
            targetLang,
          },
        });
        const glossaryBlock =
          terms.length > 0
            ? `Authoritative glossary (JSON array of {src,tgt}):\n${JSON.stringify(
                terms.map((t) => ({
                  src: t.sourceTerm,
                  tgt: t.preferredTarget,
                })),
              )}`
            : null;

        const tmpl = await this.prompts.getTemplate(
          job.tenantId,
          job.sourceLang,
          targetLang,
        );
        const promptExtra = `Tenant prompt templates (respect alongside structured batch JSON):\nSystem:\n${tmpl.systemText}\nUser template:\n${tmpl.userText}`;
        const additionalContext =
          [glossaryBlock, promptExtra].filter(Boolean).join('\n\n') || null;

        const ordered: string[] = [];
        let offset = 0;

        for (let batchIndex = 0; batchIndex < batches.length; batchIndex++) {
          const batch = batches[batchIndex];
          const tags = extracted.tags.slice(offset, offset + batch.length);
          let attempt = 0;
          let trans: string[] = [];

          while (attempt < maxRetries) {
            attempt += 1;
            const pct =
              5 + (85 * offset) / Math.max(1, extracted.originals.length);

            await this.prisma.job.update({
              where: { id: jobId },
              data: {
                status: attempt === 1 ? 'translating' : 'scoring',
                progress: Math.min(95, pct),
              },
            });
            await this.events.publish(jobId, {
              phase: 'translating',
              stringsDone: offset,
              stringsTotal: extracted.originals.length,
              targetLang,
              batchIndex: globalBatchIndex,
              attempt,
              percent: Math.round(pct),
            });

            trans = await this.translationRouter.translate(
              translatorKind,
              batch,
              targetLang,
              null,
              additionalContext,
            );

            const scored = await this.scoring.score(
              scorerKind,
              batch,
              trans,
              targetLang,
              tags,
            );
            const scores = scored.scores;
            const below = scores.filter((s) => s < threshold10).length;

            await this.prisma.jobBatch.upsert({
              where: {
                jobId_batchIndex: { jobId, batchIndex: globalBatchIndex },
              },
              create: {
                jobId,
                tenantId: job.tenantId,
                batchIndex: globalBatchIndex,
                attempt,
                judgeScore: scores.length
                  ? scores.reduce((a, b) => a + b, 0) / scores.length
                  : null,
                lastErrorCode: below > 0 ? 'SCORE_LOW' : null,
              },
              update: {
                attempt,
                judgeScore: scores.length
                  ? scores.reduce((a, b) => a + b, 0) / scores.length
                  : null,
                lastErrorCode: below > 0 ? 'SCORE_LOW' : null,
              },
            });

            if (below === 0 || attempt >= maxRetries) {
              ordered.push(...trans);
              offset += batch.length;
              globalBatchIndex += 1;
              break;
            }
          }
        }

        const translationMap: Record<string, string> = {};
        for (let i = 0; i < extracted.originals.length; i++) {
          translationMap[extracted.originals[i]] = ordered[i];
        }

        await this.prisma.job.update({
          where: { id: jobId },
          data: { status: 'regenerating', progress: 92 },
        });
        await this.events.publish(jobId, {
          phase: 'regenerating',
          targetLang,
          percent: 92,
        });

        const reg = this.regenerators.regenerate({
          format: extracted.format,
          rawText: extracted.rawText,
          rawBytes: extracted.rawBytes,
          translationMap,
          selectedColumns: extracted.meta.selectedColumns,
          selectedSheet: extracted.meta.selectedSheet,
        });

        const ext = extForFormat(extracted.format);
        const outKey = `results/${job.tenantId}/${jobId}/${targetLang}.${ext}`;
        const bodyBuf =
          typeof reg.body === 'string'
            ? Buffer.from(reg.body, 'utf-8')
            : reg.body;
        await this.files.putObjectBytes(outKey, bodyBuf, reg.contentType);
        resultUrls.push(outKey);
      }

      await this.prisma.job.update({
        where: { id: jobId },
        data: {
          status: 'completed',
          progress: 100,
          resultUrls,
        },
      });
      await this.events.publish(jobId, {
        phase: 'completed',
        percent: 100,
        resultUrls,
      });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      this.logger.error(`Job ${jobId} failed: ${msg}`);
      await this.prisma.job.update({
        where: { id: jobId },
        data: {
          status: 'failed',
          errorMessage: msg,
        },
      });
      await this.events.publish(jobId, { phase: 'failed', error: msg });
    }
  }
}
