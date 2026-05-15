import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

/** Shared HTTP client for Langdock's Google Gemini-compatible API. */
@Injectable()
export class LangdockGoogleGeminiClient {
  private readonly apiKey: string;
  private readonly baseUrl: string;
  private readonly model: string;
  private readonly timeoutMs: number;

  constructor(private readonly config: ConfigService) {
    this.apiKey =
      this.config.get<string>('LANGDOCK_BEARER_TOKEN') ??
      this.config.get<string>('LANGDOCK_API_KEY') ??
      '';
    const region = this.config.get<string>('LANGDOCK_REGION', 'us');
    this.model = this.config.get<string>('GEMINI_MODEL', 'gemini-2.0-flash');
    this.timeoutMs =
      Number(this.config.get<string>('LANGDOCK_API_TIMEOUT', '120')) * 1000;
    this.baseUrl = `https://api.langdock.com/google/${region}/v1beta`;
  }

  assertConfigured(): void {
    if (!this.apiKey) {
      throw new Error('LANGDOCK_BEARER_TOKEN or LANGDOCK_API_KEY is not set');
    }
  }

  async generateContent(
    prompt: string,
    generationConfig: Record<string, unknown> = {
      temperature: 0.1,
      topP: 0.8,
      topK: 40,
      maxOutputTokens: 8192,
    },
  ): Promise<string> {
    this.assertConfigured();
    const url = `${this.baseUrl}/models/${this.model}:generateContent`;
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
          contents: [{ role: 'user', parts: [{ text: prompt }] }],
          generationConfig,
        }),
        signal: controller.signal,
      });
      if (resp.status === 401) {
        throw new Error('401 from Langdock. Check LANGDOCK_BEARER_TOKEN.');
      }
      if (!resp.ok) {
        const detail = (await resp.text()).slice(0, 500);
        throw new Error(`Langdock Google API error ${resp.status}: ${detail}`);
      }
      const data = (await resp.json()) as {
        candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
      };
      const parts = data.candidates?.[0]?.content?.parts;
      const text = parts?.[0]?.text;
      if (!text)
        throw new Error('No content in response from Langdock Google API');
      return text;
    } finally {
      clearTimeout(timer);
    }
  }
}
