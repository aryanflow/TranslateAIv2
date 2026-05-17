import { Injectable } from '@nestjs/common';
import { BedrockTranslatorService } from './bedrock-translator.service';
import type { TranslationCallContext } from './translation-context';

/** Stored on Tenant — legacy values map to Bedrock. */
export type TranslatorKind = 'bedrock' | 'gemini' | 'langdock';

@Injectable()
export class TranslationRouterService {
  constructor(private readonly bedrock: BedrockTranslatorService) {}

  async translate(
    kind: TranslatorKind,
    texts: string[],
    language: string,
    ctx?: TranslationCallContext,
  ): Promise<string[]> {
    void kind;
    return this.bedrock.translate(texts, language, ctx);
  }
}
