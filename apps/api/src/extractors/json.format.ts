/** aptos-translateai/extractor/json_extractor.py — string leaf values only; object keys are never sent for translation. */
export function extractJson(fileBytes: Buffer): {
  originals: string[];
  tags: string[];
  rawText: string;
} {
  const content = fileBytes.toString('utf-8');
  let data: unknown;
  try {
    data = JSON.parse(content);
  } catch (e) {
    throw new Error(
      `Invalid JSON format: ${e instanceof Error ? e.message : String(e)}`,
    );
  }

  const originals: string[] = [];
  const tags: string[] = [];

  function extractFromDict(obj: Record<string, unknown>, prefix: string): void {
    for (const [key, value] of Object.entries(obj)) {
      const currentKey = prefix ? `${prefix}.${key}` : key;
      if (typeof value === 'string') {
        if (value.trim()) {
          originals.push(value.trim());
          tags.push(currentKey);
        }
      } else if (value && typeof value === 'object' && !Array.isArray(value)) {
        extractFromDict(value as Record<string, unknown>, currentKey);
      } else if (Array.isArray(value)) {
        value.forEach((item, i) => {
          if (typeof item === 'string' && item.trim()) {
            originals.push(item.trim());
            tags.push(`${currentKey}[${i}]`);
          } else if (item && typeof item === 'object' && !Array.isArray(item)) {
            extractFromDict(
              item as Record<string, unknown>,
              `${currentKey}[${i}]`,
            );
          }
        });
      }
    }
  }

  if (typeof data === 'object' && data !== null && !Array.isArray(data)) {
    extractFromDict(data as Record<string, unknown>, '');
  } else if (Array.isArray(data)) {
    data.forEach((item, i) => {
      if (typeof item === 'string' && item.trim()) {
        originals.push(item.trim());
        tags.push(`[${i}]`);
      } else if (item && typeof item === 'object' && !Array.isArray(item)) {
        extractFromDict(item as Record<string, unknown>, `[${i}]`);
      }
    });
  } else {
    throw new Error('JSON must contain an object or array at the root level');
  }

  return { originals, tags, rawText: content };
}

/** Apply translations keyed by extractor tag paths (handles duplicate source strings). */
export function regenerateJson(
  originalJson: string,
  tagTranslationMap: Record<string, string>,
): string {
  let data: unknown;
  try {
    data = JSON.parse(originalJson);
  } catch (e) {
    throw new Error(
      `Invalid JSON format: ${e instanceof Error ? e.message : String(e)}`,
    );
  }

  function applyDict(
    obj: Record<string, unknown>,
    prefix: string,
  ): Record<string, unknown> {
    const result: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(obj)) {
      const path = prefix ? `${prefix}.${key}` : key;
      result[key] = applyValue(value, path);
    }
    return result;
  }

  function applyValue(value: unknown, path: string): unknown {
    if (typeof value === 'string') {
      const t = value.trim();
      if (!t) return value;
      const mapped = tagTranslationMap[path];
      return mapped !== undefined ? mapped : value;
    }
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      return applyDict(value as Record<string, unknown>, path);
    }
    if (Array.isArray(value)) {
      return value.map((item, i) => {
        const p = `${path}[${i}]`;
        return applyArrayItem(item, p);
      });
    }
    return value;
  }

  function applyArrayItem(item: unknown, path: string): unknown {
    if (typeof item === 'string') {
      const t = item.trim();
      if (!t) return item;
      const mapped = tagTranslationMap[path];
      return mapped !== undefined ? mapped : item;
    }
    if (item && typeof item === 'object' && !Array.isArray(item)) {
      return applyDict(item as Record<string, unknown>, path);
    }
    if (Array.isArray(item)) {
      return item.map((sub, j) => applyArrayItem(sub, `${path}[${j}]`));
    }
    return item;
  }

  let translatedData: unknown;
  if (typeof data === 'object' && data !== null && !Array.isArray(data)) {
    translatedData = applyDict(data as Record<string, unknown>, '');
  } else if (Array.isArray(data)) {
    translatedData = data.map((item, i) => applyArrayItem(item, `[${i}]`));
  } else {
    translatedData = data;
  }

  return JSON.stringify(translatedData, null, 4);
}
