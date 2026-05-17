import { Body, Controller, Get, Put, UseGuards } from '@nestjs/common';
import { ApiOperation, ApiSecurity, ApiTags } from '@nestjs/swagger';
import { IsOptional, IsString, MinLength } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { activeModelsBodySchema } from '@aptos-translate/contracts';
import { TenantGuard } from '../common/guards/tenant.guard';
import { TenantId } from '../common/decorators/tenant-id.decorator';
import { HealthService } from './health.service';

class PutActiveModelsDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MinLength(1)
  translator?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MinLength(1)
  scorer?: string;
}

@ApiTags('health')
@Controller('health')
export class HealthController {
  constructor(private readonly health: HealthService) {}

  @Get('live')
  @ApiOperation({ summary: 'Liveness: process is running' })
  getLive() {
    return this.health.getLive();
  }

  @Get('ready')
  @ApiOperation({ summary: 'Readiness: Postgres + Redis within timeout' })
  getReady() {
    return this.health.getReady();
  }

  @Get('deps')
  @ApiOperation({
    summary:
      'Dependency grid for the dashboard: Postgres, Redis, S3, LLM roles',
  })
  getDeps() {
    return this.health.getDeps();
  }

  @Get('llm')
  @ApiOperation({
    summary:
      'Legacy subset: forwards to translator/judge slice of GET /health/deps',
  })
  async getLlm() {
    const deps = await this.health.getDeps();
    const llm = deps.llm as {
      translator: { id: string; status: string; latencyMs?: number };
      judge: { id: string; status: string; latencyMs?: number };
    };
    return {
      bedrockTranslator: { ...llm.translator, role: 'translator' as const },
      bedrockJudge: { ...llm.judge, role: 'judge' as const },
    };
  }

  @Put('active-models')
  @UseGuards(TenantGuard)
  @ApiSecurity('tenant-id')
  @ApiOperation({ summary: 'Set tenant-level activeTranslator / activeScorer' })
  putActiveModels(
    @Body() body: PutActiveModelsDto,
    @TenantId() tenantId: string,
  ) {
    const parsed = activeModelsBodySchema.parse(body);
    return this.health.putActiveModels(tenantId, {
      translator: parsed.translator,
      scorer: parsed.scorer,
    });
  }
}
