import { Controller, Get, Res } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import type { FastifyReply } from 'fastify';
import { VersionService } from './version.service';

@ApiTags('version')
@Controller('version')
export class VersionController {
  constructor(private readonly version: VersionService) {}

  @Get()
  @ApiOperation({
    summary:
      'Deployed version: package version, git commit, optional message, full changelog (markdown), build metadata',
  })
  getVersion() {
    return this.version.getApiBuild();
  }

  @Get('changelog')
  @ApiOperation({ summary: 'Plain-text changelog (apps/api/CHANGELOG.md)' })
  getChangelog(@Res({ passthrough: false }) reply: FastifyReply) {
    const body =
      this.version.getChangelog() ||
      '# Changelog\n\n_No changelog file found._\n';
    return reply.type('text/markdown; charset=utf-8').send(body);
  }

  @Get('web')
  @ApiOperation({
    summary:
      'Optional: Next.js build info — serve from web app or static env in production',
  })
  getWebVersion() {
    return {
      app: 'aptos-translate-web',
      version: process.env.NEXT_PUBLIC_APP_VERSION ?? '0.0.0',
      gitSha: process.env.NEXT_PUBLIC_GIT_SHA ?? null,
    };
  }
}
