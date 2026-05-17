import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DEFAULT_BEDROCK_SCORING_MODEL_ID } from '../config/bedrock-defaults';
import { buildScoringPrompt } from '../llm/prompt-builder';
import { extractJsonObject } from '../llm/json-utils';
import { BedrockConverseService } from '../llm/bedrock-converse.service';

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

    const jsonStructure = `

Return ONLY the following compact JSON structure:
{
  "score_res": [
    {"sid": 1, "score": 8.5, "fb": "Better option: ...", "ix": 0},
    {"sid": 2, "score": 9.0, "fb": "Perfect", "ix": 1}
  ]
}

Rules:
- Output exactly ${scoringItems.length} assessments.
- Each MUST include integer "sid" copied exactly from input (catalog scope).
- "ix" is batch position only: 0 for the first row, 1 for the second — never set ix equal to sid.
- Feedback must be <= 180 chars; if score < 10.0 include "Better option: <correct>".
- JSON only; no extra text.
`;

    const structuredPrompt = comprehensive + '\n\n' + jsonStructure;
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
        feedback.push(String(item.fb ?? 'Quality assessment unavailable'));
      }

      this.validateScoringAlignment(originals, scores, feedback, ids, parsedScores);
      return { scores, feedback };
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      this.logger.error(`Bedrock scoring failed: ${msg}`);
      return {
        scores: originals.map(() => 5.0),
        feedback: originals.map(() => `Scoring failed: ${msg}`),
      };
    }
  }

  private parseScoringResponse(raw: string): {
    bySid: Map<number, { sid?: number; score?: number; fb?: string; ix?: number }>;
    byLegacyId: Map<
      string,
      { id?: string; score?: number; fb?: string; ix?: number }
    >;
  } {
    try {
      const jsonStr = extractJsonObject(raw);
      const data = JSON.parse(jsonStr) as {
        score_res?: Array<{
          sid?: number;
          id?: string;
          score?: number;
          fb?: string;
          ix?: number;
        }>;
      };
      const bySid = new Map<
        number,
        { sid?: number; score?: number; fb?: string; ix?: number }
      >();
      const byLegacyId = new Map<
        string,
        { id?: string; score?: number; fb?: string; ix?: number }
      >();
      for (const a of data.score_res ?? []) {
        if (a.sid != null && !Number.isNaN(Number(a.sid))) {
          bySid.set(Number(a.sid), a);
        }
        if (a.id) byLegacyId.set(String(a.id), a);
      }
      return { bySid, byLegacyId };
    } catch {
      return { bySid: new Map(), byLegacyId: new Map() };
    }
  }

  private validateScoringAlignment(
    originals: string[],
    scores: number[],
    feedback: string[],
    ids: number[],
    parsed: {
      bySid: Map<number, { ix?: number }>;
      byLegacyId: Map<string, { ix?: number }>;
    },
  ): void {
    if (
      scores.length !== originals.length ||
      feedback.length !== originals.length
    ) {
      throw new Error('Scoring count alignment failed');
    }
    for (let i = 0; i < originals.length; i++) {
      const sid = ids[i];
      const fromSid = parsed.bySid.get(sid);
      const item = fromSid ?? parsed.byLegacyId.get(`s${i}`);
      if (!fromSid && item?.ix !== undefined && item.ix !== i) {
        throw new Error(
          `Scoring index alignment failed at batch index ${i} (legacy id s${i})`,
        );
      }
    }
  }
}
