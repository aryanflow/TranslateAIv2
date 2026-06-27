/**
 * Deterministic pre-judge checks — catches placeholder / ampersand drift before accept.
 */

const PLACEHOLDER_RE =
  /\{[^{}]+\}|%\d*\$?[sdif]|%\([^)]+\)[sdif]|\{\{[^}]+\}\}/gi;

export function countAmpersands(s: string): number {
  let n = 0;
  for (let i = 0; i < s.length; i++) {
    if (s[i] === '&') n += 1;
  }
  return n;
}

export function countPlaceholders(s: string): number {
  const m = s.match(PLACEHOLDER_RE);
  return m?.length ?? 0;
}

export type MechanicalFailure = {
  index: number;
  stringId: number;
  code: 'AMPERSAND_MISMATCH' | 'PLACEHOLDER_MISMATCH' | 'FAILURE_MARKER';
};

export function indicesWithMechanicalFailure(
  originals: readonly string[],
  translations: readonly string[],
  stringIds: readonly number[],
): MechanicalFailure[] {
  const out: MechanicalFailure[] = [];
  for (let i = 0; i < originals.length; i++) {
    const src = originals[i] ?? '';
    const tgt = translations[i] ?? '';
    const sid = stringIds[i] ?? i + 1;

    if (/^\[TRANSLATION_(FAILED|ERROR)/.test(tgt)) {
      out.push({ index: i, stringId: sid, code: 'FAILURE_MARKER' });
      continue;
    }

    if (countAmpersands(src) !== countAmpersands(tgt)) {
      out.push({ index: i, stringId: sid, code: 'AMPERSAND_MISMATCH' });
    }

    if (countPlaceholders(src) !== countPlaceholders(tgt)) {
      out.push({ index: i, stringId: sid, code: 'PLACEHOLDER_MISMATCH' });
    }
  }
  return out;
}

export function mechanicalFailureSummary(
  failures: readonly MechanicalFailure[],
): string {
  if (!failures.length) return '';
  const byCode = new Map<string, number>();
  for (const f of failures) {
    byCode.set(f.code, (byCode.get(f.code) ?? 0) + 1);
  }
  return [...byCode.entries()]
    .map(([code, n]) => `${code}:${n}`)
    .join(', ');
}
