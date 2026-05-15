import { Body, Controller, Post, UseGuards } from '@nestjs/common';
import { ApiOperation, ApiSecurity, ApiTags } from '@nestjs/swagger';
import { IsString, MinLength } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';
import { presignedUrlRequestSchema } from '@aptos-translate/contracts';
import { TenantGuard } from '../common/guards/tenant.guard';
import { TenantId } from '../common/decorators/tenant-id.decorator';
import { FilesService } from './files.service';

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

@ApiTags('files')
@Controller('files')
@UseGuards(TenantGuard)
@ApiSecurity('tenant-id')
export class FilesController {
  constructor(private readonly files: FilesService) {}

  @Post('presigned-url')
  @ApiOperation({
    summary:
      'S3-compatible presigned upload URL (direct browser → object storage)',
  })
  async postPresignedUrl(
    @Body() body: PresignedUrlRequestDto,
    @TenantId() tenantId: string,
  ): Promise<{ uploadUrl: string; fileKey: string }> {
    const parsed = presignedUrlRequestSchema.parse(body);
    return this.files.createPresignedPutUrl(
      tenantId,
      parsed.fileName,
      parsed.contentType,
    );
  }
}
