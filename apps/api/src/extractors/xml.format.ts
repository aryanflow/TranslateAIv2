import { decode } from 'entities';

/**
 * Extract / regenerate XML following aptos-translateai/extractor/xml_extractor.py and app.regenerate_xml.
 */
export function extractXml(fileBytes: Buffer): {
  originals: string[];
  tags: string[];
  rawText: string;
} {
  const content = fileBytes.toString('utf-8');
  const originals: string[] = [];
  const tags: string[] = [];

  const pattern =
    /<([a-zA-Z0-9_:-]+)([^>]*)>\s*<original_string>(.*?)<\/original_string>\s*<\/\1>/gis;
  const matches = [...content.matchAll(pattern)];

  if (matches.length > 0) {
    const preferredKeys = [
      'name',
      'id',
      'key',
      'code',
      'label',
      'title',
      'text',
      'value',
    ];
    for (const m of matches) {
      const tag = m[1];
      const attrText = m[2] ?? '';
      const inner = m[3] ?? '';
      let label = tag;
      const attrPairs = [
        ...attrText.matchAll(/([A-Za-z_:][-A-Za-z0-9_:.]*)\s*=\s*"(.*?)"/g),
      ];
      const attrMap: Record<string, string> = {};
      for (const [, k, v] of attrPairs) {
        attrMap[k.toLowerCase()] = v;
      }
      for (const k of preferredKeys) {
        if (attrMap[k]) {
          label = `${tag}:${attrMap[k]}`;
          break;
        }
      }
      tags.push(label);
      originals.push(inner.trim());
    }
  } else {
    const plain = /<original_string>(.*?)<\/original_string>/gis;
    const m2 = [...content.matchAll(plain)];
    for (const m of m2) {
      tags.push('original_string');
      originals.push(decode((m[1] ?? '').trim()));
    }
  }

  return { originals, tags, rawText: content };
}

export function regenerateXml(
  originalXml: string,
  _originalsOrdered: string[],
  translationsOrdered: string[],
): string {
  const escapeXml = (s: string) =>
    s
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');

  const unescape = (s: string) => decode(s);

  let idx = 0;
  const pattern = /<original_string>(.*?)<\/original_string>/gis;
  return originalXml.replace(pattern, (full, inner: string) => {
    const slot = idx;
    idx += 1;
    const originalText = unescape(inner.trim());
    const trans =
      slot < translationsOrdered.length ? translationsOrdered[slot] : originalText;
    return `${full}\n        <translated_string>${escapeXml(trans)}</translated_string>`;
  });
}
