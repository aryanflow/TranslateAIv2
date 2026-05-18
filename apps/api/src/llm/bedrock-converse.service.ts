import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  BedrockRuntimeClient,
  ConverseCommand,
} from '@aws-sdk/client-bedrock-runtime';

@Injectable()
export class BedrockConverseService {
  private readonly logger = new Logger(BedrockConverseService.name);
  private readonly client: BedrockRuntimeClient;

  constructor(private readonly config: ConfigService) {
    const region =
      this.config.get<string>('AWS_REGION') ??
      this.config.get<string>('S3_REGION', 'us-east-1');
    this.client = new BedrockRuntimeClient({ region });
  }

  get defaultRegion(): string {
    return (
      this.config.get<string>('AWS_REGION') ??
      this.config.get<string>('S3_REGION', 'us-east-1')
    );
  }

  isConfigured(): boolean {
    const mid =
      this.config.get<string>('BEDROCK_TRANSLATION_MODEL_ID') ??
      this.config.get<string>('BEDROCK_MODEL_ID', '');
    return Boolean(mid?.trim());
  }

  async converseText(params: {
    modelId: string;
    system: string;
    user: string;
    maxTokens?: number;
    temperature?: number;
    /** When set (e.g. health probes), avoids long multi-attempt backoff for faster /health/deps. */
    maxRetriesOverride?: number;
  }): Promise<string> {
    const maxRetries = Math.max(
      1,
      params.maxRetriesOverride ??
        Number(this.config.get<string>('MAX_RETRIES', '3')),
    );
    const baseDelay = Number(this.config.get<string>('RETRY_DELAY_BASE', '2'));
    const maxDelay = Number(this.config.get<string>('MAX_RETRY_DELAY', '10'));

    let last: unknown;
    for (let attempt = 0; attempt < maxRetries; attempt++) {
      try {
        const cmd = new ConverseCommand({
          modelId: params.modelId,
          system: [{ text: params.system }],
          messages: [
            { role: 'user', content: [{ text: params.user }] },
          ],
          inferenceConfig: {
            maxTokens: params.maxTokens ?? 8192,
            temperature: params.temperature ?? 0.2,
          },
        });
        const resp = await this.client.send(cmd);
        const blocks = resp.output?.message?.content;
        const text = blocks?.map((b) => ('text' in b ? b.text : '')).join('');
        if (!text?.trim()) {
          if (attempt < maxRetries - 1) {
            const delay = Math.min(baseDelay * 2 ** attempt, maxDelay);
            this.logger.warn(
              `Bedrock returned empty output; retry ${attempt + 1}/${maxRetries} after ${delay}s`,
            );
            await new Promise((r) => setTimeout(r, delay * 1000));
            continue;
          }
          throw new Error('Empty Bedrock Converse response');
        }
        return text;
      } catch (e) {
        last = e;
        const retryable =
          e instanceof Error &&
          (/Throttling|timeout|ECONNRESET|fetch|Empty Bedrock Converse response/i.test(
            e.message,
          ) ||
            e.name === 'ThrottlingException');
        if (attempt < maxRetries - 1 && retryable) {
          const delay = Math.min(baseDelay * 2 ** attempt, maxDelay);
          this.logger.warn(
            `Bedrock converse retry ${attempt + 1}/${maxRetries} after ${delay}s: ${e}`,
          );
          await new Promise((r) => setTimeout(r, delay * 1000));
          continue;
        }
        throw e;
      }
    }
    throw last instanceof Error ? last : new Error(String(last));
  }
}
