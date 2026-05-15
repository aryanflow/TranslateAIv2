import { Injectable, Logger } from '@nestjs/common';
import { buildScoringPrompt } from '../llm/prompt-builder';
import { extractJsonObject } from '../llm/json-utils';
import { LangdockOpenAiTranslatorService } from '../llm/langdock-openai-translator.service';

export type ScoreBatchResult = {
  scores: number[];
  feedback: string[];
};

/** Judge LLM via Langdock OpenAI API — matches aptos-translateai/llms/langdock_llm.py score() */
@Injectable()
export class LangdockOpenAiScorerService {
  private readonly logger = new Logger(LangdockOpenAiScorerService.name);

  constructor(private readonly openAi: LangdockOpenAiTranslatorService) {}

  async score(
    originals: string[],
    translations: string[],
    language: string,
    tags?: (string | null)[] | null,
  ): Promise<ScoreBatchResult> {
    if (originals.length !== translations.length) {
      throw new Error(
        `Input arrays must have same length: ${originals.length} vs ${translations.length}`,
      );
    }
    if (!originals.length) {
      return { scores: [], feedback: [] };
    }

    const scoringItems = originals.map((original, i) => ({
      id: `s${i}`,
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
    {"id": "s0", "score": 8.5, "fb": "Better option: ...", "ix": 0},
    {"id": "s1", "score": 9.0, "fb": "Perfect", "ix": 1}
  ]
}

Rules:
- Output exactly ${scoringItems.length} assessments.
- ids must be s0..s${scoringItems.length - 1} and ix must match 0..${scoringItems.length - 1}.
- Feedback must be <= 180 chars; if score < 10.0 include "Better option: <correct>".
- JSON only; no extra text.
`;

    const structuredPrompt = comprehensive + '\n\n' + jsonStructure;

    try {
      const raw = await this.openAi.chat(
        [
          {
            role: 'system',
            content: `You are an expert QA reviewer for retail/business software translations. CRITICAL: Return ONLY a valid JSON object with exactly ${scoringItems.length} assessments. ZERO misalignment tolerance.`,
          },
          { role: 'user', content: structuredPrompt },
        ],
        0.2,
      );

      const parsedScores = this.parseScoringResponse(raw);
      const scores: number[] = [];
      const feedback: string[] = [];

      for (let i = 0; i < originals.length; i++) {
        const item = parsedScores.get(`s${i}`) ?? {};
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

      this.validateScoringAlignment(originals, scores, feedback, parsedScores);
      return { scores, feedback };
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      this.logger.error(`Scoring failed: ${msg}`);
      return {
        scores: originals.map(() => 5.0),
        feedback: originals.map(() => `Scoring failed: ${msg}`),
      };
    }
  }

  private parseScoringResponse(
    raw: string,
  ): Map<string, { id?: string; score?: number; fb?: string; ix?: number }> {
    try {
      const jsonStr = extractJsonObject(raw);
      const data = JSON.parse(jsonStr) as {
        score_res?: Array<{
          id?: string;
          score?: number;
          fb?: string;
          ix?: number;
        }>;
      };
      const map = new Map<
        string,
        { id?: string; score?: number; fb?: string; ix?: number }
      >();
      for (const a of data.score_res ?? []) {
        if (a.id) map.set(a.id, a);
      }
      return map;
    } catch {
      return new Map();
    }
  }

  private validateScoringAlignment(
    originals: string[],
    scores: number[],
    feedback: string[],
    parsed: Map<string, { ix?: number }>,
  ): void {
    if (
      scores.length !== originals.length ||
      feedback.length !== originals.length
    ) {
      throw new Error('Scoring count alignment failed');
    }
    for (let i = 0; i < originals.length; i++) {
      const item = parsed.get(`s${i}`);
      if (item?.ix !== undefined && item.ix !== i) {
        throw new Error(`Scoring index alignment failed for s${i}`);
      }
    }
  }
}
