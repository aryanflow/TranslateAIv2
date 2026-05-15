import {
  Body,
  Controller,
  BadRequestException,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import {
  ApiOperation,
  ApiProperty,
  ApiPropertyOptional,
  ApiSecurity,
  ApiTags,
} from '@nestjs/swagger';
import { IsOptional, IsString, MinLength } from 'class-validator';
import { GlossaryService } from './glossary.service';
import { TenantGuard } from '../common/guards/tenant.guard';
import { TenantId } from '../common/decorators/tenant-id.decorator';
import { DefaultPagePipe } from './default-page.pipe';

class TermCreateDto {
  @ApiProperty()
  @IsString()
  @MinLength(2)
  sourceLang!: string;

  @ApiProperty()
  @IsString()
  @MinLength(2)
  targetLang!: string;

  @ApiProperty()
  @IsString()
  @MinLength(1)
  sourceTerm!: string;

  @ApiProperty()
  @IsString()
  @MinLength(1)
  preferredTarget!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  notes?: string;
}

class TermPatchDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MinLength(1)
  sourceTerm?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MinLength(1)
  preferredTarget?: string;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @IsString()
  notes?: string | null;
}

@ApiTags('glossary')
@Controller('glossary')
@UseGuards(TenantGuard)
@ApiSecurity('tenant-id')
export class GlossaryController {
  constructor(private readonly glossary: GlossaryService) {}

  @Get()
  @ApiOperation({
    summary:
      'List term preferences for a source/target (paginated, searchable)',
  })
  getList(
    @Query('sourceLang') sourceLang: string,
    @Query('targetLang') targetLang: string,
    @Query('page', new DefaultPagePipe()) page: number,
    @Query('search') search: string | undefined,
    @TenantId() tenantId: string,
  ) {
    if (!sourceLang?.trim() || !targetLang?.trim()) {
      throw new BadRequestException('sourceLang and targetLang are required');
    }
    return this.glossary.list(
      tenantId,
      sourceLang.trim(),
      targetLang.trim(),
      page,
      search,
    );
  }

  @Post()
  @ApiOperation({
    summary: 'Create term preference (source phrase → preferred POS wording)',
  })
  postGlossary(@Body() body: TermCreateDto, @TenantId() tenantId: string) {
    return this.glossary.addTerm(tenantId, body);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Update a term row' })
  patchGlossary(
    @Param('id') id: string,
    @Body() body: TermPatchDto,
    @TenantId() tenantId: string,
  ) {
    return this.glossary.updateTerm(tenantId, id, body);
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Delete a term row' })
  deleteGlossary(@Param('id') id: string, @TenantId() tenantId: string) {
    return this.glossary.deleteTerm(tenantId, id);
  }
}
