import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { HeadBucketCommand, S3Client } from '@aws-sdk/client-s3';
import Redis from 'ioredis';
import { PrismaService } from '../common/prisma/prisma.service';
import { BedrockConverseService } from '../llm/bedrock-converse.service';
import { BedrockTranslatorService } from '../llm/bedrock-translator.service';
import { BedrockScorerService } from '../scoring/bedrock-scorer.service';

type DepStatus = 'up' | 'down' | 'degraded' | 'unknown';

@Injectable()
export class HealthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly converse: BedrockConverseService,
    private readonly bedrockTranslator: BedrockTranslatorService,
    private readonly bedrockScorer: BedrockScorerService,
  ) {}

  getLive() {
    return { status: 'up' as const, process: 'aptos-translate-api' };
  }

  async getReady() {
    let postgres: { status: 'up' | 'down'; reason?: string } = {
      status: 'down',
    };
    try {
      await this.prisma.$queryRaw`SELECT 1`;
      postgres = { status: 'up' };
    } catch (e) {
      postgres = {
        status: 'down',
        reason: e instanceof Error ? e.message : 'unknown',
      };
    }

    let redis: { status: 'up' | 'down'; reason?: string; latencyMs?: number } =
      { status: 'down' };
    const rurl = this.config.get<string>('REDIS_URL', 'redis://127.0.0.1:6379');
    const r = new Redis(rurl, { maxRetriesPerRequest: null });
    try {
      const t0 = performance.now();
      await r.ping();
      redis = { status: 'up', latencyMs: Math.round(performance.now() - t0) };
    } catch (e) {
      redis = {
        status: 'down',
        reason: e instanceof Error ? e.message : 'unknown',
      };
    } finally {
      await r.quit().catch(() => undefined);
    }

    const ready = postgres.status === 'up' && redis.status === 'up';
    return {
      status: ready ? ('ready' as const) : ('not_ready' as const),
      postgres,
      redis,
    };
  }

  async getDeps() {
    let postgres: {
      status: DepStatus;
      latencyMs?: number;
      lastError?: string | null;
    } = {
      status: 'down',
    };
    try {
      const t0 = performance.now();
      await this.prisma.$queryRaw`SELECT 1`;
      postgres = {
        status: 'up',
        latencyMs: Math.round(performance.now() - t0),
        lastError: null,
      };
    } catch (e) {
      postgres = {
        status: 'down',
        lastError: e instanceof Error ? e.message : 'unknown',
      };
    }

    let redis: {
      status: DepStatus;
      latencyMs?: number;
      lastError?: string | null;
    } = {
      status: 'unknown',
    };
    const rurl = this.config.get<string>('REDIS_URL', 'redis://127.0.0.1:6379');
    const redisConn = new Redis(rurl, { maxRetriesPerRequest: null });
    try {
      const t0 = performance.now();
      await redisConn.ping();
      redis = {
        status: 'up',
        latencyMs: Math.round(performance.now() - t0),
        lastError: null,
      };
    } catch (e) {
      redis = {
        status: 'down',
        lastError: e instanceof Error ? e.message : 'unknown',
      };
    } finally {
      await redisConn.quit().catch(() => undefined);
    }

    let s3: {
      status: DepStatus;
      latencyMs?: number;
      lastError?: string | null;
    } = {
      status: 'unknown',
    };
    try {
      const client = this.buildS3Client();
      const bucket = this.config.get<string>(
        'S3_BUCKET',
        'aptos-translate-uploads',
      );
      const t0 = performance.now();
      await client.send(new HeadBucketCommand({ Bucket: bucket }));
      s3 = {
        status: 'up',
        latencyMs: Math.round(performance.now() - t0),
        lastError: null,
      };
    } catch (e) {
      s3 = {
        status: 'down',
        lastError: e instanceof Error ? e.message : 'unknown',
      };
    }

    const translator = await this.probeTranslator();
    const judge = await this.probeJudge();

    return {
      postgres,
      redis,
      s3,
      llm: {
        translator,
        judge,
      },
    };
  }

  async putActiveModels(
    tenantId: string,
    body: { translator?: string; scorer?: string },
  ): Promise<{
    tenantId: string;
    activeTranslator: string;
    activeScorer: string;
  }> {
    if (body.translator == null && body.scorer == null) {
      const tenant = await this.prisma.tenant.findUniqueOrThrow({
        where: { id: tenantId },
      });
      return {
        tenantId,
        activeTranslator: tenant.activeTranslator,
        activeScorer: tenant.activeScorer,
      };
    }

    const tenant = await this.prisma.tenant.update({
      where: { id: tenantId },
      data: {
        ...(body.translator != null
          ? { activeTranslator: body.translator }
          : {}),
        ...(body.scorer != null ? { activeScorer: body.scorer } : {}),
      },
    });
    return {
      tenantId,
      activeTranslator: tenant.activeTranslator,
      activeScorer: tenant.activeScorer,
    };
  }

  private buildS3Client(): S3Client {
    const region = this.config.get<string>('S3_REGION', 'us-east-1');
    const endpoint = this.config.get<string>('S3_ENDPOINT');
    const accessKeyId = this.config.get<string>('S3_ACCESS_KEY_ID');
    const secretAccessKey = this.config.get<string>('S3_SECRET_ACCESS_KEY');
    return new S3Client({
      region,
      ...(endpoint
        ? {
            endpoint,
            forcePathStyle:
              this.config.get<string>('S3_FORCE_PATH_STYLE', 'true') === 'true',
            credentials:
              accessKeyId && secretAccessKey
                ? { accessKeyId, secretAccessKey }
                : undefined,
          }
        : accessKeyId && secretAccessKey
          ? { credentials: { accessKeyId, secretAccessKey } }
          : {}),
    });
  }

  private async probeTranslator(): Promise<{
    /** Provider slug (legacy consumers); prefer `provider` + `modelId`. */
    id: string;
    provider: 'bedrock';
    modelId: string;
    status: DepStatus;
    latencyMs?: number;
    lastError: string | null;
  }> {
    const mid = this.bedrockTranslator.modelId();
    if (!mid) {
      return {
        id: 'bedrock',
        provider: 'bedrock',
        modelId: '',
        status: 'down',
        lastError: 'Bedrock translation model id could not be resolved',
      };
    }
    try {
      const t0 = performance.now();
      await this.converse.converseText({
        modelId: mid,
        system: 'Reply with exactly: OK',
        user: 'Ping.',
        maxTokens: 64,
        temperature: 0,
      });
      return {
        id: 'bedrock',
        provider: 'bedrock',
        modelId: mid,
        status: 'up',
        latencyMs: Math.round(performance.now() - t0),
        lastError: null,
      };
    } catch (e) {
      return {
        id: 'bedrock',
        provider: 'bedrock',
        modelId: mid,
        status: 'degraded',
        lastError: e instanceof Error ? e.message : 'unknown',
      };
    }
  }

  private async probeJudge(): Promise<{
    id: string;
    provider: 'bedrock';
    modelId: string;
    status: DepStatus;
    latencyMs?: number;
    lastError: string | null;
  }> {
    const mid = this.bedrockScorer.modelId();
    if (!mid) {
      return {
        id: 'bedrock',
        provider: 'bedrock',
        modelId: '',
        status: 'down',
        lastError: 'Bedrock scoring model id could not be resolved',
      };
    }
    try {
      const t0 = performance.now();
      await this.converse.converseText({
        modelId: mid,
        system: 'Reply with exactly: OK',
        user: 'Ping.',
        maxTokens: 64,
        temperature: 0,
      });
      return {
        id: 'bedrock',
        provider: 'bedrock',
        modelId: mid,
        status: 'up',
        latencyMs: Math.round(performance.now() - t0),
        lastError: null,
      };
    } catch (e) {
      return {
        id: 'bedrock',
        provider: 'bedrock',
        modelId: mid,
        status: 'degraded',
        lastError: e instanceof Error ? e.message : 'unknown',
      };
    }
  }
}
