import * as XLSX from 'xlsx';
import type { ExtractMeta } from './extraction.types';

function columnIsNumeric(series: string[]): boolean {
  const nonEmpty = series.filter((s) => s?.trim());
  if (!nonEmpty.length) return false;
  for (const s of nonEmpty) {
    const n = Number(String(s).trim());
    if (Number.isNaN(n)) return false;
  }
  return true;
}

function detectStringColumns(
  rows: Record<string, unknown>[],
  columns: string[],
): string[] {
  const stringCols: string[] = [];
  for (const col of columns) {
    const vals = rows.map((r) => {
      const v = r[col];
      if (v == null) return '';
      if (
        typeof v === 'string' ||
        typeof v === 'number' ||
        typeof v === 'boolean'
      ) {
        return String(v);
      }
      return JSON.stringify(v);
    });
    if (!columnIsNumeric(vals)) {
      stringCols.push(col);
    }
  }
  return stringCols;
}

export function listExcelSheetNames(fileBytes: Buffer): string[] {
  const wb = XLSX.read(fileBytes, { type: 'buffer' });
  return wb.SheetNames;
}

export function extractExcel(
  fileBytes: Buffer,
  selectedSheet?: string,
  selectedColumns?: string[],
): { originals: string[]; tags: string[]; rawText: string; meta: ExtractMeta } {
  const wb = XLSX.read(fileBytes, { type: 'buffer' });
  const sheetName = selectedSheet ?? wb.SheetNames[0];
  if (!sheetName) {
    throw new Error('Excel file has no sheets');
  }

  const sheet = wb.Sheets[sheetName];
  if (!sheet) {
    throw new Error(`Invalid Excel format or sheet name: ${sheetName}`);
  }

  const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, {
    defval: '',
  });
  if (!rows.length) {
    throw new Error('Excel sheet is empty');
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
      if (value != null && typeof value === 'string' && value.trim()) {
        originals.push(value.trim());
        tags.push(`sheet_${sheetName}_row_${idx}_col_${col}`);
      }
    }
  }

  const rawInfo = JSON.stringify({
    sheet_name: sheetName,
    selected_columns: cols,
    total_rows: rows.length,
    total_columns: columns.length,
    extracted_strings: originals.length,
  });

  return {
    originals,
    tags,
    rawText: rawInfo,
    meta: {
      selectedSheet: sheetName,
      selectedColumns: cols,
      sheetNames: wb.SheetNames,
    },
  };
}

export function regenerateExcel(
  originalFileBytes: Buffer,
  translationMap: Record<string, string>,
  selectedSheet: string,
  selectedColumns?: string[],
): Buffer {
  const wb = XLSX.read(originalFileBytes, { type: 'buffer' });
  if (!wb.SheetNames.includes(selectedSheet)) {
    throw new Error(`Sheet '${selectedSheet}' not found in Excel file`);
  }

  const sheet = wb.Sheets[selectedSheet];
  const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, {
    defval: '',
    raw: false,
  });
  if (!rows.length) {
    return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer;
  }

  const columns = Object.keys(rows[0]);
  let cols =
    selectedColumns?.filter((c) => columns.includes(c)) ??
    detectStringColumns(rows, columns);
  if (!cols.length) cols = columns;

  const nextRows = rows.map((row) => {
    const copy = { ...row };
    for (const col of cols) {
      const raw = row[col];
      if (raw != null && typeof raw === 'string' && raw.trim()) {
        const key = raw.trim();
        if (Object.prototype.hasOwnProperty.call(translationMap, key)) {
          copy[col] = translationMap[key];
        }
      }
    }
    return copy;
  });

  wb.Sheets[selectedSheet] = XLSX.utils.json_to_sheet(nextRows);
  return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer;
}
