import { Injectable } from '@nestjs/common';
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
  private readonly client: S3Client;
  private readonly bucket: string;
  private readonly uploadPrefix: string;

  constructor(private readonly config: ConfigService) {
    const region = this.config.get<string>('S3_REGION', 'us-east-1');
    const endpoint = this.config.get<string>('S3_ENDPOINT');
    const accessKeyId = this.config.get<string>('S3_ACCESS_KEY_ID');
    const secretAccessKey = this.config.get<string>('S3_SECRET_ACCESS_KEY');
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
    const uploadUrl = await getSignedUrl(this.client, command, { expiresIn });

    return { uploadUrl, fileKey };
  }

  async createPresignedGetUrl(key: string): Promise<string> {
    const command = new GetObjectCommand({
      Bucket: this.bucket,
      Key: key,
    });
    const expiresIn = Number(
      this.config.get<string>('S3_PRESIGN_GET_EXPIRES') ?? '3600',
    );
    return getSignedUrl(this.client, command, { expiresIn });
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
