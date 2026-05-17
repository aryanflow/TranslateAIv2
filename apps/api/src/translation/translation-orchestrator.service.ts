import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../common/prisma/prisma.service';
import { JobEventsService } from '../common/job-events/job-events.service';
import { FilesService } from '../files/files.service';
import { ExtractorsService } from '../extractors/extractors.service';
import { RegeneratorsService } from '../regenerators/regenerators.service';
import { TranslationRouterService } from '../llm/translation-router.service';
import type { TranslatorKind } from '../llm/translation-router.service';
import { ScoringService } from '../scoring/scoring.service';
import type { ScorerKind } from '../scoring/scoring.service';
import { PromptsService } from '../prompts/prompts.service';
import { LANG_CONFIG } from '../config/lang-config';
import {
  DEFAULT_BEDROCK_SCORING_MODEL_ID,
  DEFAULT_BEDROCK_TRANSLATION_MODEL_ID,
} from '../config/bedrock-defaults';
import {
  substitutePromptVars,
  formatTerminologyReferenceBlock,
} from '../llm/prompt-builder';

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

function csvEscapeField(value: string | number | boolean): string {
  const s = String(value);
  if (/[",\r\n]/.test(s)) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

function qaRowsToReviewCsv(
  rows: readonly {
    string_id: number;
    source_path: string;
    original: string;
    translation: string;
    reviewer_score_0_to_10: number;
    reviewer_notes: string;
    meets_accuracy_threshold: boolean;
  }[],
): string {
  const headers = [
    'string_id',
    'source_path',
    'original',
    'translated',
    'reviewer_score_0_to_10',
    'reviewer_feedback',
    'meets_accuracy_threshold',
  ];
  const lines = [
    headers.join(','),
    ...rows.map((r) =>
      [
        csvEscapeField(r.string_id),
        csvEscapeField(r.source_path),
        csvEscapeField(r.original),
        csvEscapeField(r.translation),
        csvEscapeField(r.reviewer_score_0_to_10),
        csvEscapeField(r.reviewer_notes),
        csvEscapeField(r.meets_accuracy_threshold),
      ].join(','),
    ),
  ];
  return `\ufeff${lines.join('\n')}`;
}

function normalizeTranslatorId(raw: string): TranslatorKind {
  if (raw === 'gemini' || raw === 'langdock') return raw;
  return 'bedrock';
}

function normalizeScorerId(raw: string): ScorerKind {
  if (raw === 'gemini' || raw === 'langdock') return raw;
  return 'bedrock';
}

/** Streams from S3 → extract → batched dual-LLM → regenerate → S3 (see docs/ARCHITECTURE.md). */
@Injectable()
export class TranslationOrchestratorService {
  private readonly logger = new Logger(TranslationOrchestratorService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
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

    const translatorKind = normalizeTranslatorId(job.tenant.activeTranslator);
    const scorerKind = normalizeScorerId(job.tenant.activeScorer);

    const maxRetries = Math.max(1, job.maxBatchRetries ?? 3);
    const batchSize = Math.max(1, job.batchSize);

    const translatorModelId =
      this.config.get<string>('BEDROCK_TRANSLATION_MODEL_ID') ??
      this.config.get<string>('BEDROCK_MODEL_ID') ??
      DEFAULT_BEDROCK_TRANSLATION_MODEL_ID;
    const reviewerModelId =
      this.config.get<string>('BEDROCK_SCORING_MODEL_ID') ??
      DEFAULT_BEDROCK_SCORING_MODEL_ID;

    try {
      await this.prisma.job.update({
        where: { id: jobId },
        data: { status: 'extracting', progress: 2, errorMessage: null },
      });
      await this.events.publish(jobId, { phase: 'extracting', percent: 2 });

      const buf = await this.files.getObjectBytes(job.fileKey);
      const extracted = this.extractors.extract(buf, job.fileKey, {});
      const batches = chunk(extracted.originals, batchSize);

      await this.prisma.job.update({
        where: { id: jobId },
        data: {
          status: 'chunking',
          progress: 5,
          stringsTotal: extracted.originals.length,
          batchTotal: batches.length * job.targetLangs.length,
        },
      });
      await this.events.publish(jobId, {
        phase: 'chunking',
        stringsTotal: extracted.originals.length,
        percent: 5,
      });
      const resultUrls: string[] = [];
      let globalBatchIndex = 0;

      for (const targetLang of job.targetLangs) {
        type QaRow = {
          string_id: number;
          source_path: string;
          original: string;
          translation: string;
          reviewer_score_0_to_10: number;
          reviewer_notes: string;
          meets_accuracy_threshold: boolean;
        };
        const qaRows: QaRow[] = [];

        const langCfg = LANG_CONFIG[targetLang];
        if (!langCfg) {
          throw new Error(
            `Unsupported target language code "${targetLang}". Configure LANG_CONFIG.`,
          );
        }

        const terms = await this.prisma.termPreference.findMany({
          where: {
            tenantId: job.tenantId,
            sourceLang: job.sourceLang,
            targetLang,
          },
        });
        const glossaryBlock =
          terms.length > 0
            ? JSON.stringify(
                terms.map((t) => ({
                  src: t.sourceTerm,
                  tgt: t.preferredTarget,
                })),
              )
            : '[]';

        const tmpl = await this.prompts.getTemplate(
          job.tenantId,
          job.sourceLang,
          targetLang,
        );
        const terminologyReference = formatTerminologyReferenceBlock(langCfg);
        const userTemplateFilled = substitutePromptVars(tmpl.userText, {
          glossary_block: glossaryBlock,
          terminology_reference: terminologyReference,
          source_lang: job.sourceLang,
          target_lang: targetLang,
          target_language_name: langCfg.name,
        });

        const sourceCfg = LANG_CONFIG[job.sourceLang];

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
              {
                administratorSystemPrompt: tmpl.systemText,
                administratorUserTemplate: userTemplateFilled,
                batchSourceLang: job.sourceLang,
                batchSourceLangDisplayName:
                  sourceCfg?.name ?? job.sourceLang,
                batchStringIds: extracted.stringIds.slice(
                  offset,
                  offset + batch.length,
                ),
              },
            );

            const scored = await this.scoring.score(
              scorerKind,
              batch,
              trans,
              targetLang,
              tags,
              {
                stringIds: extracted.stringIds.slice(
                  offset,
                  offset + batch.length,
                ),
              },
            );
            const scores = scored.scores;
            const feedback = scored.feedback;
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
              const sliceIds = extracted.stringIds.slice(
                offset,
                offset + batch.length,
              );
              for (let bi = 0; bi < batch.length; bi++) {
                qaRows.push({
                  string_id: sliceIds[bi],
                  source_path: tags[bi],
                  original: batch[bi],
                  translation: trans[bi],
                  reviewer_score_0_to_10: scores[bi],
                  reviewer_notes: feedback[bi],
                  meets_accuracy_threshold: scores[bi] >= threshold10,
                });
              }
              ordered.push(...trans);
              offset += batch.length;
              globalBatchIndex += 1;
              break;
            }
          }
        }

        const tagTranslationMap: Record<string, string> = {};
        for (let i = 0; i < extracted.originals.length; i++) {
          tagTranslationMap[extracted.tags[i]] = ordered[i];
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
          originalsOrdered: extracted.originals,
          translationsOrdered: ordered,
          tagTranslationMap,
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

        const qaBundle = {
          schema: 'translateai.qa_bundle.v1',
          job_id: jobId,
          target_language: targetLang,
          source_language: job.sourceLang,
          translator_model_id: translatorModelId.trim(),
          reviewer_model_id: reviewerModelId.trim(),
          accuracy_threshold_0_to_1: threshold01,
          accuracy_threshold_0_to_10: threshold10,
          copy:
            'Each row is one catalog string: original from source file, translation from the translator model, reviewer_notes / score from the Quality reviewer model.',
          strings: qaRows,
        };
        const qaKey = `results/${job.tenantId}/${jobId}/${targetLang}.qa-bundle.json`;
        await this.files.putObjectBytes(
          qaKey,
          Buffer.from(JSON.stringify(qaBundle, null, 2), 'utf-8'),
          'application/json; charset=utf-8',
        );
        resultUrls.push(qaKey);

        const qaCsvKey = `results/${job.tenantId}/${jobId}/${targetLang}.translation-review.csv`;
        await this.files.putObjectBytes(
          qaCsvKey,
          Buffer.from(qaRowsToReviewCsv(qaRows), 'utf-8'),
          'text/csv; charset=utf-8',
        );
        resultUrls.push(qaCsvKey);
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
