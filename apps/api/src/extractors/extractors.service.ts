import { Injectable } from '@nestjs/common';
import type { ExtractResult, SourceFormat } from './extraction.types';
import { inferFormatFromKey } from './extraction.types';
import { extractXml } from './xml.format';
import { extractJson } from './json.format';
import { extractCsv } from './csv.format';
import { extractExcel } from './excel.format';

function assertNever(x: never): never {
  throw new Error(`Unsupported format: ${JSON.stringify(x)}`);
}

export type ExtractOptions = {
  format?: SourceFormat;
  selectedColumns?: string[];
  selectedSheet?: string;
};

@Injectable()
export class ExtractorsService {
  extract(
    fileBytes: Buffer,
    fileKey: string,
    opts: ExtractOptions = {},
  ): ExtractResult {
    const format = opts.format ?? inferFormatFromKey(fileKey);
    if (!format) {
      throw new Error(`Cannot infer format from key: ${fileKey}`);
    }

    switch (format) {
      case 'xml': {
        const { originals, tags, rawText } = extractXml(fileBytes);
        const stringIds = originals.map((_, i) => i + 1);
        return {
          originals,
          tags,
          stringIds,
          rawText,
          format,
          meta: {},
        };
      }
      case 'json': {
        const { originals, tags, rawText } = extractJson(fileBytes);
        const stringIds = originals.map((_, i) => i + 1);
        return {
          originals,
          tags,
          stringIds,
          rawText,
          format,
          meta: {},
        };
      }
      case 'csv': {
        const { originals, tags, rawText, meta } = extractCsv(
          fileBytes,
          opts.selectedColumns,
        );
        const stringIds = originals.map((_, i) => i + 1);
        return {
          originals,
          tags,
          stringIds,
          rawText,
          format,
          meta,
        };
      }
      case 'excel': {
        const { originals, tags, rawText, meta } = extractExcel(
          fileBytes,
          opts.selectedSheet,
          opts.selectedColumns,
        );
        const stringIds = originals.map((_, i) => i + 1);
        return {
          originals,
          tags,
          stringIds,
          rawText,
          rawBytes: Buffer.from(fileBytes),
          format,
          meta,
        };
      }
      default:
        return assertNever(format);
    }
  }
}
