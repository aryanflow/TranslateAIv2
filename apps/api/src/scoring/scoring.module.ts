import { Module } from '@nestjs/common';
import { LlmModule } from '../llm/llm.module';
import { LangdockOpenAiScorerService } from './langdock-openai-scorer.service';
import { GeminiLangdockScorerService } from './gemini-langdock-scorer.service';
import { ScoringService } from './scoring.service';

@Module({
  imports: [LlmModule],
  providers: [
    LangdockOpenAiScorerService,
    GeminiLangdockScorerService,
    ScoringService,
  ],
  exports: [
    ScoringService,
    LangdockOpenAiScorerService,
    GeminiLangdockScorerService,
  ],
})
export class ScoringModule {}
