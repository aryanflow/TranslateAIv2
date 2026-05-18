import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DEFAULT_BEDROCK_TRANSLATION_MODEL_ID } from '../config/bedrock-defaults';
import {
  buildTranslationPrompt,
  DEFAULT_BEDROCK_TRANSLATOR_SYSTEM,
} from './prompt-builder';
import { extractJsonObject } from './json-utils';
import { BedrockConverseService } from './bedrock-converse.service';
import type { TranslationCallContext } from './translation-context';

@Injectable()
export class BedrockTranslatorService {
  private readonly logger = new Logger(BedrockTranslatorService.name);

  constructor(
    private readonly config: ConfigService,
    private readonly bedrock: BedrockConverseService,
  ) {}

  modelId(): string {
    const id =
      this.config.get<string>('BEDROCK_TRANSLATION_MODEL_ID') ??
      this.config.get<string>('BEDROCK_MODEL_ID') ??
      DEFAULT_BEDROCK_TRANSLATION_MODEL_ID;
    return id.trim();
  }

  assertConfigured(): void {
    if (!this.modelId()) {
      throw new Error('Bedrock translation model id resolved empty');
    }
  }

  async translate(
    texts: string[],
    language: string,
    ctx?: TranslationCallContext,
  ): Promise<string[]> {
    this.assertConfigured();
    if (!texts.length) return [];

    const examples = ctx?.examples;
    const additional = ctx?.authorizedReference?.trim()
      ? ctx.authorizedReference
      : null;

    const ids =
      ctx?.batchStringIds?.length === texts.length
        ? ctx.batchStringIds
        : texts.map((_, i) => i + 1);

    const processed = texts.map((t, i) => {
      if (!t || t.trim() === '') return `[EMPTY_TEXT_${ids[i]}]`;
      if (t.length > 1000) return `${t.slice(0, 1000)}...`;
      return t;
    });

    const inputItems = processed.map((text, i) => ({
      sid: ids[i],
      ix: i,
      src: text,
    }));

    const adminUser = ctx?.administratorUserTemplate?.trim();
    const batchSection = buildTranslationPrompt(
      texts,
      language,
      examples,
      additional,
      {
        sourceLangCode: ctx?.batchSourceLang,
        sourceLangDisplayName: ctx?.batchSourceLangDisplayName,
      },
    );
    const jsonStructure = `

Return ONLY valid JSON in this EXACT structure:
{
  "res": [
    {"sid": 1, "t": "translated text here", "ix": 0},
    {"sid": 2, "t": "next translated text", "ix": 1}
  ]
}

Rules:
- Output exactly ${inputItems.length} objects in "res".
- Each object MUST include integer "sid" copied exactly from input (catalog scope).
- Include "ix" as batch position only: first row ix=0, second ix=1, … — never copy sid into ix.
- Preserve placeholders/tags exactly; one best translation per sid; JSON only.
- Preserve every ampersand (U+0026) from each source "src" in the matching "t" string (Windows accelerator / MFC mnemonics). The count of ampersands in "t" MUST equal the count in that row's source text — never strip them.
- In schema-style titles (Resource ID, Mandatory, Code Type, By Host, etc.), keep short Latin tokens such as Fe, Str, Lp, Asn, Po, No, Id in Latin with the same casing; translate only the readable words around them.

Items to translate:
${JSON.stringify(inputItems)}

Return ONLY the JSON above.
`;

    const userContent = [adminUser, batchSection, jsonStructure]
      .filter((s) => s && s.length > 0)
      .join('\n\n');

    const envSystem =
      this.config.get<string>('BEDROCK_TRANSLATOR_SYSTEM_OVERLAY', '')?.trim();
    const admin = ctx?.administratorSystemPrompt?.trim();
    const systemParts = [
      DEFAULT_BEDROCK_TRANSLATOR_SYSTEM,
      envSystem ? envSystem : null,
      admin
        ? [
            '────────────────────────────────────────────────────────────',
            'OPTIONAL TENANT SYSTEM OVERLAY',
            '(Appended policy after the shipped localization engine system prompt.)',
            '────────────────────────────────────────────────────────────',
            admin,
          ].join('\n')
        : null,
    ].filter(Boolean);

    const systemPrompt = systemParts.join('\n\n');

    try {
      const maxOut = Number(
        this.config.get<string>('BEDROCK_TRANSLATION_MAX_TOKENS', '8192'),
      );
      const temp = Number(
        this.config.get<string>('BEDROCK_TRANSLATION_TEMPERATURE', '0.15'),
      );
      const raw = await this.bedrock.converseText({
        modelId: this.modelId(),
        system: systemPrompt,
        user: userContent,
        maxTokens: maxOut,
        temperature: temp,
      });
      const parsed = this.parseTranslationResponse(raw);
      const translations: string[] = [];

      for (let i = 0; i < texts.length; i++) {
        const original = texts[i];
        const sid = ids[i];
        if (original.trim() === '') {
          translations.push('');
          continue;
        }
        const item =
          parsed.bySid.get(sid) ??
          parsed.byLegacyId.get(`i${i}`) ??
          parsed.byLegacyId.get(`sid-${sid}`);
        const t = item?.t != null ? String(item.t).trim() : '';
        if (t) {
          translations.push(t);
        } else {
          translations.push(
            `[TRANSLATION_FAILED sid=${sid}: ${original.slice(0, 50)}…]`,
          );
        }
      }

      this.validateTranslationAlignment(texts, translations, ids, parsed);
      return translations;
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      this.logger.error(`Bedrock translation failed: ${msg}`);
      return texts.map(
        (t) => `[TRANSLATION_ERROR: ${t.slice(0, 50)}... - ${msg}]`,
      );
    }
  }

  private parseTranslationResponse(raw: string): {
    bySid: Map<number, { sid?: number; t?: string; ix?: number }>;
    byLegacyId: Map<string, { id?: string; t?: string; ix?: number }>;
  } {
    try {
      const jsonStr = extractJsonObject(raw);
      const data = JSON.parse(jsonStr) as {
        res?: Array<{
          sid?: number;
          id?: string;
          t?: string;
          ix?: number;
        }>;
      };
      const bySid = new Map<number, { sid?: number; t?: string; ix?: number }>();
      const byLegacyId = new Map<
        string,
        { id?: string; t?: string; ix?: number }
      >();
      for (const item of data.res ?? []) {
        if (item.sid != null && !Number.isNaN(Number(item.sid))) {
          bySid.set(Number(item.sid), item);
        }
        if (item.id) byLegacyId.set(String(item.id), item);
      }
      return { bySid, byLegacyId };
    } catch {
      return { bySid: new Map(), byLegacyId: new Map() };
    }
  }

  private validateTranslationAlignment(
    texts: string[],
    translations: string[],
    ids: number[],
    parsed: {
      bySid: Map<number, { ix?: number }>;
      byLegacyId: Map<string, { ix?: number }>;
    },
  ): void {
    if (translations.length !== texts.length) {
      throw new Error(
        `Translation count alignment failed: expected ${texts.length}, got ${translations.length}`,
      );
    }
    for (let i = 0; i < texts.length; i++) {
      const sid = ids[i];
      const fromSid = parsed.bySid.get(sid);
      const item = fromSid ?? parsed.byLegacyId.get(`i${i}`);
      if (!fromSid && item?.ix !== undefined && item.ix !== i) {
        throw new Error(`Translation index alignment failed for batch index ${i} (legacy id i${i})`);
      }
    }
  }
}
