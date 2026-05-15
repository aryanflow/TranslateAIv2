import { Injectable, Logger } from '@nestjs/common';
import { buildScoringPrompt } from '../llm/prompt-builder';
import { extractJsonObject } from '../llm/json-utils';
import { LangdockGoogleGeminiClient } from '../llm/langdock-google-gemini.client';
import type { ScoreBatchResult } from './langdock-openai-scorer.service';

/** Optional judge via Gemini (Langdock Google API) — matches aptos-translateai GeminiLLM.score */
@Injectable()
export class GeminiLangdockScorerService {
  private readonly logger = new Logger(GeminiLangdockScorerService.name);

  constructor(private readonly geminiClient: LangdockGoogleGeminiClient) {}

  async score(
    originals: string[],
    translations: string[],
    language: string,
    tags?: (string | null)[] | null,
  ): Promise<ScoreBatchResult> {
    if (originals.length !== translations.length) {
      throw new Error('Input arrays must have same length');
    }
    if (!originals.length) return { scores: [], feedback: [] };

    this.geminiClient.assertConfigured();

    const comprehensive = buildScoringPrompt(
      originals,
      translations,
      language,
      tags ?? undefined,
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
- Output exactly ${originals.length} assessments.
- ids must be s0..s${originals.length - 1} and ix must match 0..${originals.length - 1}.
- Feedback must be <= 180 chars; if score < 10.0 include "Better option: <correct>".
- JSON only; no extra text.
`;

    const prompt = comprehensive + '\n\n' + jsonStructure;
    const generationConfig = {
      temperature: 0.1,
      topP: 0.8,
      topK: 40,
      maxOutputTokens: 8192,
    };

    try {
      const raw = await this.geminiClient.generateContent(
        prompt,
        generationConfig,
      );
      const parsed = this.parseScoringResponse(raw);
      const scores: number[] = [];
      const feedback: string[] = [];

      for (let i = 0; i < originals.length; i++) {
        const item = parsed.get(`s${i}`) ?? {};
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

      return { scores, feedback };
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      this.logger.error(`Gemini scoring failed: ${msg}`);
      return {
        scores: originals.map(() => 5.0),
        feedback: originals.map(() => `Scoring failed: ${msg}`),
      };
    }
  }

  private parseScoringResponse(
    raw: string,
  ): Map<string, { score?: number; fb?: string; ix?: number }> {
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
        { score?: number; fb?: string; ix?: number }
      >();
      for (const a of data.score_res ?? []) {
        if (a.id) map.set(a.id, a);
      }
      return map;
    } catch {
      return new Map();
    }
  }
}
