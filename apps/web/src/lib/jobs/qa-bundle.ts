/** Client-side QA bundle parsing + CSV exports (parity with reviewer artifacts). */

export type QaReviewRow = {
  string_id: number;
  source_path: string;
  original: string;
  translation: string;
  reviewer_score_0_to_10: number;
  reviewer_notes: string;
  meets_accuracy_threshold?: boolean;
  translator_attempt_number?: number;
};

export function csvEscapeCell(v: string | number | boolean): string {
  const s = String(v);
  if (/[",\r\n]/.test(s)) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

export function qaRowsToCompactTableCsv(rows: readonly QaReviewRow[]): string {
  const headers = [
    "id",
    "source_path",
    "original",
    "translated",
    "score_0_to_10",
    "reviewer_feedback_judge",
  ] as const;
  const lines = [
    headers.join(","),
    ...rows.map((r) =>
      [
        csvEscapeCell(r.string_id),
        csvEscapeCell(r.source_path),
        csvEscapeCell(r.original),
        csvEscapeCell(r.translation),
        csvEscapeCell(r.reviewer_score_0_to_10),
        csvEscapeCell(r.reviewer_notes),
      ].join(","),
    ),
  ];
  return lines.join("\n");
}

export function qaRowsToReplacedStringsCsv(rows: readonly QaReviewRow[]): string {
  const headers = [
    "id",
    "source_path",
    "original",
    "translated",
    "score_0_to_10",
    "reviewer_feedback_judge",
  ] as const;
  const lines = [
    headers.join(","),
    ...rows.map((r) =>
      [
        csvEscapeCell(r.string_id),
        csvEscapeCell(r.source_path),
        csvEscapeCell(r.translation),
        csvEscapeCell(r.translation),
        csvEscapeCell(r.reviewer_score_0_to_10),
        csvEscapeCell(r.reviewer_notes),
      ].join(","),
    ),
  ];
  return lines.join("\n");
}

export function parseQaBundle(data: unknown): {
  rows: QaReviewRow[];
  threshold10: number | null;
  jobId?: string;
} | null {
  if (!data || typeof data !== "object") return null;
  const o = data as Record<string, unknown>;
  const strings = o.strings;
  if (!Array.isArray(strings)) return null;

  const rows: QaReviewRow[] = [];
  for (const item of strings) {
    if (!item || typeof item !== "object") continue;
    const r = item as Record<string, unknown>;
    if (
      typeof r.string_id !== "number" ||
      typeof r.original !== "string" ||
      typeof r.translation !== "string" ||
      typeof r.reviewer_score_0_to_10 !== "number" ||
      typeof r.reviewer_notes !== "string"
    ) {
      continue;
    }
    rows.push({
      string_id: r.string_id,
      source_path: typeof r.source_path === "string" ? r.source_path : "",
      original: r.original,
      translation: r.translation,
      reviewer_score_0_to_10: r.reviewer_score_0_to_10,
      reviewer_notes: r.reviewer_notes,
      meets_accuracy_threshold:
        typeof r.meets_accuracy_threshold === "boolean" ? r.meets_accuracy_threshold : undefined,
      translator_attempt_number:
        typeof r.translator_attempt_number === "number" ? r.translator_attempt_number : undefined,
    });
  }
  if (rows.length === 0) return null;

  const threshold10Raw = o.accuracy_threshold_0_to_10;
  const threshold10 = typeof threshold10Raw === "number" ? threshold10Raw : null;
  const jobIdRaw = o.job_id;
  const jobId = typeof jobIdRaw === "string" ? jobIdRaw : undefined;
  return { rows, threshold10, jobId };
}

export function reviewerMean(rows: readonly QaReviewRow[]): number | null {
  if (!rows.length) return null;
  let sum = 0;
  for (const r of rows) {
    sum += r.reviewer_score_0_to_10;
  }
  return sum / rows.length;
}

export function pickQaBundleKey(urls: string[]): string | null {
  const k = urls.find((u) => u.endsWith(".qa-bundle.json"));
  return k ?? null;
}

export function pickPrimaryTranslatedArtifactKey(urls: string[]): string | null {
  const k = urls.find(
    (u) =>
      !u.endsWith(".qa-bundle.json") && !u.endsWith(".translation-review.csv"),
  );
  return k ?? null;
}
