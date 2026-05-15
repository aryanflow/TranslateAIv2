import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  buildTranslationPrompt,
  type TranslationExample,
} from './prompt-builder';
import { extractJsonObject } from './json-utils';

/** OpenAI-compatible translation via Langdock — matches aptos-translateai/llms/langdock_llm.py translate() */
@Injectable()
export class LangdockOpenAiTranslatorService {
  private readonly logger = new Logger(LangdockOpenAiTranslatorService.name);
  private readonly baseUrl: string;
  private readonly model: string;
  private readonly timeoutMs: number;
  private readonly maxRetries: number;
  private readonly apiKey: string;

  constructor(private readonly config: ConfigService) {
    this.apiKey =
      this.config.get<string>('LANGDOCK_BEARER_TOKEN') ??
      this.config.get<string>('LANGDOCK_API_KEY') ??
      '';
    const region = this.config.get<string>('LANGDOCK_REGION', 'us');
    this.model =
      this.config.get<string>('LANGDOCK_TRANSLATION_MODEL') ??
      this.config.get<string>('LANGDOCK_MODEL', 'gpt-5.2');
    this.timeoutMs =
      Number(this.config.get<string>('LANGDOCK_API_TIMEOUT', '120')) * 1000;
    this.maxRetries = Number(this.config.get<string>('MAX_RETRIES', '3'));
    this.baseUrl = `https://api.langdock.com/openai/${region}/v1`;
  }

  async translate(
    texts: string[],
    language: string,
    examples?: TranslationExample[] | null,
    additionalContext?: string | null,
  ): Promise<string[]> {
    if (!this.apiKey) {
      throw new Error('LANGDOCK_BEARER_TOKEN or LANGDOCK_API_KEY is not set');
    }
    if (!texts.length) return [];

    const inputItems = texts.map((t, i) => ({ id: `i${i}`, src: t, ix: i }));
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
`;

    const userContent = comprehensive + '\n\n' + jsonStructure;

    try {
      const content = await this.chat(
        [
          {
            role: 'system',
            content:
              'You are a precise translation engine. Return ONLY valid JSON.',
          },
          { role: 'user', content: userContent },
        ],
        0.2,
      );

      const parsed = this.parseTranslationResponse(content);
      const translations: string[] = [];

      for (let i = 0; i < texts.length; i++) {
        const original = texts[i];
        const item = parsed.get(`i${i}`);
        const translated = item?.t != null ? String(item.t).trim() : '';
        if (original.trim() === '') {
          translations.push('');
        } else if (translated) {
          translations.push(translated);
        } else {
          translations.push(
            `[TRANSLATION_FAILED: ${original.slice(0, 50)}... - Missing translation]`,
          );
        }
      }

      this.validateTranslationAlignment(texts, translations, parsed);
      return translations;
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      this.logger.error(`Langdock translate failed: ${msg}`);
      throw e;
    }
  }

  async chat(
    messages: Array<{ role: string; content: string }>,
    temperature: number,
  ): Promise<string> {
    const url = `${this.baseUrl}/chat/completions`;

    for (let attempt = 0; attempt < this.maxRetries; attempt++) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), this.timeoutMs);
      try {
        const resp = await fetch(url, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${this.apiKey}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            model: this.model,
            temperature,
            messages,
          }),
          signal: controller.signal,
        });

        if (resp.status === 401) {
          throw new Error(
            '401 from Langdock. Check LANGDOCK_BEARER_TOKEN and REGION.',
          );
        }
        if (!resp.ok) {
          const t = await resp.text();
          throw new Error(
            `Langdock OpenAI error ${resp.status}: ${t.slice(0, 400)}`,
          );
        }

        const data = (await resp.json()) as {
          choices?: Array<{ message?: { content?: string } }>;
        };
        const content = data.choices?.[0]?.message?.content;
        if (!content) throw new Error('Empty completion');
        return content;
      } catch (e) {
        if (attempt < this.maxRetries - 1 && this.isRetryable(e)) {
          const delay = Math.min(
            Number(this.config.get<string>('RETRY_DELAY_BASE', '2')) *
              2 ** attempt,
            Number(this.config.get<string>('MAX_RETRY_DELAY', '10')),
          );
          await new Promise((r) => setTimeout(r, delay * 1000));
          continue;
        }
        throw e;
      } finally {
        clearTimeout(timer);
      }
    }
    throw new Error('Langdock chat exhausted retries');
  }

  private isRetryable(e: unknown): boolean {
    return (
      e instanceof Error &&
      (e.name === 'AbortError' || e.message.includes('fetch'))
    );
  }

  private parseTranslationResponse(
    raw: string,
  ): Map<string, { id?: string; t?: string; ix?: number }> {
    const jsonStr = extractJsonObject(raw);
    const data = JSON.parse(jsonStr) as {
      res?: Array<{ id?: string; t?: string; ix?: number }>;
    };
    const map = new Map<string, { id?: string; t?: string; ix?: number }>();
    for (const item of data.res ?? []) {
      if (item.id) map.set(item.id, item);
    }
    return map;
  }

  private validateTranslationAlignment(
    texts: string[],
    translations: string[],
    parsed: Map<string, { ix?: number }>,
  ): void {
    if (translations.length !== texts.length) {
      throw new Error(`Translation count alignment failed`);
    }
    const expected = new Set(texts.map((_, i) => `i${i}`));
    const actual = new Set(parsed.keys());
    if (
      expected.size !== actual.size ||
      [...expected].some((id) => !actual.has(id))
    ) {
      throw new Error('Translation ID alignment failed');
    }
    for (let i = 0; i < texts.length; i++) {
      const item = parsed.get(`i${i}`);
      if (item?.ix !== undefined && item.ix !== i) {
        throw new Error(`Translation index alignment failed for i${i}`);
      }
    }
  }
}
