/**
 * Product defaults when env vars are omitted (all are Amazon Bedrock model IDs in your region).
 * Override per environment via BEDROCK_TRANSLATION_MODEL_ID / BEDROCK_SCORING_MODEL_ID.
 *
 * - Translation: Google Gemma 3 (instruction-tuned) — fast/cost-effective batch translation.
 * - Quality review / scoring: OpenAI GPT-OSS **20B** on Bedrock — smaller sibling tends to emit
 *   usable text on short probes; **120B** can return empty content blocks for some accounts/regions.
 *   If health Judge probe shows "Empty Bedrock Converse response", try `openai.gpt-oss-20b-1:0`
 *   or raise `BEDROCK_SCORING_MAX_TOKENS`.
 *
 * Enable model access in Bedrock console: Google Gemma + OpenAI GPT-OSS.
 * Docs: https://docs.aws.amazon.com/bedrock/latest/userguide/model-cards.html
 */
export const DEFAULT_BEDROCK_TRANSLATION_MODEL_ID = 'google.gemma-3-12b-it';
export const DEFAULT_BEDROCK_SCORING_MODEL_ID = 'openai.gpt-oss-20b-1:0';
