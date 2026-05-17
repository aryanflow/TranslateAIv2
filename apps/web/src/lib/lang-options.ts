/** Must match api `config/lang-config.ts` keys */
export const LANG_OPTIONS = [
  { value: "spanish", label: "Spanish" },
  { value: "korean", label: "Korean" },
  { value: "hindi", label: "Hindi" },
  { value: "french", label: "French" },
  { value: "german", label: "German" },
  { value: "italian", label: "Italian" },
  { value: "portuguese", label: "Portuguese" },
  { value: "chinese", label: "Chinese (Simplified)" },
  { value: "japanese", label: "Japanese" },
  { value: "dutch", label: "Dutch" },
  { value: "russian", label: "Russian" },
  { value: "arabic", label: "Arabic" },
  { value: "turkish", label: "Turkish" },
  { value: "polish", label: "Polish" },
  { value: "swedish", label: "Swedish" },
  { value: "norwegian", label: "Norwegian" },
  { value: "danish", label: "Danish" },
  { value: "czech", label: "Czech" },
  { value: "greek", label: "Greek" },
  { value: "canadian_english", label: "Canadian English" },
  {
    value: "canadian_french",
    label: "Canadian French (Québécois)",
  },
  { value: "british_english", label: "British English" },
  { value: "american_english", label: "American English" },
] as const;

export function langLabel(code: string): string {
  const hit = LANG_OPTIONS.find((o) => o.value === code);
  return hit?.label ?? code.replace(/_/g, " ");
}
