import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Injectable } from '@nestjs/common';
import {
  DEFAULT_BEDROCK_SCORING_MODEL_ID,
  DEFAULT_BEDROCK_TRANSLATION_MODEL_ID,
} from '../config/bedrock-defaults';

@Injectable()
export class VersionService {
  /** Resolved from compiled `dist/version/` → `apps/api/CHANGELOG.md`. */
  private changelogPath(): string {
    return join(__dirname, '..', '..', 'CHANGELOG.md');
  }

  getChangelog(): string {
    const path = this.changelogPath();
    try {
      if (!existsSync(path)) {
        return '';
      }
      return readFileSync(path, 'utf8');
    } catch {
      return '';
    }
  }

  getApiBuild(): {
    service: string;
    version: string;
    gitSha: string | null;
    buildTime: string | null;
    node: string;
    bedrockTranslationModelId: string;
    bedrockScoringModelId: string;
  } {
    let version = '0.0.0';
    try {
      const path = join(process.cwd(), 'package.json');
      const json = JSON.parse(readFileSync(path, 'utf8')) as {
        version?: string;
      };
      version = json.version ?? version;
    } catch {
      // dist cwd may differ; keep default
    }
    const bedrockTranslationModelId =
      process.env.BEDROCK_TRANSLATION_MODEL_ID ??
      process.env.BEDROCK_MODEL_ID ??
      DEFAULT_BEDROCK_TRANSLATION_MODEL_ID;
    const bedrockScoringModelId =
      process.env.BEDROCK_SCORING_MODEL_ID ?? DEFAULT_BEDROCK_SCORING_MODEL_ID;
    return {
      service: 'aptos-translate-api',
      version,
      gitSha:
        process.env.GIT_SHA ??
        process.env.GIT_COMMIT ??
        process.env.VERCEL_GIT_COMMIT_SHA ??
        process.env.GITHUB_SHA ??
        null,
      buildTime: process.env.BUILD_TIME ?? null,
      node: process.version,
      bedrockTranslationModelId,
      bedrockScoringModelId,
    };
  }
}
