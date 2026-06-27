/** Shared sid/ix alignment invariants (ported from v1 gemini_llm.py). */

export type ParsedSidRow = { sid?: number; ix?: number; t?: string; score?: number; fb?: string };

export function isAlignmentError(message: string): boolean {
  return /alignment failed|sid alignment|index alignment|duplicate sid|count alignment/i.test(
    message,
  );
}

export function assertNoDuplicateSids(
  rows: Array<{ sid?: number }>,
  label: string,
): void {
  const seen = new Set<number>();
  for (const row of rows) {
    if (row.sid == null || Number.isNaN(Number(row.sid))) continue;
    const sid = Number(row.sid);
    if (seen.has(sid)) {
      throw new Error(`${label} duplicate sid=${sid} in model response`);
    }
    seen.add(sid);
  }
}

export function assertSidSetMatches(
  expectedIds: readonly number[],
  actualIds: ReadonlySet<number>,
  label: string,
): void {
  const expected = new Set(expectedIds);
  const missing = [...expected].filter((s) => !actualIds.has(s));
  const extra = [...actualIds].filter((s) => !expected.has(s));
  if (missing.length > 0 || extra.length > 0) {
    throw new Error(
      `${label} sid alignment failed: missing [${missing.join(', ')}], extra [${extra.join(', ')}]`,
    );
  }
}

export function assertBatchIndexAlignment(
  batchIndex: number,
  sid: number,
  itemIx: number | undefined,
  label: string,
): void {
  if (itemIx !== undefined && itemIx !== batchIndex) {
    throw new Error(
      `${label} index alignment failed for sid=${sid} at batch index ${batchIndex}: expected ix=${batchIndex}, got ix=${itemIx}`,
    );
  }
}

export function validateTranslationAlignmentStrict(
  texts: string[],
  translations: string[],
  ids: number[],
  parsed: {
    bySid: Map<number, ParsedSidRow>;
    byLegacyId: Map<string, ParsedSidRow>;
  },
): void {
  if (translations.length !== texts.length) {
    throw new Error(
      `Translation count alignment failed: expected ${texts.length}, got ${translations.length}`,
    );
  }

  assertSidSetMatches(ids, new Set(parsed.bySid.keys()), 'Translation');

  for (let i = 0; i < texts.length; i++) {
    const sid = ids[i]!;
    const fromSid = parsed.bySid.get(sid);
    const legacy = parsed.byLegacyId.get(`i${i}`);
    const item = fromSid ?? legacy;

    if (!fromSid && !legacy) {
      throw new Error(
        `Translation sid alignment failed: missing sid=${sid} at batch index ${i}`,
      );
    }

    const resolvedIx = fromSid?.ix ?? legacy?.ix;
    assertBatchIndexAlignment(i, sid, resolvedIx, 'Translation');

    if (fromSid && fromSid.ix !== undefined) {
      assertBatchIndexAlignment(i, sid, fromSid.ix, 'Translation');
    }
  }
}

export function validateScoringAlignmentStrict(
  originals: string[],
  scores: number[],
  feedback: string[],
  ids: number[],
  parsed: {
    bySid: Map<number, ParsedSidRow>;
    byLegacyId: Map<string, ParsedSidRow>;
  },
): void {
  if (
    scores.length !== originals.length ||
    feedback.length !== originals.length
  ) {
    throw new Error('Scoring count alignment failed');
  }

  assertSidSetMatches(ids, new Set(parsed.bySid.keys()), 'Scoring');

  for (let i = 0; i < originals.length; i++) {
    const sid = ids[i]!;
    const fromSid = parsed.bySid.get(sid);
    const legacy = parsed.byLegacyId.get(`s${i}`);
    if (!fromSid && !legacy) {
      throw new Error(
        `Scoring sid alignment failed: missing sid=${sid} at batch index ${i}`,
      );
    }
    const resolvedIx = fromSid?.ix ?? legacy?.ix;
    assertBatchIndexAlignment(i, sid, resolvedIx, 'Scoring');
    if (fromSid?.ix !== undefined) {
      assertBatchIndexAlignment(i, sid, fromSid.ix, 'Scoring');
    }
  }
}
