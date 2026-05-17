import type { TranslationExample } from './prompt-builder';

/** What the router passes into provider-specific translators. */
export type TranslationCallContext = {
  examples?: TranslationExample[] | null;
  /** Glossary + rendered admin templates — not end-user chat. */
  authorizedReference?: string | null;
  /** Administrator-defined system prompt (PromptTemplate.systemText). */
  administratorSystemPrompt?: string;
  /** Global catalog string ids (1-based), parallel to this batch's texts. */
  batchStringIds?: number[];
};
