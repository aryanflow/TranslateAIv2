import { ConflictException, Injectable } from '@nestjs/common';
import { putPromptBodySchema } from '@aptos-translate/contracts';
import { PrismaService } from '../common/prisma/prisma.service';

const DEFAULT_SYSTEM = `You are translating Point-of-Sale UI copy. Preserve placeholders like {0}, %s, and <br>. Be extremely brief.`;
const DEFAULT_USER = `Translate the following segment.\nSource: {{source_text}}\nGlossary rules (if any):\n{{glossary_block}}`;

@Injectable()
export class PromptsService {
  constructor(private readonly prisma: PrismaService) {}

  private productDefaults() {
    return { systemText: DEFAULT_SYSTEM, userText: DEFAULT_USER, version: 0 };
  }

  async getTemplate(
    tenantId: string,
    sourceLang: string,
    targetLang: string,
  ): Promise<{
    sourceLang: string;
    targetLang: string;
    systemText: string;
    userText: string;
    version: number;
    updatedAt: Date;
  }> {
    const row = await this.prisma.promptTemplate.findUnique({
      where: {
        tenantId_sourceLang_targetLang: { tenantId, sourceLang, targetLang },
      },
    });
    const merged = row
      ? {
          systemText: row.systemText,
          userText: row.userText,
          version: row.version,
          updatedAt: row.updatedAt,
        }
      : {
          ...this.productDefaults(),
          updatedAt: new Date(0),
        };
    return {
      sourceLang,
      targetLang,
      systemText: merged.systemText.length
        ? merged.systemText
        : this.productDefaults().systemText,
      userText: merged.userText.length
        ? merged.userText
        : this.productDefaults().userText,
      version: merged.version,
      updatedAt: merged.updatedAt,
    };
  }

  async putTemplate(
    tenantId: string,
    sourceLang: string,
    targetLang: string,
    body: unknown,
  ) {
    const parsed = putPromptBodySchema.parse(body);
    const existing = await this.prisma.promptTemplate.findUnique({
      where: {
        tenantId_sourceLang_targetLang: { tenantId, sourceLang, targetLang },
      },
    });
    const current = existing?.version ?? 0;
    if (parsed.expectedVersion != null && current !== parsed.expectedVersion) {
      throw new ConflictException({
        message: 'Prompt template was updated by another session',
        currentVersion: current,
      });
    }
    const nextVersion = current + 1;
    const saved = await this.prisma.promptTemplate.upsert({
      where: {
        tenantId_sourceLang_targetLang: { tenantId, sourceLang, targetLang },
      },
      create: {
        tenant: { connect: { id: tenantId } },
        sourceLang,
        targetLang,
        systemText: parsed.systemText,
        userText: parsed.userText,
        version: nextVersion,
      },
      update: {
        systemText: parsed.systemText,
        userText: parsed.userText,
        version: nextVersion,
      },
    });
    return {
      sourceLang,
      targetLang,
      systemText: saved.systemText,
      userText: saved.userText,
      version: saved.version,
      updatedAt: saved.updatedAt,
    };
  }
}
