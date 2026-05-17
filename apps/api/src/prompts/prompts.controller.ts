import { Body, Controller, Get, Put, UseGuards, Param } from '@nestjs/common';
import {
  ApiOperation,
  ApiProperty,
  ApiPropertyOptional,
  ApiSecurity,
  ApiTags,
} from '@nestjs/swagger';
import { IsInt, IsOptional, IsString, Min } from 'class-validator';
import { PromptsService } from './prompts.service';
import { TenantGuard } from '../common/guards/tenant.guard';
import { TenantId } from '../common/decorators/tenant-id.decorator';

class PutPromptsBodyDto {
  @ApiProperty({
    description:
      'Optional tenant system overlay (after the shipped enterprise localization prompt)',
  })
  @IsString()
  systemText!: string;

  @ApiProperty({
    description:
      'Custom user-layer template — sections [A]/[B]/[C]; supports {{glossary_block}}, {{terminology_reference}}, {{source_lang}}, {{target_lang}}, {{target_language_name}}',
  })
  @IsString()
  userText!: string;

  @ApiPropertyOptional({
    description: 'Optimistic concurrency against `version`',
  })
  @IsOptional()
  @IsInt()
  @Min(0)
  expectedVersion?: number;
}

@ApiTags('prompts')
@Controller('prompts')
@UseGuards(TenantGuard)
@ApiSecurity('tenant-id')
export class PromptsController {
  constructor(private readonly prompts: PromptsService) {}

  @Get('baseline')
  @ApiOperation({
    summary:
      'Shipped localization engine system prompt + default DB templates (read-only reference)',
  })
  getBaseline() {
    return this.prompts.getProductBaseline();
  }

  @Get(':sourceLang/:targetLang')
  @ApiOperation({
    summary:
      'Get system + user prompt pair (falls back to product defaults when not saved)',
  })
  getOne(
    @Param('sourceLang') sourceLang: string,
    @Param('targetLang') targetLang: string,
    @TenantId() tenantId: string,
  ) {
    return this.prompts.getTemplate(tenantId, sourceLang, targetLang);
  }

  @Put(':sourceLang/:targetLang')
  @ApiOperation({
    summary: 'Upsert per language-pair; optional optimistic `expectedVersion`',
  })
  putOne(
    @Param('sourceLang') sourceLang: string,
    @Param('targetLang') targetLang: string,
    @Body() body: PutPromptsBodyDto,
    @TenantId() tenantId: string,
  ) {
    return this.prompts.putTemplate(tenantId, sourceLang, targetLang, body);
  }
}
