import { extractJson, regenerateJson } from './json.format';

describe('json.format', () => {
  it('extracts string paths like Python extractor', () => {
    const buf = Buffer.from(
      JSON.stringify({ a: { b: 'Hello' }, list: ['x'] }),
      'utf-8',
    );
    const { originals, tags } = extractJson(buf);
    expect(originals).toContain('Hello');
    expect(tags.some((t) => t.includes('a.b'))).toBe(true);
  });

  it('regenerates JSON using extractor tag paths (duplicate-safe)', () => {
    const raw = JSON.stringify({ msg: 'Hi' }, null, 2);
    const out = regenerateJson(raw, { msg: 'Salut' });
    const parsed = JSON.parse(out) as { msg: string };
    expect(parsed.msg).toBe('Salut');
  });
});
