import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Prisma } from '@prisma/client';
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
import {
  applyBatchUiRepairs,
  indicesBelowScoreThreshold,
  mechanicalFailuresAfterRepair,
  mergeTargetedTranslations,
  placeholderTranslationsForIndices,
  uniqueSortedIndices,
} from './batch-translate-helpers';
import { mechanicalFailureSummary } from './translation-mechanical-qa';
import { isAlignmentError } from '../llm/llm-response-alignment';

function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) {
    out.push(arr.slice(i, i + size));
  }
  return out;
}

/** Bounded parallel map: multiple async workers, each item runs exactly once (I/O-bound LLM work). */
async function mapPool<T, R>(
  items: readonly T[],
  poolSize: number,
  worker: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const n = items.length;
  if (n === 0) return [];
  const results = new Array<R>(n);
  let nextIndex = 0;
  const concurrency = Math.min(Math.max(1, poolSize), n);
  async function runWorker(): Promise<void> {
    while (true) {
      const i = nextIndex++;
      if (i >= n) return;
      results[i] = await worker(items[i], i);
    }
  }
  await Promise.all(Array.from({ length: concurrency }, () => runWorker()));
  return results;
}

class JobCancelledError extends Error {
  constructor(message = 'job_cancelled') {
    super(message);
    this.name = 'JobCancelledError';
  }
}

class JobSilentAbort extends Error {
  constructor() {
    super('job_silent_abort');
    this.name = 'JobSilentAbort';
  }
}

/** Serialize progress DB writes + SSE so parallel batches do not clobber each other. */
class AsyncMutex {
  private tail: Promise<unknown> = Promise.resolve();
  run<T>(fn: () => Promise<T>): Promise<T> {
    const next = this.tail.then(() => fn());
    this.tail = next.then(
      () => undefined,
      () => undefined,
    );
    return next;
  }
}

function totalDoneStrings(
  batchDone: readonly boolean[],
  batches: readonly { length: number }[],
): number {
  let sum = 0;
  for (let i = 0; i < batchDone.length; i++) {
    if (batchDone[i]) sum += batches[i]!.length;
  }
  return sum;
}

