import { preserveUiCatalogMarks } from './preserve-ui-catalog-marks';
import {
  indicesWithMechanicalFailure,
  type MechanicalFailure,
} from './translation-mechanical-qa';

export function applyBatchUiRepairs(
  originals: readonly string[],
  translations: readonly string[],
): string[] {
  return originals.map((src, i) =>
    preserveUiCatalogMarks(src, translations[i] ?? ''),
  );
}

/** After deterministic repair, only unfixable mechanical rows need LLM retry. */
export function mechanicalFailuresAfterRepair(
  originals: readonly string[],
  translations: readonly string[],
  stringIds: readonly number[],
): MechanicalFailure[] {
  const repaired = applyBatchUiRepairs(originals, translations);
  return indicesWithMechanicalFailure(originals, repaired, stringIds);
}

export function indicesBelowScoreThreshold(
  scores: readonly number[],
  threshold10: number,
): number[] {
  const out: number[] = [];
  for (let i = 0; i < scores.length; i++) {
    if ((scores[i] ?? 0) < threshold10) out.push(i);
  }
  return out;
}

export function uniqueSortedIndices(indices: readonly number[]): number[] {
  return [...new Set(indices)].sort((a, b) => a - b);
}

export function mergeTargetedTranslations(
  batch: readonly string[],
  current: string[],
  targetIndices: readonly number[],
  newTranslations: readonly string[],
): string[] {
  const next = [...current];
  for (let j = 0; j < targetIndices.length; j++) {
    const bi = targetIndices[j]!;
    const src = batch[bi] ?? '';
    next[bi] = preserveUiCatalogMarks(src, newTranslations[j] ?? next[bi] ?? '');
  }
  return next;
}

export function placeholderTranslationsForIndices(
  batch: readonly string[],
  indices: readonly number[],
  stringIds: readonly number[],
  reason: string,
): string[] {
  return indices.map((bi) => {
    const src = batch[bi] ?? '';
    const sid = stringIds[bi] ?? bi + 1;
    return `[TRANSLATION_INCOMPLETE sid=${sid}: ${reason} · ${src.slice(0, 40)}…]`;
  });
}
