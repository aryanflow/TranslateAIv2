import { Injectable } from '@nestjs/common';
import { GeminiLangdockTranslatorService } from './gemini-langdock-translator.service';
import { LangdockOpenAiTranslatorService } from './langdock-openai-translator.service';
import type { TranslationExample } from './prompt-builder';

export type TranslatorKind = 'gemini' | 'langdock';

@Injectable()
export class TranslationRouterService {
  constructor(
    private readonly gemini: GeminiLangdockTranslatorService,
    private readonly langdock: LangdockOpenAiTranslatorService,
  ) {}

  async translate(
    kind: TranslatorKind,
    texts: string[],
    language: string,
    examples?: TranslationExample[] | null,
    additionalContext?: string | null,
  ): Promise<string[]> {
    if (kind === 'gemini') {
      return this.gemini.translate(
        texts,
        language,
        examples,
        additionalContext,
      );
    }
    return this.langdock.translate(
      texts,
      language,
      examples,
      additionalContext,
    );
  }
}
