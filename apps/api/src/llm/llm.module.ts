import { Module } from '@nestjs/common';
import { BedrockConverseService } from './bedrock-converse.service';
import { BedrockTranslatorService } from './bedrock-translator.service';
import { TranslationRouterService } from './translation-router.service';

@Module({
  providers: [
    BedrockConverseService,
    BedrockTranslatorService,
    TranslationRouterService,
  ],
  exports: [
    BedrockConverseService,
    BedrockTranslatorService,
    TranslationRouterService,
  ],
})
export class LlmModule {}
