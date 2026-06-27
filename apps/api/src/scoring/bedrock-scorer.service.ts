import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DEFAULT_BEDROCK_SCORING_MODEL_ID } from '../config/bedrock-defaults';
import { buildScoringPrompt } from '../llm/prompt-builder';
import { extractJsonObject } from '../llm/json-utils';
import { BedrockConverseService } from '../llm/bedrock-converse.service';
import {
  assertNoDuplicateSids,
  isAlignmentError,
  validateScoringAlignmentStrict,
} from '../llm/llm-response-alignment';

export type ScoreBatchResult = {
  scores: number[];
  feedback: string[];
};

const DEFAULT_SCORER_SYSTEM = `You are a strict QA reviewer for localized retail / POS software UI.
You output ONLY valid JSON with the requested structure — no commentary, no markdown.`;

@Injectable()
export class BedrockScorerService {
  private readonly logger = new Logger(BedrockScorerService.name);

  constructor(
    private readonly config: ConfigService,
    private readonly bedrock: BedrockConverseService,
  ) {}

  modelId(): string {
    const id =
      this.config.get<string>('BEDROCK_SCORING_MODEL_ID') ??
      DEFAULT_BEDROCK_SCORING_MODEL_ID;
    return id.trim();
  }

  async score(
    originals: string[],
    translations: string[],
    language: string,
    tags?: (string | null)[] | null,
    opts?: { stringIds?: number[] },
  ): Promise<ScoreBatchResult> {
    if (originals.length !== translations.length) {
      throw new Error(
        `Input arrays must have same length: ${originals.length} vs ${translations.length}`,
      );
    }
    if (!originals.length) {
      return { scores: [], feedback: [] };
    }

    if (!this.modelId()) {
      throw new Error('Bedrock scoring model id resolved empty');
    }

    const ids =
      opts?.stringIds?.length === originals.length
        ? opts.stringIds
        : originals.map((_, i) => i + 1);

    const scoringItems = originals.map((original, i) => ({
      sid: ids[i],
      original_text: original,
      translated_text: translations[i],
      context: tags?.[i] ?? null,
      ix: i,
    }));

    const originalsForPrompt = scoringItems.map((s) => s.original_text);
    const translationsForPrompt = scoringItems.map((s) => s.translated_text);
    const tagsForPrompt = scoringItems.map((s) => s.context ?? undefined);

    const comprehensive = buildScoringPrompt(
      originalsForPrompt,
      translationsForPrompt,
      language,
      tagsForPrompt,
    );

    const structuredPrompt =
      comprehensive +
      `\n\nINPUT_ROWS_WITH_IDS (copy each "sid" into the matching score_res object):\n${JSON.stringify(scoringItems)}\n\nReminder: Produce exactly ${scoringItems.length} objects in score_res.`;
    const overlay = this.config
      .get<string>('BEDROCK_SCORER_SYSTEM_OVERLAY', '')
      ?.trim();
    const systemPrompt = [DEFAULT_SCORER_SYSTEM, overlay].filter(Boolean).join('\n\n');

    try {
      const maxOut = Number(
        this.config.get<string>('BEDROCK_SCORING_MAX_TOKENS', '8192'),
      );
      const temp = Number(
        this.config.get<string>('BEDROCK_SCORING_TEMPERATURE', '0.15'),
      );
      const raw = await this.bedrock.converseText({
        modelId: this.modelId(),
        system: systemPrompt,
        user: structuredPrompt,
        maxTokens: maxOut,
        temperature: temp,
      });
      const parsedScores = this.parseScoringResponse(raw);
      const scores: number[] = [];
      const feedback: string[] = [];

      for (let i = 0; i < originals.length; i++) {
        const sid = ids[i];
        const item =
          parsedScores.bySid.get(sid) ??
          parsedScores.byLegacyId.get(`s${i}`) ??
          {};
        const val = item.score;
        let scoreVal = 5.0;
        if (val != null) {
          try {
            scoreVal = Math.max(0, Math.min(10, Number(val)));
          } catch {
            scoreVal = 5.0;
          }
        }
        scores.push(Math.round(scoreVal * 10) / 10);
        feedback.push(item.fb ?? 'Quality assessment unavailable');
      }

      validateScoringAlignmentStrict(
        originals,
        scores,
        feedback,
        ids,
        parsedScores,
      );
      return { scores, feedback };
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (isAlignmentError(msg)) {
        this.logger.warn(`Bedrock scoring alignment rejected: ${msg}`);
        throw e instanceof Error ? e : new Error(msg);
      }
      this.logger.error(`Bedrock scoring failed: ${msg}`);
      throw e instanceof Error ? e : new Error(msg);
    }
  }

