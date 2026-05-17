import { Module } from '@nestjs/common';
import { LlmModule } from '../llm/llm.module';
import { BedrockScorerService } from './bedrock-scorer.service';
import { ScoringService } from './scoring.service';

@Module({
  imports: [LlmModule],
  providers: [BedrockScorerService, ScoringService],
  exports: [ScoringService, BedrockScorerService],
})
export class ScoringModule {}
