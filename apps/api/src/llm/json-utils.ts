/** Extract first JSON object from model output (matches Python gemini/langdock parsers). */
export function extractJsonObject(raw: string): string {
  let cleaned = raw.trim();
  if (cleaned.startsWith('```json')) cleaned = cleaned.slice(7);
  if (cleaned.startsWith('```')) cleaned = cleaned.slice(3);
  if (cleaned.endsWith('```')) cleaned = cleaned.slice(0, -3);
  cleaned = cleaned.trim();
  const start = cleaned.indexOf('{');
  const end = cleaned.lastIndexOf('}') + 1;
  if (start === -1 || end <= start) {
    throw new Error('No JSON object found in response');
  }
  return cleaned.slice(start, end);
}
