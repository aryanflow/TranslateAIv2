/** aptos-translateai/extractor/json_extractor.py */
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

export function regenerateJson(
  originalJson: string,
  translationMap: Record<string, string>,
): string {
  let data: unknown;
  try {
    data = JSON.parse(originalJson);
  } catch (e) {
    throw new Error(
      `Invalid JSON format: ${e instanceof Error ? e.message : String(e)}`,
    );
  }

  function translateDict(
    obj: Record<string, unknown>,
  ): Record<string, unknown> {
    const result: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(obj)) {
      if (typeof value === 'string') {
        const translated = translationMap[value.trim()] ?? value;
        result[key] = translated;
      } else if (value && typeof value === 'object' && !Array.isArray(value)) {
        result[key] = translateDict(value as Record<string, unknown>);
      } else if (Array.isArray(value)) {
        result[key] = translateList(value);
      } else {
        result[key] = value;
      }
    }
    return result;
  }

  function translateList(arr: unknown[]): unknown[] {
    return arr.map((item) => {
      if (typeof item === 'string') {
        return translationMap[item.trim()] ?? item;
      }
      if (item && typeof item === 'object' && !Array.isArray(item)) {
        return translateDict(item as Record<string, unknown>);
      }
      if (Array.isArray(item)) {
        return translateList(item);
      }
      return item;
    });
  }

  let translatedData: unknown;
  if (typeof data === 'object' && data !== null && !Array.isArray(data)) {
    translatedData = translateDict(data as Record<string, unknown>);
  } else if (Array.isArray(data)) {
    translatedData = translateList(data);
  } else {
    translatedData = data;
  }

  return JSON.stringify(translatedData, null, 4);
}
