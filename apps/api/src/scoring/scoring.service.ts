import { Injectable } from '@nestjs/common';
import { LangdockOpenAiScorerService } from './langdock-openai-scorer.service';
import { GeminiLangdockScorerService } from './gemini-langdock-scorer.service';
import type { ScoreBatchResult } from './langdock-openai-scorer.service';

export type ScorerKind = 'gemini' | 'langdock';

/** Routes judge/scoring to Langdock OpenAI or Gemini (via Langdock Google API). */
@Injectable()
export class ScoringService {
  constructor(
    private readonly langdockScorer: LangdockOpenAiScorerService,
    private readonly geminiScorer: GeminiLangdockScorerService,
  ) {}

  async score(
    kind: ScorerKind,
    originals: string[],
    translations: string[],
    language: string,
    tags?: (string | null)[] | null,
  ): Promise<ScoreBatchResult> {
    if (kind === 'gemini') {
      return this.geminiScorer.score(originals, translations, language, tags);
    }
    return this.langdockScorer.score(originals, translations, language, tags);
  }
}