  private flattenJudgeFeedback(a: Record<string, unknown>): string {
    const legacyFb =
      typeof a.fb === 'string' && a.fb.trim().length > 0
        ? a.fb.trim()
        : '';
    if (legacyFb) return legacyFb.slice(0, 4000);
    const feedback =
      typeof a.feedback === 'string' ? a.feedback.trim() : '';
    let scoreNum = NaN;
    if (typeof a.score === 'number') scoreNum = a.score;
    else if (typeof a.score === 'string') scoreNum = Number(a.score);
    if (
      !Number.isNaN(scoreNum) &&
      scoreNum >= 10 &&
      /^perfect\s*$/i.test(feedback)
    ) {
      return 'Perfect';
    }
    const parts: string[] = [];
    if (feedback) parts.push(feedback);
    const better =
      typeof a.better_option === 'string' && a.better_option.trim().length > 0
        ? a.better_option.trim()
        : '';
    if (better) parts.push(`Better option: ${better}`);
    const rat =
      typeof a.rationale === 'string' && a.rationale.trim().length > 0
        ? a.rationale.trim()
        : '';
    if (rat) parts.push(rat);
    const out =
      parts.length > 0 ? parts.join(' | ') : 'Quality assessment unavailable';
    return out.slice(0, 4000);
  }

  private parseScoringResponse(raw: string): {
    bySid: Map<number, { sid?: number; score?: number; fb?: string; ix?: number }>;
    byLegacyId: Map<
      string,
      { id?: string; score?: number; fb?: string; ix?: number }
    >;
  } {
    type RawRow = {
      sid?: number;
      id?: string | number;
      score?: number;
      fb?: string;
      feedback?: string;
      ix?: number;
      index?: number;
      better_option?: string | null;
      rationale?: string | null;
    };

    try {
      const jsonStr = extractJsonObject(raw);
      const data = JSON.parse(jsonStr) as { score_res?: RawRow[] };
      const bySid = new Map<
        number,
        { sid?: number; score?: number; fb?: string; ix?: number }
      >();
      const byLegacyId = new Map<
        string,
        { id?: string; score?: number; fb?: string; ix?: number }
      >();

      const rows = Array.isArray(data.score_res)
        ? data.score_res
        : Array.isArray((data as { assessments?: RawRow[] }).assessments)
          ? (data as { assessments: RawRow[] }).assessments
          : [];

      assertNoDuplicateSids(rows, 'Scoring');

      for (const row of rows) {
        const a = row as Record<string, unknown>;
        const fb = this.flattenJudgeFeedback(a);

        let sidParsed: number | undefined;
        if (row.sid != null && !Number.isNaN(Number(row.sid))) {
          sidParsed = Number(row.sid);
        } else if (row.id != null && !Number.isNaN(Number(row.id))) {
          sidParsed = Number(row.id);
        }

        const ixAligned =
          row.ix ??
          row.index ??
          undefined;

        const merged = {
          sid: sidParsed,
          score: row.score,
          fb,
          ix: ixAligned,
        };

        if (sidParsed != null) {
          bySid.set(sidParsed, merged);
        }
        if (row.id != null && row.id !== '') {
          byLegacyId.set(String(row.id), merged);
        }
      }
      return { bySid, byLegacyId };
    } catch {
      return { bySid: new Map(), byLegacyId: new Map() };
    }
  }

}
