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
import { preserveUiCatalogMarks } from './preserve-ui-catalog-marks';

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

function contiguousDoneStrings(
  batchDone: readonly boolean[],
  batches: readonly { length: number }[],
): number {
  let sum = 0;
  for (let i = 0; i < batchDone.length; i++) {
    if (!batchDone[i]) break;
    sum += batches[i].length;
  }
  return sum;
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

type ScoreRetryDiagnostics = {
  code: 'SCORE_BELOW_THRESHOLD' | 'SCORING_DEGRADED_FALLBACK';
  belowThresholdCount: number;
  threshold10: number;
  minScore: number;
  maxScore: number;
  avgScore: number;
  worstSamples: { sid: number; score: number; noteSnippet: string }[];
  summaryLine: string;
};

function buildScoreRetryDiagnostics(args: {
  stringIds: readonly number[];
  scores: readonly number[];
  feedback: readonly string[];
  threshold10: number;
}): ScoreRetryDiagnostics {
  const degraded = scoringAppearsDegraded(args.scores, args.feedback);
  const code: ScoreRetryDiagnostics['code'] = degraded
    ? 'SCORING_DEGRADED_FALLBACK'
    : 'SCORE_BELOW_THRESHOLD';

  const belowIdx: number[] = [];
  let sum = 0;
  let minS = Infinity;
  let maxS = -Infinity;
  for (let i = 0; i < args.scores.length; i++) {
    const s = args.scores[i]!;
    sum += s;
    minS = Math.min(minS, s);
    maxS = Math.max(maxS, s);
    if (s < args.threshold10) belowIdx.push(i);
  }
  const avg = args.scores.length ? sum / args.scores.length : 0;
  const worstSamples = belowIdx
    .map((i) => ({
      sid: args.stringIds[i]!,
      score: args.scores[i]!,
      noteSnippet: (args.feedback[i] ?? '')
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, 160),
    }))
    .sort((a, b) => a.score - b.score)
    .slice(0, 5);

  const summaryLine = degraded
    ? 'Judge call failed or returned unusable JSON — neutral 5.0 scores used; batch will be re-translated.'
    : `${belowIdx.length}/${args.scores.length} strings under judge threshold ${args.threshold10} (min ${minS === Infinity ? '—' : minS.toFixed(1)} · avg ${avg.toFixed(2)} · max ${maxS === -Infinity ? '—' : maxS.toFixed(1)})`;

  return {
    code,
    belowThresholdCount: belowIdx.length,
    threshold10: args.threshold10,
    minScore: minS === Infinity ? 0 : minS,
    maxScore: maxS === -Infinity ? 0 : maxS,
    avgScore: avg,
    worstSamples,
    summaryLine,
  };
}

