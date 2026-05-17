/** Supported localization source formats (matches aptos extractor factory). */
export type SourceFormat = 'xml' | 'json' | 'csv' | 'excel';

export type ExtractResult = {
  originals: string[];
  tags: string[];
  /** Stable 1-based ids aligned with originals/tags for LLM alignment & QA exports. */
  stringIds: number[];
  /** Raw text for xml/json/csv; for excel a JSON summary (Python parity). */
  rawText: string;
  /** Original bytes preserved for excel regeneration. */
  rawBytes?: Buffer;
  format: SourceFormat;
  meta: ExtractMeta;
};

export type ExtractMeta = {
  /** CSV / excel */
  selectedColumns?: string[];
  /** Excel only */
  selectedSheet?: string;
  sheetNames?: string[];
};

export function inferFormatFromKey(fileKey: string): SourceFormat | null {
  const lower = fileKey.toLowerCase();
  if (lower.endsWith('.xml')) return 'xml';
  if (lower.endsWith('.json')) return 'json';
  if (lower.endsWith('.csv')) return 'csv';
  if (lower.endsWith('.xlsx') || lower.endsWith('.xls')) return 'excel';
  return null;
}
