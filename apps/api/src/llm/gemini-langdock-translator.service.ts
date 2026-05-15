import { Injectable, Logger } from '@nestjs/common';
import {
  buildTranslationPrompt,
  type TranslationExample,
} from './prompt-builder';
import { extractJsonObject } from './json-utils';
import { LangdockGoogleGeminiClient } from './langdock-google-gemini.client';

/** Gemini via Langdock Google Completion API — matches aptos-translateai/llms/gemini_llm.py */
@Injectable()
export class GeminiLangdockTranslatorService {
  private readonly logger = new Logger(GeminiLangdockTranslatorService.name);

  constructor(private readonly geminiClient: LangdockGoogleGeminiClient) {}

  async translate(
    texts: string[],
    language: string,
    examples?: TranslationExample[] | null,
    additionalContext?: string | null,
  ): Promise<string[]> {
    this.geminiClient.assertConfigured();
    if (!texts.length) return [];

    const processed = texts.map((t, i) => {
      if (!t || t.trim() === '') return `[EMPTY_TEXT_${i}]`;
      if (t.length > 1000) return `${t.slice(0, 1000)}...`;
      return t;
    });

    const inputItems = processed.map((text, i) => ({
      id: `i${i}`,
      src: text,
      ix: i,
    }));

    const comprehensive = buildTranslationPrompt(
      texts,
      language,
      examples,
      additionalContext,
    );
    const jsonStructure = `

Return ONLY valid JSON in this EXACT structure:
{
  "res": [
    {"id": "i0", "t": "translated text here", "ix": 0},
    {"id": "i1", "t": "next translated text", "ix": 1}
  ]
}

Rules:
- Output exactly ${inputItems.length} items in "res".
- Use ids i0..i${inputItems.length - 1} and matching ix 0..${inputItems.length - 1}.
- Preserve all placeholders/symbols/tags exactly; one best translation; no extra text.

Items to translate (id, src, ix):
${JSON.stringify(inputItems)}

Return ONLY the JSON above.
`;

    const prompt = comprehensive + jsonStructure;
    const generationConfig = {
      temperature: 0.1,
      topP: 0.8,
      topK: 40,
      maxOutputTokens: 8192,
    };

    try {
      const raw = await this.geminiClient.generateContent(
        prompt,
        generationConfig,
      );
      const parsed = this.parseTranslationResponse(raw);
      const translations: string[] = [];

      for (let i = 0; i < texts.length; i++) {
        const original = texts[i];
        if (original.trim() === '') {
          translations.push('');
          continue;
        }
        const item = parsed.get(`i${i}`);
        const t = item?.t != null ? String(item.t).trim() : '';
        if (t) {
          translations.push(t);
        } else {
          translations.push(
            `[TRANSLATION_FAILED: ${original.slice(0, 50)}... - Empty translation returned]`,
          );
        }
      }

      this.validateTranslationAlignment(texts, translations, parsed);
      return translations;
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      this.logger.error(`Translation failed: ${msg}`);
      return texts.map(
        (t) => `[TRANSLATION_ERROR: ${t.slice(0, 50)}... - ${msg}]`,
      );
    }
  }

  private parseTranslationResponse(
    raw: string,
  ): Map<string, { id?: string; t?: string; ix?: number }> {
    try {
      const jsonStr = extractJsonObject(raw);
      const data = JSON.parse(jsonStr) as {
        res?: Array<{ id?: string; t?: string; ix?: number }>;
      };
      const map = new Map<string, { id?: string; t?: string; ix?: number }>();
      for (const item of data.res ?? []) {
        if (item.id) map.set(item.id, item);
      }
      return map;
    } catch {
      return new Map();
    }
  }

  private validateTranslationAlignment(
    texts: string[],
    translations: string[],
    parsed: Map<string, { ix?: number }>,
  ): void {
    if (translations.length !== texts.length) {
      throw new Error(
        `Translation count alignment failed: expected ${texts.length}, got ${translations.length}`,
      );
    }
    for (let i = 0; i < texts.length; i++) {
      const item = parsed.get(`i${i}`);
      if (item && item.ix !== undefined && item.ix !== i) {
        throw new Error(`Translation index alignment failed for i${i}`);
      }
    }
  }
}
