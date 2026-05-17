import { Injectable } from '@nestjs/common';
import { BedrockScorerService } from './bedrock-scorer.service';
import type { ScoreBatchResult } from './bedrock-scorer.service';

/** Stored on Tenant — legacy values map to Bedrock. */
export type ScorerKind = 'bedrock' | 'gemini' | 'langdock';

@Injectable()
export class ScoringService {
  constructor(private readonly bedrock: BedrockScorerService) {}

  async score(
    kind: ScorerKind,
    originals: string[],
    translations: string[],
    language: string,
    tags?: (string | null)[] | null,
    opts?: { stringIds?: number[] },
  ): Promise<ScoreBatchResult> {
    void kind;
    return this.bedrock.score(
      originals,
      translations,
      language,
      tags ?? undefined,
      opts,
    );
  }
}
