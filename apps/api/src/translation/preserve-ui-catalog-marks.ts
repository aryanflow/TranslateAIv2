/**
 * Deterministic repairs after LLM translation for POS / Win32 catalog strings.
 * Models still miss rules; this closes recurring gaps (leading Win32 & and Latin Str token).
 */

/**
 * English uses Latin "Str" as a schema token (e.g. Originating Str, Str Fe). Hindi output
 * often wrongly uses स्ट्र (phonetic "str"); swap back to Latin Str when source had Str.
 */
export function repairLatinStrSchemaToken(
  source: string,
  translated: string,
): string {
  if (!/\bStr\b/.test(source)) return translated;
  if (source.includes('स्ट्र')) return translated;
  if (!translated.includes('स्ट्र')) return translated;
  return translated.split('स्ट्र').join('Str');
}

/** Leading Win32 accelerator: "&Caption" — model often drops the first ampersand. */
export function repairLeadingWin32Ampersand(
  source: string,
  translated: string,
): string {
  // Literal "&&" at start = escaped ampersand in resources; do not prepend another.
  if (/^&&/.test(source)) return translated;
  if (/^&(?!&)/.test(source) && !/^&/.test(translated)) {
    return `&${translated}`;
  }
  return translated;
}

export function preserveUiCatalogMarks(
  source: string,
  translated: string,
): string {
  let t = repairLatinStrSchemaToken(source, translated);
  t = repairLeadingWin32Ampersand(source, t);
  return t;
}
