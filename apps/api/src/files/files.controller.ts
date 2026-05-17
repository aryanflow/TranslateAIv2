import {
  Body,
  Controller,
  ForbiddenException,
  Post,
  UseGuards,
} from '@nestjs/common';
import { ApiOperation, ApiSecurity, ApiTags } from '@nestjs/swagger';
import {
  IsArray,
  IsInt,
  IsOptional,
  IsString,
  Max,
  Min,
  MinLength,
  ArrayMaxSize,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { TenantGuard } from '../common/guards/tenant.guard';
import { TenantId } from '../common/decorators/tenant-id.decorator';
import { FilesService } from './files.service';
import { ExtractorsService } from '../extractors/extractors.service';
import { inferFormatFromKey } from '../extractors/extraction.types';
import {
  listCsvColumnNames,
  suggestCsvStringColumns,
} from '../extractors/csv.format';

class PresignedUrlRequestDto {
  @ApiProperty()
  @IsString()
  @MinLength(1)
  fileName!: string;

  @ApiProperty()
  @IsString()
  @MinLength(1)
  contentType!: string;
}

class PreviewExtractDto {
  @ApiProperty({ description: 'S3 object key from presigned upload response' })
  @IsString()
  @MinLength(3)
  fileKey!: string;

  @ApiPropertyOptional({
    description: 'Max strings returned in preview (capped server-side)',
    default: 200,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(500)
  limit?: number;

  @ApiPropertyOptional({
    description:
      'CSV: restrict extraction to these header names (must match file). Omit for auto-detect.',
    type: [String],
  })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(64)
  @IsString({ each: true })
  selectedColumns?: string[];
}

class PresignedGetDto {
  @ApiProperty({ description: 'S3 object key (upload or translated result)' })
  @IsString()
  @MinLength(3)
  key!: string;
}

@ApiTags('files')
@Controller('files')
@UseGuards(TenantGuard)
@ApiSecurity('tenant-id')
export class FilesController {
  constructor(
    private readonly files: FilesService,
    private readonly extractors: ExtractorsService,
  ) {}

  @Post('presigned-url')
  @ApiOperation({
    summary:
      'S3-compatible presigned upload URL (direct browser → object storage)',
  })
  async postPresignedUrl(
    @Body() body: PresignedUrlRequestDto,
    @TenantId() tenantId: string,
  ): Promise<{ uploadUrl: string; fileKey: string }> {
    return this.files.createPresignedPutUrl(
      tenantId,
      body.fileName,
      body.contentType,
    );
  }

  @Post('preview')
  @ApiOperation({
    summary:
      'Extract strings from an uploaded object for UI preview (same pipeline as jobs)',
  })
  async previewExtract(
    @Body() body: PreviewExtractDto,
    @TenantId() tenantId: string,
  ): Promise<{
    format: string;
    totalStrings: number;
    preview: string[];
    previewStringIds: number[];
    previewTruncated: boolean;
    csvHeaders?: string[];
    csvSuggestedColumns?: string[];
  }> {
    if (!this.files.tenantOwnsObjectKey(tenantId, body.fileKey)) {
      throw new ForbiddenException('Key does not belong to this tenant');
    }
    const buf = await this.files.getObjectBytes(body.fileKey);
    const format = inferFormatFromKey(body.fileKey);
    let csvHeaders: string[] | undefined;
    let csvSuggestedColumns: string[] | undefined;
    if (format === 'csv') {
      csvHeaders = listCsvColumnNames(buf);
      csvSuggestedColumns = suggestCsvStringColumns(buf);
    }
    const selected =
      body.selectedColumns?.length && format === 'csv' && csvHeaders?.length
        ? body.selectedColumns.filter((c) => csvHeaders.includes(c))
        : body.selectedColumns;
    const extracted = this.extractors.extract(buf, body.fileKey, {
      selectedColumns: selected,
    });
    const limit = Math.min(body.limit ?? 200, 500);
    const preview = extracted.originals.slice(0, limit);
    const previewStringIds = extracted.stringIds.slice(0, limit);
    return {
      format: extracted.format,
      totalStrings: extracted.originals.length,
      preview,
      previewStringIds,
      previewTruncated: extracted.originals.length > preview.length,
      ...(format === 'csv'
        ? { csvHeaders, csvSuggestedColumns }
        : {}),
    };
  }

  @Post('download-url')
  @ApiOperation({ summary: 'Presigned GET for upload or result objects' })
  async presignedGet(
    @Body() body: PresignedGetDto,
    @TenantId() tenantId: string,
  ): Promise<{ url: string }> {
    if (!this.files.tenantOwnsObjectKey(tenantId, body.key)) {
      throw new ForbiddenException('Key does not belong to this tenant');
    }
    const url = await this.files.createPresignedGetUrl(body.key);
    return { url };
  }
}