function translationProgressPercent(
  stringsDone: number,
  stringsTotal: number,
): number {
  return Math.min(95, 5 + (85 * stringsDone) / Math.max(1, stringsTotal));
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
    translator_attempt_number?: number;
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

/** Default raised from 4 → 8: more parallel Bedrock batches when quota allows. Override via env. */
const DEFAULT_TRANSLATION_BATCH_CONCURRENCY = 8;
const MAX_TRANSLATION_BATCH_CONCURRENCY = 24;

function resolveTranslationBatchConcurrency(config: ConfigService): number {
  const raw = config.get<string>('TRANSLATION_BATCH_CONCURRENCY');
  if (raw == null || String(raw).trim() === '') {
    return DEFAULT_TRANSLATION_BATCH_CONCURRENCY;
  }
  const n = Number.parseInt(String(raw).trim(), 10);
  if (!Number.isFinite(n) || n < 1) {
    return DEFAULT_TRANSLATION_BATCH_CONCURRENCY;
  }
  return Math.min(MAX_TRANSLATION_BATCH_CONCURRENCY, n);
}

/** Bedrock scorer catch-path returns 5.0 + "Scoring failed: …" for every row (see bedrock-scorer.service). */
function scoringAppearsDegraded(
  scores: readonly number[],
  feedback: readonly string[],
): boolean {
  if (scores.length === 0 || feedback.length !== scores.length) return false;
  if (!scores.every((s) => s === 5.0)) return false;
  return feedback.some((f) => /Scoring failed:/i.test(f));
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

  private async isJobCancelled(jobId: string): Promise<boolean> {
    const row = await this.prisma.job.findUnique({
      where: { id: jobId },
      select: { status: true },
    });
    return row?.status === 'cancelled';
  }

  /** Status/progress updates must not clobber a user-cancelled job. */
  private async updateJobUnlessCancelled(
    jobId: string,
    data: Prisma.JobUpdateManyMutationInput,
  ): Promise<boolean> {
    const r = await this.prisma.job.updateMany({
      where: { id: jobId, status: { not: 'cancelled' } },
      data,
    });
    return r.count > 0;
  }

  async run(jobId: string): Promise<void> {
    const job = await this.prisma.job.findUnique({
      where: { id: jobId },
      include: { tenant: true },
    });
    if (!job) {
      this.logger.warn(`Job ${jobId} not found`);
      return;
    }
    if (job.status === 'cancelled') {
      this.logger.warn(`Job ${jobId} already cancelled — skipping`);
      return;
    }

    const threshold01 = job.minTranslationScore ?? 0.7;
    const threshold10 = threshold01 <= 1 ? threshold01 * 10 : threshold01;

    const translatorKind = normalizeTranslatorId(job.tenant.activeTranslator);
    const scorerKind = normalizeScorerId(job.tenant.activeScorer);

    const maxSidRounds = Math.min(
      3,
      Math.max(1, job.maxBatchRetries ?? 3),
    );
    const batchSize = Math.max(1, job.batchSize);
    const targetedChunkSize = Math.max(
      5,
      Math.min(15, Math.floor(batchSize / 3) || 10),
    );

    const translatorModelId =
      this.config.get<string>('BEDROCK_TRANSLATION_MODEL_ID') ??
      this.config.get<string>('BEDROCK_MODEL_ID') ??
      DEFAULT_BEDROCK_TRANSLATION_MODEL_ID;
    const reviewerModelId =
      this.config.get<string>('BEDROCK_SCORING_MODEL_ID') ??
      DEFAULT_BEDROCK_SCORING_MODEL_ID;

    try {
      const progressed = await this.updateJobUnlessCancelled(jobId, {
        status: 'extracting',
        progress: 2,
        errorMessage: null,
      });
      if (!progressed && (await this.isJobCancelled(jobId))) {
        await this.events.publish(jobId, { phase: 'cancelled', percent: 0 });
        return;
      }
      if (!progressed) {
        return;
      }
      await this.events.publish(jobId, { phase: 'extracting', percent: 2 });

      const buf = await this.files.getObjectBytes(job.fileKey);
      if (await this.isJobCancelled(jobId)) {
        await this.events.publish(jobId, { phase: 'cancelled', percent: 2 });
        return;
      }
      const extractOpts =
        job.extractOptions &&
        typeof job.extractOptions === 'object' &&
        !Array.isArray(job.extractOptions)
          ? (job.extractOptions as {
              selectedColumns?: string[];
              selectedSheet?: string;
            })
          : {};
      const extracted = this.extractors.extract(buf, job.fileKey, extractOpts);
      const batches = chunk(extracted.originals, batchSize);

      const chunked = await this.updateJobUnlessCancelled(jobId, {
        status: 'chunking',
        progress: 5,
        stringsTotal: extracted.originals.length,
        batchTotal: batches.length * job.targetLangs.length,
      });
      if (!chunked && (await this.isJobCancelled(jobId))) {
        await this.events.publish(jobId, { phase: 'cancelled', percent: 5 });
        return;
      }
      if (!chunked) {
        return;
      }
      await this.events.publish(jobId, {
        phase: 'chunking',
        stringsTotal: extracted.originals.length,
        percent: 5,
      });
      const resultUrls: string[] = [];
      let globalBatchIndex = 0;

      for (const targetLang of job.targetLangs) {
        if (await this.isJobCancelled(jobId)) {
          const p = await this.prisma.job.findUnique({
            where: { id: jobId },
            select: { progress: true },
          });
          await this.events.publish(jobId, {
            phase: 'cancelled',
            percent: Math.round(p?.progress ?? 0),
          });
          return;
        }
        type QaRow = {
          string_id: number;
          source_path: string;
          original: string;
          translation: string;
          reviewer_score_0_to_10: number;
          reviewer_notes: string;
          meets_accuracy_threshold: boolean;
          translator_attempt_number?: number;
        };
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

        const batchConc = resolveTranslationBatchConcurrency(this.config);
        this.logger.log(
          `Job ${jobId.slice(0, 8)} · ${targetLang}: up to ${batchConc} parallel batches (${batches.length} total, ${extracted.originals.length} strings)`,
        );

        const startOffsets: number[] = [];
        {
          let acc = 0;
          for (const b of batches) {
            startOffsets.push(acc);
            acc += b.length;
          }
        }

        const batchBaseForLang = globalBatchIndex;
        const batchDoneFlags = new Array<boolean>(batches.length).fill(false);
        const progressMu = new AsyncMutex();

        type BatchWorkerResult = { translations: string[]; qaSlice: QaRow[] };

        let perBatchResults: BatchWorkerResult[] = [];
        try {
          perBatchResults = await mapPool(
            batches,
            batchConc,
            async (batch, localIdx) => {
              const offset = startOffsets[localIdx]!;
              const gBatchIdx = batchBaseForLang + localIdx;
              const tags = extracted.tags.slice(offset, offset + batch.length);
              const stringIdSlice = extracted.stringIds.slice(
                offset,
                offset + batch.length,
              );

              this.logger.log(
                `job=${jobId.slice(0, 8)} · ${targetLang} · batch ${localIdx + 1}/${batches.length} (index #${gBatchIdx + 1}) — started`,
              );

              const translateCtx = {
                administratorSystemPrompt: tmpl.systemText,
                administratorUserTemplate: userTemplateFilled,
                batchSourceLang: job.sourceLang,
                batchSourceLangDisplayName: sourceCfg?.name ?? job.sourceLang,
              };

              const publishBatchEvent = async (
                detail: string,
                extra?: Record<string, unknown>,
              ) => {
                await progressMu.run(async () => {
                  if (await this.isJobCancelled(jobId)) {
                    throw new JobCancelledError();
                  }
                  const stringsDone = totalDoneStrings(
                    batchDoneFlags,
                    batches,
                  );
                  const pct = translationProgressPercent(
                    stringsDone,
                    extracted.originals.length,
                  );
                  const progressed = await this.updateJobUnlessCancelled(
                    jobId,
                    { status: 'translating', progress: Math.min(95, pct) },
                  );
                  if (!progressed && (await this.isJobCancelled(jobId))) {
                    await this.events.publish(jobId, {
                      phase: 'cancelled',
                      percent: Math.round(pct),
                    });
                    throw new JobCancelledError();
                  }
                  if (!progressed) throw new JobSilentAbort();
                  await this.events.publish(jobId, {
                    phase: 'translating',
                    detail,
                    stringsDone,
                    stringsTotal: extracted.originals.length,
                    targetLang,
                    batchIndex: gBatchIdx,
                    percent: Math.round(pct),
                    ...extra,
                  });
                });
              };

              const translateSlice = async (
                texts: readonly string[],
                ids: readonly number[],
              ): Promise<string[]> => {
                if (!texts.length) return [];
                return this.translationRouter.translate(
                  translatorKind,
                  [...texts],
                  targetLang,
                  { ...translateCtx, batchStringIds: [...ids] },
                );
              };

              /** Full batch first; on alignment failure split into smaller chunks (never fail the job). */
              const translateBatchResilient = async (): Promise<string[]> => {
                try {
                  return applyBatchUiRepairs(
                    batch,
                    await translateSlice(batch, stringIdSlice),
                  );
                } catch (firstErr) {
                  const msg =
                    firstErr instanceof Error
                      ? firstErr.message
                      : String(firstErr);
                  if (!isAlignmentError(msg)) throw firstErr;
                  this.logger.warn(
                    `job=${jobId.slice(0, 8)} · batch ${localIdx + 1} full-batch alignment miss — retry once: ${msg}`,
                  );
                  try {
                    return applyBatchUiRepairs(
                      batch,
                      await translateSlice(batch, stringIdSlice),
                    );
                  } catch (secondErr) {
                    const msg2 =
                      secondErr instanceof Error
                        ? secondErr.message
                        : String(secondErr);
                    this.logger.warn(
                      `job=${jobId.slice(0, 8)} · batch ${localIdx + 1} split translate (${targetedChunkSize}/chunk): ${msg2}`,
                    );
                    const out: string[] = [];
                    for (let s = 0; s < batch.length; s += targetedChunkSize) {
                      const texts = batch.slice(s, s + targetedChunkSize);
                      const ids = stringIdSlice.slice(
                        s,
                        s + targetedChunkSize,
                      );
                      const idxList = texts.map((_, j) => s + j);
                      try {
                        const part = applyBatchUiRepairs(
                          texts,
                          await translateSlice(texts, ids),
                        );
                        out.push(...part);
                      } catch (chunkErr) {
                        const cm =
                          chunkErr instanceof Error
                            ? chunkErr.message
                            : String(chunkErr);
                        this.logger.warn(
                          `job=${jobId.slice(0, 8)} · batch ${localIdx + 1} chunk ${s}–${s + texts.length} failed: ${cm}`,
                        );
                        out.push(
                          ...placeholderTranslationsForIndices(
                            batch,
                            idxList,
                            stringIdSlice,
                            'alignment',
                          ),
                        );
                      }
                    }
                    return out;
                  }
                }
              };

              await publishBatchEvent(
                `${targetLang}: batch ${localIdx + 1}/${batches.length} · translating ${batch.length} strings`,
              );

              if (await this.isJobCancelled(jobId)) {
                throw new JobCancelledError();
              }

              let trans = await translateBatchResilient();
              let totalAttempts = 1;
              let scores: number[] = batch.map(() => 5.0);
              let feedback: string[] = batch.map(
                () => 'Pending quality review',
              );

              for (let sidRound = 0; sidRound <= maxSidRounds; sidRound++) {
                trans = applyBatchUiRepairs(batch, trans);

                try {
                  const scored = await this.scoring.score(
                    scorerKind,
                    batch,
                    trans,
                    targetLang,
                    tags,
                    { stringIds: stringIdSlice },
                  );
                  scores = scored.scores;
                  feedback = scored.feedback;
                } catch (scoreErr) {
                  const msg =
                    scoreErr instanceof Error
                      ? scoreErr.message
                      : String(scoreErr);
                  this.logger.warn(
                    `job=${jobId.slice(0, 8)} · batch ${localIdx + 1} judge error (accepting best effort): ${msg}`,
                  );
                  scores = batch.map(() => 5.0);
                  feedback = batch.map(() => `Scoring skipped: ${msg.slice(0, 120)}`);
                  break;
                }

                const mechFails = mechanicalFailuresAfterRepair(
                  batch,
                  trans,
                  stringIdSlice,
                );
                const belowIdx = indicesBelowScoreThreshold(
                  scores,
                  threshold10,
                );
                const failIdx = uniqueSortedIndices([
                  ...belowIdx,
                  ...mechFails.map((f) => f.index),
                ]);

                if (failIdx.length === 0 || sidRound >= maxSidRounds) {
                  if (failIdx.length > 0 && sidRound >= maxSidRounds) {
                    this.logger.warn(
                      `job=${jobId.slice(0, 8)} · batch ${localIdx + 1} accepting ${failIdx.length} imperfect string(s) after ${maxSidRounds} targeted round(s)`,
                    );
                  }
                  break;
                }

                const failSids = failIdx.map((i) => stringIdSlice[i]!);
                const mechSummary = mechanicalFailureSummary(mechFails);
                await publishBatchEvent(
                  `${targetLang}: batch ${localIdx + 1}/${batches.length} · re-translating ${failIdx.length}/${batch.length} string(s) (round ${sidRound + 1}/${maxSidRounds})${mechSummary ? ` · ${mechSummary}` : ''}`,
                  {
                    retryReason: 'TARGETED',
                    targetedCount: failIdx.length,
                    worstStringIds: failSids.slice(0, 20),
                  },
                );

                const subOrig = failIdx.map((i) => batch[i]!);
                const subIds = failIdx.map((i) => stringIdSlice[i]!);
                try {
                  const subTrans = applyBatchUiRepairs(
                    subOrig,
                    await translateSlice(subOrig, subIds),
                  );
                  trans = mergeTargetedTranslations(
                    batch,
                    trans,
                    failIdx,
                    subTrans,
                  );
                  totalAttempts += 1;
                } catch (targetErr) {
                  const msg =
                    targetErr instanceof Error
                      ? targetErr.message
                      : String(targetErr);
                  this.logger.warn(
                    `job=${jobId.slice(0, 8)} · batch ${localIdx + 1} targeted translate failed (keeping prior text): ${msg}`,
                  );
                  break;
                }
              }

              const below = scores.filter((s) => s < threshold10).length;
              const degradedJudge = scoringAppearsDegraded(scores, feedback);
              const batchLastError =
                below > 0
                  ? degradedJudge
                    ? 'SCORING_FAILED'
                    : 'SCORE_LOW'
                  : null;

              await this.prisma.jobBatch.upsert({
                where: {
                  jobId_batchIndex: { jobId, batchIndex: gBatchIdx },
                },
                create: {
                  jobId,
                  tenantId: job.tenantId,
                  batchIndex: gBatchIdx,
                  attempt: totalAttempts,
                  judgeScore: scores.length
                    ? scores.reduce((a, b) => a + b, 0) / scores.length
                    : null,
                  lastErrorCode: batchLastError,
                },
                update: {
                  attempt: totalAttempts,
                  judgeScore: scores.length
                    ? scores.reduce((a, b) => a + b, 0) / scores.length
                    : null,
                  lastErrorCode: batchLastError,
                },
              });

              const qaSlice: QaRow[] = [];
              for (let bi = 0; bi < batch.length; bi++) {
                qaSlice.push({
                  string_id: stringIdSlice[bi]!,
                  source_path: tags[bi]!,
                  original: batch[bi]!,
                  translation: trans[bi]!,
                  reviewer_score_0_to_10: scores[bi]!,
                  reviewer_notes: feedback[bi]!,
                  meets_accuracy_threshold: scores[bi]! >= threshold10,
                  translator_attempt_number: totalAttempts,
                });
              }

              await progressMu.run(async () => {
                batchDoneFlags[localIdx] = true;
                if (await this.isJobCancelled(jobId)) {
                  throw new JobCancelledError();
                }
                const stringsDone = totalDoneStrings(
                  batchDoneFlags,
                  batches,
                );
                const pct = translationProgressPercent(
                  stringsDone,
                  extracted.originals.length,
                );
                await this.updateJobUnlessCancelled(jobId, {
                  status: 'translating',
                  progress: pct,
                });
                await this.events.publish(jobId, {
                  phase: 'translating',
                  detail: `${targetLang}: batch ${localIdx + 1}/${batches.length} completed · ${batch.length} strings`,
                  stringsDone,
                  stringsTotal: extracted.originals.length,
                  targetLang,
                  batchIndex: gBatchIdx,
                  attempt: totalAttempts,
                  percent: Math.round(pct),
                });
              });

              this.logger.log(
                `job=${jobId.slice(0, 8)} · ${targetLang} · batch ${localIdx + 1}/${batches.length} — completed (${batch.length} strings, ${totalAttempts} translate pass(es))`,
              );

              return { translations: trans, qaSlice };
            },
          );
        } catch (e) {
          if (e instanceof JobCancelledError) {
            const p = await this.prisma.job.findUnique({
              where: { id: jobId },
              select: { progress: true },
            });
            await this.events.publish(jobId, {
              phase: 'cancelled',
              percent: Math.round(p?.progress ?? 0),
            });
            return;
          }
          if (e instanceof JobSilentAbort) {
            return;
          }
          throw e;
        }

        const ordered: string[] = [];
        const qaRows: QaRow[] = [];
        for (let i = 0; i < batches.length; i++) {
          const r = perBatchResults[i]!;
          ordered.push(...r.translations);
          qaRows.push(...r.qaSlice);
        }
        globalBatchIndex += batches.length;

        if (await this.isJobCancelled(jobId)) {
          const p = await this.prisma.job.findUnique({
            where: { id: jobId },
            select: { progress: true },
          });
          await this.events.publish(jobId, {
            phase: 'cancelled',
            percent: Math.round(p?.progress ?? 0),
          });
          return;
        }

        const tagTranslationMap: Record<string, string> = {};
        for (let i = 0; i < extracted.originals.length; i++) {
          tagTranslationMap[extracted.tags[i]] = ordered[i];
        }

        const regen = await this.updateJobUnlessCancelled(jobId, {
          status: 'regenerating',
          progress: 92,
        });
        if (!regen && (await this.isJobCancelled(jobId))) {
          await this.events.publish(jobId, { phase: 'cancelled', percent: 92 });
          return;
        }
        if (!regen) {
          return;
        }
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
          copy: 'Each row is one catalog string: original from source file, translation from the translator model, reviewer_notes / score from the Quality reviewer model.',
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

      const finished = await this.updateJobUnlessCancelled(jobId, {
        status: 'completed',
        progress: 100,
        resultUrls,
      });
      if (!finished) {
        if (await this.isJobCancelled(jobId)) {
          const p = await this.prisma.job.findUnique({
            where: { id: jobId },
            select: { progress: true },
          });
          await this.events.publish(jobId, {
            phase: 'cancelled',
            percent: Math.round(p?.progress ?? 0),
          });
        }
        return;
      }
      await this.events.publish(jobId, {
        phase: 'completed',
        percent: 100,
        resultUrls,
      });
    } catch (e) {
      const fresh = await this.prisma.job.findUnique({
        where: { id: jobId },
        select: { status: true, progress: true },
      });
      if (fresh?.status === 'cancelled') {
        await this.events.publish(jobId, {
          phase: 'cancelled',
          percent: Math.round(fresh.progress),
        });
        return;
      }
      const msg = e instanceof Error ? e.message : String(e);
      this.logger.error(`Job ${jobId} failed: ${msg}`);
      const wr = await this.prisma.job.updateMany({
        where: { id: jobId, status: { not: 'cancelled' } },
        data: {
          status: 'failed',
          errorMessage: msg,
        },
      });
      if (wr.count > 0) {
        await this.events.publish(jobId, { phase: 'failed', error: msg });
      }
    }
  }
}
