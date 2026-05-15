import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Injectable } from '@nestjs/common';

function firstNonEmpty(
  ...values: (string | undefined)[]
): string | null {
  for (const v of values) {
    const t = v?.trim();
    if (t) {
      return t;
    }
  }
  return null;
}

function shortGitSha(sha: string | null): string | null {
  if (!sha) {
    return null;
  }
  return sha.length >= 7 ? sha.slice(0, 7) : sha;
}

@Injectable()
export class VersionService {
  /** Resolved from compiled `dist/version/` → `apps/api/CHANGELOG.md`. */
  private changelogPath(): string {
    return join(__dirname, '..', '..', 'CHANGELOG.md');
  }

  private resolveGitSha(): string | null {
    return firstNonEmpty(
      process.env.GIT_SHA,
      process.env.GIT_COMMIT,
      process.env.VERCEL_GIT_COMMIT_SHA,
      process.env.GITHUB_SHA,
      process.env.CI_COMMIT_SHA,
      process.env.SOURCE_VERSION,
    );
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
    /** @deprecated Prefer `commit.sha` — kept for existing clients. */
    gitSha: string | null;
    commit: {
      sha: string | null;
      short: string | null;
      message: string | null;
    };
    changelog: string | null;
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
    const sha = this.resolveGitSha();
    const changelogRaw = this.getChangelog();
    const changelog =
      changelogRaw.trim().length > 0 ? changelogRaw : null;
    const commitMessage = firstNonEmpty(
      process.env.GIT_COMMIT_MESSAGE,
      process.env.CI_COMMIT_MESSAGE,
      process.env.COMMIT_MESSAGE,
      process.env.VERCEL_GIT_COMMIT_MESSAGE,
    );
    return {
      service: 'aptos-translate-api',
      version,
      gitSha: sha,
      commit: {
        sha,
        short: shortGitSha(sha),
        message: commitMessage,
      },
      changelog,
      buildTime: process.env.BUILD_TIME ?? null,
      node: process.version,
      langdockConfigured: Boolean(token.trim()),
    };
  }
}
