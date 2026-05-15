import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Sse,
  UseGuards,
  MessageEvent,
} from '@nestjs/common';
import { ApiOperation, ApiSecurity, ApiTags } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsArray,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  Min,
  MinLength,
  Max,
  MaxLength,
  ArrayMinSize,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Observable } from 'rxjs';
import { JobsService } from './jobs.service';
import { TenantGuard } from '../common/guards/tenant.guard';
import { TenantId } from '../common/decorators/tenant-id.decorator';
import { JobEventsService } from '../common/job-events/job-events.service';

class CreateJobDto {
  @ApiProperty()
  @IsString()
  @MinLength(1)
  fileKey!: string;

  @ApiProperty()
  @IsString()
  @MinLength(2)
  @MaxLength(32)
  sourceLang!: string;

  @ApiProperty({ type: [String] })
  @IsArray()
  @ArrayMinSize(1)
  @IsString({ each: true })
  targetLangs!: string[];

  @ApiProperty({ required: false, default: 200 })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(2000)
  batchSize = 200;

  @ApiPropertyOptional({
    description: 'Judge threshold; below triggers re-translation',
  })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  @Max(1)
  minTranslationScore?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(20)
  maxBatchRetries?: number;
}

@ApiTags('jobs')
@Controller('jobs')
@UseGuards(TenantGuard)
@ApiSecurity('tenant-id')
export class JobsController {
  constructor(
    private readonly jobs: JobsService,
    private readonly jobEventsService: JobEventsService,
  ) {}

  @Post()
  @ApiOperation({
    summary:
      'Create job — BullMQ workers stream from S3, chunk, dual-LLM pipeline',
  })
  postJob(@Body() body: CreateJobDto, @TenantId() tenantId: string) {
    return this.jobs.createJob(tenantId, {
      fileKey: body.fileKey,
      sourceLang: body.sourceLang,
      targetLangs: body.targetLangs,
      batchSize: body.batchSize,
      minTranslationScore: body.minTranslationScore,
      maxBatchRetries: body.maxBatchRetries,
    });
  }

  @Sse(':id/events')
  @ApiOperation({ summary: 'SSE: batch %, last judge scores, retry notices' })
  jobEvents(@Param('id') id: string): Observable<MessageEvent> {
    return new Observable<MessageEvent>((subscriber) => {
      const sub = this.jobEventsService.subscribeToJob(id, (msg) => {
        subscriber.next({ data: msg });
      });
      return () => {
        void sub.quit();
      };
    });
  }

  @Get(':id/batches/:batchId')
  @ApiOperation({
    summary: 'Per-batch diagnostics: scores, last error, retry reason',
  })
  getBatch(
    @Param('id') jobId: string,
    @Param('batchId') batchId: string,
    @TenantId() tenantId: string,
  ) {
    return this.jobs.getBatch(tenantId, jobId, batchId);
  }

  @Get(':id/result')
  @ApiOperation({ summary: 'Artifacts + quality summary when job completes' })
  getResult(@Param('id') id: string, @TenantId() tenantId: string) {
    return this.jobs.getResult(tenantId, id);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Job state, per-target progress, score histogram' })
  getOne(@Param('id') id: string, @TenantId() tenantId: string) {
    return this.jobs.getJob(tenantId, id);
  }
}
