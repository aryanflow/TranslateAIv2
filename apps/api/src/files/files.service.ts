import {
  BadGatewayException,
  Injectable,
  Logger,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  GetObjectCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { randomUUID } from 'crypto';

@Injectable()
export class FilesService {
  private readonly logger = new Logger(FilesService.name);
  private readonly client: S3Client;
  private readonly bucket: string;
  private readonly uploadPrefix: string;
  /** Custom S3-compatible base URL (e.g. MinIO); when set, explicit access keys are required for signing. */
  private readonly customEndpoint?: string;
  private readonly hasExplicitCredentials: boolean;

  constructor(private readonly config: ConfigService) {
    const region = this.config.get<string>('S3_REGION', 'us-east-1');
    const endpoint = this.config.get<string>('S3_ENDPOINT');
    const accessKeyId = this.config.get<string>('S3_ACCESS_KEY_ID');
    const secretAccessKey = this.config.get<string>('S3_SECRET_ACCESS_KEY');
    this.customEndpoint = endpoint?.trim() || undefined;
    this.hasExplicitCredentials = Boolean(accessKeyId && secretAccessKey);
    this.bucket = this.config.get<string>(
      'S3_BUCKET',
      'aptos-translate-uploads',
    );
    this.uploadPrefix = this.config.get<string>('S3_UPLOAD_PREFIX', 'uploads');

    this.client = new S3Client({
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

  private assertCanSign(): void {
    if (this.customEndpoint && !this.hasExplicitCredentials) {
      throw new BadGatewayException(
        'Object storage is misconfigured: S3_ENDPOINT is set but S3_ACCESS_KEY_ID / S3_SECRET_ACCESS_KEY are missing. For MinIO, set both keys (see apps/api/.env.example).',
      );
    }
  }

  private mapSignError(operation: string, err: unknown): never {
    const raw = err instanceof Error ? err.message : String(err);
    this.logger.error(`${operation} failed: ${raw}`, err instanceof Error ? err.stack : undefined);
    throw new BadGatewayException(
      `${operation} failed: ${raw}. If using MinIO locally: run \`docker compose --profile full up -d minio\`, create bucket "${this.bucket}" in the console (:9001), and point S3_ENDPOINT to http://127.0.0.1:9000 with matching keys.`,
    );
  }

  /** Uploads and translated results are keyed by tenant for presigned download safety. */
  tenantOwnsObjectKey(tenantId: string, key: string): boolean {
    const upload = `${this.uploadPrefix}/${tenantId}/`;
    const results = `results/${tenantId}/`;
    return key.startsWith(upload) || key.startsWith(results);
  }

  async createPresignedPutUrl(
    tenantId: string,
    fileName: string,
    contentType: string,
  ): Promise<{ uploadUrl: string; fileKey: string }> {
    this.assertCanSign();
    const safeName = fileName.replace(/[^a-zA-Z0-9._-]/g, '_');
    const fileKey = `${this.uploadPrefix}/${tenantId}/${randomUUID()}-${safeName}`;

    const command = new PutObjectCommand({
      Bucket: this.bucket,
      Key: fileKey,
      ContentType: contentType,
    });

    const expiresIn = Number(
      this.config.get<string>('S3_PRESIGN_EXPIRES') ?? '3600',
    );
    let uploadUrl: string;
    try {
      uploadUrl = await getSignedUrl(this.client, command, { expiresIn });
    } catch (err) {
      this.mapSignError('Presigned PUT URL', err);
    }

    return { uploadUrl, fileKey };
  }

  async createPresignedGetUrl(key: string): Promise<string> {
    this.assertCanSign();
    const command = new GetObjectCommand({
      Bucket: this.bucket,
      Key: key,
    });
    const expiresIn = Number(
      this.config.get<string>('S3_PRESIGN_GET_EXPIRES') ?? '3600',
    );
    try {
      return await getSignedUrl(this.client, command, { expiresIn });
    } catch (err) {
      this.mapSignError('Presigned GET URL', err);
    }
  }

  async getObjectBytes(key: string): Promise<Buffer> {
    const out = await this.client.send(
      new GetObjectCommand({
        Bucket: this.bucket,
        Key: key,
      }),
    );
    if (!out.Body) {
      throw new Error(`S3 object empty: ${key}`);
    }
    return Buffer.from(await out.Body.transformToByteArray());
  }

  async putObjectBytes(
    key: string,
    body: Buffer,
    contentType: string,
  ): Promise<void> {
    await this.client.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: key,
        Body: body,
        ContentType: contentType,
      }),
    );
  }
}
