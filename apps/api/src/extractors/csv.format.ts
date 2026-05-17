import { parse } from 'csv-parse/sync';
import type { ExtractMeta } from './extraction.types';

function columnIsNumeric(series: string[]): boolean {
  const nonEmpty = series.filter((s) => (s ?? '').trim());
  if (!nonEmpty.length) return false;
  for (const s of nonEmpty) {
    const n = Number(String(s).trim());
    if (Number.isNaN(n)) return false;
  }
  return true;
}

function detectStringColumns(
  rows: Record<string, string>[],
  columns: string[],
): string[] {
  const stringCols: string[] = [];
  for (const col of columns) {
    const colValues = rows.map((r) => String(r[col] ?? ''));
    if (!columnIsNumeric(colValues)) {
      stringCols.push(col);
    }
  }
  return stringCols;
}

export function extractCsv(
  fileBytes: Buffer,
  selectedColumns?: string[],
): { originals: string[]; tags: string[]; rawText: string; meta: ExtractMeta } {
  const content = fileBytes.toString('utf-8');
  let rows: Record<string, string>[];
  try {
    rows = parse(content, {
      columns: true,
      skip_empty_lines: true,
      relax_quotes: true,
      trim: true,
    });
  } catch (e) {
    throw new Error(
      `Invalid CSV format: ${e instanceof Error ? e.message : String(e)}`,
    );
  }

  if (!rows.length) {
    throw new Error('CSV file is empty');
  }

  const columns = Object.keys(rows[0]);
  let cols = selectedColumns?.length
    ? selectedColumns.filter((c) => columns.includes(c))
    : detectStringColumns(rows, columns);

  if (!cols.length) {
    cols = columns;
  }

  const originals: string[] = [];
  const tags: string[] = [];

  for (const col of cols) {
    for (let idx = 0; idx < rows.length; idx++) {
      const value = rows[idx][col];
      if (value != null && String(value).trim()) {
        originals.push(String(value).trim());
        tags.push(`row_${idx}_col_${col}`);
      }
    }
  }

  return { originals, tags, rawText: content, meta: { selectedColumns: cols } };
}

export function regenerateCsv(
  originalCsv: string,
  tagTranslationMap: Record<string, string>,
  selectedColumns?: string[],
): string {
  let rows: Record<string, string>[];
  try {
    rows = parse(originalCsv, {
      columns: true,
      skip_empty_lines: true,
      relax_quotes: true,
      trim: true,
    });
  } catch (e) {
    throw new Error(
      `Invalid CSV format: ${e instanceof Error ? e.message : String(e)}`,
    );
  }

  const columns = rows.length ? Object.keys(rows[0]) : [];
  let cols = selectedColumns?.length
    ? selectedColumns.filter((c) => columns.includes(c))
    : detectStringColumns(rows, columns);

  if (!cols.length) {
    cols = columns;
  }

  const out = rows.map((row, rowIdx) => {
    const copy = { ...row };
    for (const col of cols) {
      const raw = row[col];
      if (raw != null && String(raw).trim()) {
        const tag = `row_${rowIdx}_col_${col}`;
        const mapped = tagTranslationMap[tag];
        if (mapped !== undefined) {
          copy[col] = mapped;
        }
      }
    }
    return copy;
  });

  // Rebuild CSV manually for stable quoting
  const header = columns;
  const lines = [
    header.join(','),
    ...out.map((row) =>
      header
        .map((h) => {
          const v = row[h] ?? '';
          const s = String(v);
          if (/[",\n]/.test(s)) {
            return `"${s.replace(/"/g, '""')}"`;
          }
          return s;
        })
        .join(','),
    ),
  ];
  return lines.join('\n');
}
