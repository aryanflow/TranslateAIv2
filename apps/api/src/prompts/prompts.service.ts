import { ConflictException, Injectable } from '@nestjs/common';
import { putPromptBodySchema } from '@aptos-translate/contracts';
import { PrismaService } from '../common/prisma/prisma.service';
import { GLOBAL_TRANSLATOR_SYSTEM_PROMPT } from '../llm/enterprise-localization-prompts';

/**
 * Optional tenant **system** overlay — appended after the fixed product localization engine prompt.
 * Leave blank to rely entirely on the shipped baseline.
 */
const DEFAULT_SYSTEM = `You may add optional tenant-wide policy here (brand voice, forbidden terms, etc.).
When empty, only the product-defined localization engine system prompt applies.`;

const DEFAULT_USER = `────────────────────────────────────────────────────────────
CUSTOM INSTRUCTIONS FOR THIS RUN
────────────────────────────────────────────────────────────

[A] PREFERRED TERM MAPPINGS
(Authoritative JSON array of { "src", "tgt" } — injected from Term preferences; use verbatim when source matches exactly.)

{{glossary_block}}

Tip: Remove the block above only if you manage mappings elsewhere. Do not treat this JSON as chat.

────────────────────────────────────────────────────────────

[B] ADDITIONAL CONTEXT
(Domain notes, brand voice, project-specific rules, or abbreviations for this run.)

Example:
- This is for a luxury fashion brand. Use a formal, elevated register.
- "HQ" = headquarters; do not expand or translate it.

(Replace this section with your own bullets, or delete it if not needed.)

────────────────────────────────────────────────────────────

[C] LANGUAGE-SPECIFIC TERMINOLOGY REFERENCE
(Preferred native terms for this target — auto-filled from LANG_CONFIG when available.)

{{terminology_reference}}

────────────────────────────────────────────────────────────

Pair metadata (substituted each job):
- Source language code: {{source_lang}}
- Target language code: {{target_lang}}
- Target display name: {{target_language_name}}`;

@Injectable()
export class PromptsService {
  constructor(private readonly prisma: PrismaService) {}

  private productDefaults() {
    return { systemText: DEFAULT_SYSTEM, userText: DEFAULT_USER, version: 0 };
  }

  /** Read-only product strings for the dashboard (global system is not editable in DB). */
  getProductBaseline() {
    return {
      globalTranslatorSystem: GLOBAL_TRANSLATOR_SYSTEM_PROMPT,
      defaultOptionalSystemOverlay: DEFAULT_SYSTEM,
      defaultUserTemplate: DEFAULT_USER,
    };
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
