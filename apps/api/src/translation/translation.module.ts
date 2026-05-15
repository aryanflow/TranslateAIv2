import { Module } from '@nestjs/common';
import { LlmModule } from '../llm/llm.module';
import { ExtractorsModule } from '../extractors/extractors.module';
import { RegeneratorsModule } from '../regenerators/regenerators.module';
import { ScoringModule } from '../scoring/scoring.module';
import { FilesModule } from '../files/files.module';
import { PromptsModule } from '../prompts/prompts.module';
import { JobEventsModule } from '../common/job-events/job-events.module';
import { TranslationOrchestratorService } from './translation-orchestrator.service';

/**
 * Batching orchestration, BullMQ consumers, and dual-LLM pipeline.
 */
@Module({
  imports: [
    LlmModule,
    ExtractorsModule,
    RegeneratorsModule,
    ScoringModule,
    FilesModule,
    JobEventsModule,
    PromptsModule,
  ],
  providers: [TranslationOrchestratorService],
  exports: [
    LlmModule,
    ExtractorsModule,
    RegeneratorsModule,
    ScoringModule,
    TranslationOrchestratorService,
  ],
})
export class TranslationModule {}
