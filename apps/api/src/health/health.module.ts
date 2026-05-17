import { Module } from '@nestjs/common';
import { HealthController } from './health.controller';
import { HealthService } from './health.service';
import { LlmModule } from '../llm/llm.module';
import { ScoringModule } from '../scoring/scoring.module';

@Module({
  imports: [LlmModule, ScoringModule],
  controllers: [HealthController],
  providers: [HealthService],
})
export class HealthModule {}
