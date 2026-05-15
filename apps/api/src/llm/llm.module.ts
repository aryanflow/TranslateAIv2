import { Module } from '@nestjs/common';
import { LangdockGoogleGeminiClient } from './langdock-google-gemini.client';
import { GeminiLangdockTranslatorService } from './gemini-langdock-translator.service';
import { LangdockOpenAiTranslatorService } from './langdock-openai-translator.service';
import { TranslationRouterService } from './translation-router.service';

@Module({
  providers: [
    LangdockGoogleGeminiClient,
    GeminiLangdockTranslatorService,
    LangdockOpenAiTranslatorService,
    TranslationRouterService,
  ],
  exports: [
    LangdockGoogleGeminiClient,
    GeminiLangdockTranslatorService,
    LangdockOpenAiTranslatorService,
    TranslationRouterService,
  ],
})
export class LlmModule {}
