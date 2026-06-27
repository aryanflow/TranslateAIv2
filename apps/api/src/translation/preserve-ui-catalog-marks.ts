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

/**
 * Win32/MFC menus use & before a letter (&File). Models often drop some or all.
 * Walk source &X tokens and ensure & precedes the same letter in the translation once.
 */
export function repairAmpersandAccelerators(
  source: string,
  translated: string,
): string {
  let t = translated;
  for (const m of source.matchAll(/&([^&\s])/g)) {
    const letter = m[1]!;
    const wanted = `&${letter}`;
    if (t.includes(wanted)) continue;
    const escaped = letter.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const re = new RegExp(`(?<!&)${escaped}`, 'u');
    if (re.test(t)) {
      t = t.replace(re, wanted);
    }
  }
  return t;
}

export function preserveUiCatalogMarks(
  source: string,
  translated: string,
): string {
  let t = repairLatinStrSchemaToken(source, translated);
  t = repairLeadingWin32Ampersand(source, t);
  t = repairAmpersandAccelerators(source, t);
  return t;
}
