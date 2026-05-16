import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Injectable } from '@nestjs/common';

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
    langdockConfigured: boolean;
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
    const token =
      process.env.LANGDOCK_BEARER_TOKEN ?? process.env.LANGDOCK_API_KEY ?? '';
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
      langdockConfigured: Boolean(token.trim()),
    };
  }
}
