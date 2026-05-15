import { join } from 'node:path';
import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { AppController } from './app.controller';
import { PrismaModule } from './common/prisma/prisma.module';
import { AuthModule } from './auth/auth.module';
import { FilesModule } from './files/files.module';
import { JobsModule } from './jobs/jobs.module';
import { PromptsModule } from './prompts/prompts.module';
import { GlossaryModule } from './glossary/glossary.module';
import { HealthModule } from './health/health.module';
import { TranslationModule } from './translation/translation.module';
import { VersionModule } from './version/version.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      // Resolve from apps/api/.env even when the shell cwd is the monorepo root.
      envFilePath: [
        join(__dirname, '..', '.env'),
        join(__dirname, '..', '.env.local'),
      ],
    }),
    PrismaModule,
    AuthModule,
    FilesModule,
    JobsModule,
    PromptsModule,
    GlossaryModule,
    HealthModule,
    VersionModule,
    TranslationModule,
  ],
  controllers: [AppController],
})
export class AppModule {}