function truncateForLog(s: string, max: number): string {
  const t = s.trim();
  if (t.length <= max) return t;
  return `${t.slice(0, max - 1)}…`;
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

              let attempt = 0;
              let trans: string[] = [];

              while (attempt < maxRetries) {
                attempt += 1;

                await progressMu.run(async () => {
                  if (await this.isJobCancelled(jobId)) {
                    throw new JobCancelledError();
                  }
                  const contiguous = contiguousDoneStrings(
                    batchDoneFlags,
                    batches,
                  );
                  const pct =
                    5 +
                    (85 * contiguous) /
                      Math.max(1, extracted.originals.length);
                  const progressed = await this.updateJobUnlessCancelled(
                    jobId,
                    {
                      status: attempt === 1 ? 'translating' : 'scoring',
                      progress: Math.min(95, pct),
                    },
                  );
                  if (!progressed && (await this.isJobCancelled(jobId))) {
                    await this.events.publish(jobId, {
                      phase: 'cancelled',
                      percent: Math.round(pct),
                    });
                    throw new JobCancelledError();
                  }
                  if (!progressed) {
                    throw new JobSilentAbort();
                  }
                  const phase: 'translating' | 'scoring' =
                    attempt === 1 ? 'translating' : 'scoring';
                  const detail =
                    attempt === 1
                      ? `${targetLang}: batch ${localIdx + 1}/${batches.length} started`
                      : `${targetLang}: batch ${localIdx + 1}/${batches.length} · retry ${attempt}/${maxRetries}`;
                  await this.events.publish(jobId, {
                    phase,
                    detail,
                    stringsDone: contiguous,
                    stringsTotal: extracted.originals.length,
                    targetLang,
                    batchIndex: gBatchIdx,
                    attempt,
                    percent: Math.round(pct),
                  });
                });

                if (await this.isJobCancelled(jobId)) {
                  throw new JobCancelledError();
                }

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
                    batchStringIds: stringIdSlice,
                  },
                );
                trans = trans.map((t, bi) =>
                  preserveUiCatalogMarks(batch[bi] ?? '', t),
                );

                if (await this.isJobCancelled(jobId)) {
                  throw new JobCancelledError();
                }

                const scoreTags =
                  extracted.format === 'json' ? undefined : tags;
                const scored = await this.scoring.score(
                  scorerKind,
                  batch,
                  trans,
                  targetLang,
                  scoreTags,
                  {
                    stringIds: stringIdSlice,
                  },
                );
                const scores = scored.scores;
                const feedback = scored.feedback;
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
                    attempt,
                    judgeScore: scores.length
                      ? scores.reduce((a, b) => a + b, 0) / scores.length
                      : null,
                    lastErrorCode: batchLastError,
                  },
                  update: {
                    attempt,
                    judgeScore: scores.length
                      ? scores.reduce((a, b) => a + b, 0) / scores.length
                      : null,
                    lastErrorCode: batchLastError,
                  },
                });

                if (below === 0 || attempt >= maxRetries) {
                  if (below > 0 && attempt >= maxRetries) {
                    const diag = buildScoreRetryDiagnostics({
                      stringIds: stringIdSlice,
                      scores,
                      feedback,
                      threshold10,
                    });
                    this.logger.warn(
                      [
                        `job=${jobId.slice(0, 8)} · ${targetLang} · batch ${localIdx + 1}/${batches.length} (index #${gBatchIdx + 1})`,
                        `accepting batch after max retries (${maxRetries}) with ${diag.belowThresholdCount} strings still below ${diag.threshold10}`,
                        `reason=${diag.code}`,
                        diag.summaryLine,
                      ].join(' — '),
                    );
                  }
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
                      translator_attempt_number: attempt,
                    });
                  }

                  await progressMu.run(async () => {
                    batchDoneFlags[localIdx] = true;
                    if (await this.isJobCancelled(jobId)) {
                      throw new JobCancelledError();
                    }
                    const contiguous = contiguousDoneStrings(
                      batchDoneFlags,
                      batches,
                    );
                    const pct =
                      5 +
                      (85 * contiguous) /
                        Math.max(1, extracted.originals.length);
                    await this.updateJobUnlessCancelled(jobId, {
                      status: 'translating',
                      progress: Math.min(95, pct),
                    });
                    await this.events.publish(jobId, {
                      phase: 'translating',
                      detail: `${targetLang}: batch ${localIdx + 1}/${batches.length} completed · ${batch.length} strings · attempt ${attempt}`,
                      stringsDone: contiguous,
                      stringsTotal: extracted.originals.length,
                      targetLang,
                      batchIndex: gBatchIdx,
                      attempt,
                      percent: Math.round(pct),
                    });
                  });

                  this.logger.log(
                    `job=${jobId.slice(0, 8)} · ${targetLang} · batch ${localIdx + 1}/${batches.length} (index #${gBatchIdx + 1}) — completed (${batch.length} strings, attempt ${attempt})`,
                  );

                  return { translations: trans, qaSlice };
                }

                if (attempt < maxRetries) {
                  const diag = buildScoreRetryDiagnostics({
                    stringIds: stringIdSlice,
                    scores,
                    feedback,
                    threshold10,
                  });
                  const samples =
                    diag.worstSamples.length > 0
                      ? diag.worstSamples
                          .map(
                            (w) =>
                              `#${w.sid}=${w.score.toFixed(1)}:${truncateForLog(w.noteSnippet, 100)}`,
                          )
                          .join(' | ')
                      : '(no per-row samples)';
                  this.logger.warn(
                    [
                      `job=${jobId.slice(0, 8)} · ${targetLang} · batch ${localIdx + 1}/${batches.length} (index #${gBatchIdx + 1})`,
                      `translator re-run: next attempt ${attempt + 1}/${maxRetries}`,
                      `reason=${diag.code}`,
                      diag.summaryLine,
                      `samples: ${samples}`,
                    ].join(' — '),
                  );
                  const sseDetail = truncateForLog(
                    `${targetLang}: batch ${localIdx + 1}/${batches.length} · re-translate (${attempt}→${attempt + 1}): ${diag.code === 'SCORING_DEGRADED_FALLBACK' ? 'judge error, neutral scores' : `${diag.belowThresholdCount} under ${diag.threshold10}`} · ${diag.summaryLine}`,
                    420,
                  );
                  const contiguousRetry = contiguousDoneStrings(
                    batchDoneFlags,
                    batches,
                  );
                  const pctRetry = Math.min(
                    95,
                    5 +
                      (85 * contiguousRetry) /
                        Math.max(1, extracted.originals.length),
                  );
                  await this.events.publish(jobId, {
                    phase: 'scoring',
                    detail: sseDetail,
                    stringsDone: contiguousRetry,
                    stringsTotal: extracted.originals.length,
                    targetLang,
                    batchIndex: gBatchIdx,
                    attempt,
                    percent: Math.round(pctRetry),
                    retryReason: diag.code,
                    belowThresholdCount: diag.belowThresholdCount,
                    judgeThreshold10: diag.threshold10,
                    judgeMin: diag.minScore,
                    judgeMax: diag.maxScore,
                    judgeAvg: Math.round(diag.avgScore * 100) / 100,
                    worstStringIds: diag.worstSamples.map((w) => w.sid),
                  });
                }
              }

              throw new Error(
                `Batch ${localIdx} (${targetLang}) exhausted retries without a terminal state`,
              );
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
