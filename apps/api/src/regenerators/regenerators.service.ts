import { Injectable } from '@nestjs/common';
import type { SourceFormat } from '../extractors/extraction.types';
import { regenerateXml } from '../extractors/xml.format';
import { regenerateJson } from '../extractors/json.format';
import { regenerateCsv } from '../extractors/csv.format';
import { regenerateExcel } from '../extractors/excel.format';

function assertNever(x: never): never {
  throw new Error(`Unsupported format: ${JSON.stringify(x)}`);
}

export type RegenerateInput = {
  format: SourceFormat;
  /** xml, json, csv as utf-8 string; excel uses rawBytes */
  rawText: string;
  rawBytes?: Buffer;
  translationMap: Record<string, string>;
  selectedColumns?: string[];
  selectedSheet?: string;
};

@Injectable()
export class RegeneratorsService {
  regenerate(input: RegenerateInput): {
    body: string | Buffer;
    contentType: string;
  } {
    const {
      format,
      rawText,
      rawBytes,
      translationMap,
      selectedColumns,
      selectedSheet,
    } = input;

    switch (format) {
      case 'xml':
        return {
          body: regenerateXml(rawText, translationMap),
          contentType: 'application/xml; charset=utf-8',
        };
      case 'json':
        return {
          body: regenerateJson(rawText, translationMap),
          contentType: 'application/json; charset=utf-8',
        };
      case 'csv':
        return {
          body: regenerateCsv(rawText, translationMap, selectedColumns),
          contentType: 'text/csv; charset=utf-8',
        };
      case 'excel': {
        if (!rawBytes) {
          throw new Error(
            'Excel regeneration requires rawBytes of the original workbook',
          );
        }
        if (!selectedSheet) {
          throw new Error('Excel regeneration requires selectedSheet in meta');
        }
        const out = regenerateExcel(
          rawBytes,
          translationMap,
          selectedSheet,
          selectedColumns,
        );
        return {
          body: out,
          contentType:
            'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        };
      }
      default:
        return assertNever(format);
    }
  }
}
