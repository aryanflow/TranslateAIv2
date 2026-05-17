import type { TranslationExample } from './prompt-builder';

/** What the router passes into provider-specific translators. */
export type TranslationCallContext = {
  examples?: TranslationExample[] | null;
  /**
   * Rare extra glossary/policy lines appended to batch CONFIG — not used when empty.
   * Preferred path: tenant term preferences injected into PromptTemplate {{glossary_block}}.
   */
  authorizedReference?: string | null;
  /** Overlay after the shipped global localization system prompt (PromptTemplate.systemText). */
  administratorSystemPrompt?: string;
  /**
   * Substituted PromptTemplate.userText — custom run instructions merged into translator user payload.
   */
  administratorUserTemplate?: string;
  batchSourceLang?: string;
  batchSourceLangDisplayName?: string;
  /** Global catalog string ids (1-based), parallel to this batch's texts. */
  batchStringIds?: number[];
};
