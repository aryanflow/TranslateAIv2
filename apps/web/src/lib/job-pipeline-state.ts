/** Batch tile states driven by Nest SSE `batchStep` + phase payloads. */

export type BatchStep =
  | "queued"
  | "translate_sending"
  | "translate_waiting"
  | "judge_sending"
  | "judge_waiting"
  | "judge_done"
  | "retrying"
  | "done"
  | "failed";

export type BatchTile = {
  index: number;
  localIndex: number;
  stringCount: number;
  step: BatchStep;
  targetLang: string | null;
  attempt: number;
  judgeScoreAvg: number | null;
  reviewRound: number;
  updatedAt: number;
};

export type PipelineMacroPhase =
  | "pending"
  | "extracting"
  | "chunking"
  | "translating"
  | "scoring"
  | "regenerating"
  | "completed"
  | "failed"
  | "cancelled";

export type PipelineViewState = {
  macroPhase: PipelineMacroPhase;
  percent: number;
  stringsTotal: number | null;
  stringsDone: number | null;
  batchCount: number;
  batchSize: number | null;
  batches: BatchTile[];
  batchPlanReady: boolean;
  latestDetail: string | null;
  targetLang: string | null;
  lastEventAt: number;
  activeBatchIndices: number[];
};

export const INITIAL_PIPELINE_STATE: PipelineViewState = {
  macroPhase: "pending",
  percent: 0,
  stringsTotal: null,
  stringsDone: null,
  batchCount: 0,
  batchSize: null,
  batches: [],
  batchPlanReady: false,
  latestDetail: null,
  targetLang: null,
  lastEventAt: 0,
  activeBatchIndices: [],
};

const ACTIVE_STEPS = new Set<BatchStep>([
  "translate_sending",
  "translate_waiting",
  "judge_sending",
  "judge_waiting",
  "retrying",
]);

function num(payload: Record<string, unknown>, key: string): number | undefined {
  const v = payload[key];
  return typeof v === "number" && Number.isFinite(v) ? v : undefined;
}

function str(payload: Record<string, unknown>, key: string): string | undefined {
  const v = payload[key];
  return typeof v === "string" && v.trim() ? v.trim() : undefined;
}

function inferBatchStep(payload: Record<string, unknown>): BatchStep | undefined {
  const explicit = str(payload, "batchStep");
  if (explicit) return explicit as BatchStep;
  const detail = str(payload, "detail")?.toLowerCase() ?? "";
  if (detail.includes("completed")) return "done";
  if (detail.includes("re-translat") || detail.includes("retry")) return "retrying";
  if (detail.includes("review") || detail.includes("judge") || detail.includes("quality"))
    return "judge_waiting";
  if (detail.includes("translat")) return "translate_waiting";
  return undefined;
}

function macroFromPayload(phase: string): PipelineMacroPhase {
  if (
    phase === "pending" ||
    phase === "extracting" ||
    phase === "chunking" ||
    phase === "translating" ||
    phase === "scoring" ||
    phase === "regenerating" ||
    phase === "completed" ||
    phase === "failed" ||
    phase === "cancelled"
  ) {
    return phase;
  }
  return "translating";
}

function upsertBatch(
  batches: BatchTile[],
  index: number,
  patch: Partial<BatchTile> & { localIndex: number; stringCount: number },
): BatchTile[] {
  const next = [...batches];
  const existing = next.find((b) => b.index === index);
  const base: BatchTile = existing ?? {
    index,
    localIndex: patch.localIndex,
    stringCount: patch.stringCount,
    step: "queued",
    targetLang: null,
    attempt: 1,
    judgeScoreAvg: null,
    reviewRound: 0,
    updatedAt: 0,
  };
  const merged: BatchTile = {
    ...base,
    ...patch,
    index,
    localIndex: patch.localIndex ?? base.localIndex,
    stringCount: patch.stringCount ?? base.stringCount,
  };
  const slot = next.findIndex((b) => b.index === index);
  if (slot >= 0) next[slot] = merged;
  else next.push(merged);
  return next.sort((a, b) => a.index - b.index);
}

function initBatchPlan(
  batchCount: number,
  batchSizes: number[],
  targetLang: string | null,
  ts: number,
): BatchTile[] {
  return Array.from({ length: batchCount }, (_, i) => ({
    index: i,
    localIndex: i,
    stringCount: batchSizes[i] ?? 0,
    step: "queued" as const,
    targetLang,
    attempt: 1,
    judgeScoreAvg: null,
    reviewRound: 0,
    updatedAt: ts,
  }));
}

function computeActive(batches: BatchTile[]): number[] {
  return batches.filter((b) => ACTIVE_STEPS.has(b.step)).map((b) => b.index);
}

export function applyJobPipelineEvent(
  state: PipelineViewState,
  payload: Record<string, unknown>,
): PipelineViewState {
  const phase = str(payload, "phase") ?? "event";
  const ts =
    num(payload, "ts") ??
    (typeof payload.timestamp === "string"
      ? Date.parse(payload.timestamp as string)
      : Date.now());
  const detail = str(payload, "detail") ?? null;
  const percent = num(payload, "percent") ?? state.percent;
  const stringsTotal = num(payload, "stringsTotal") ?? state.stringsTotal;
  const stringsDone = num(payload, "stringsDone") ?? state.stringsDone;
  const targetLang = str(payload, "targetLang") ?? state.targetLang;
  const batchIndex = num(payload, "batchIndex");
  const batchLocalIndex = num(payload, "batchLocalIndex");
  const batchTotal = num(payload, "batchTotal") ?? num(payload, "batchCount");
  const stringCount = num(payload, "stringCount");
  const batchStep = inferBatchStep(payload);
  const attempt = num(payload, "attempt");
  const judgeScoreAvg = num(payload, "judgeScoreAvg");
  const reviewRound = num(payload, "reviewRound");

  let batches = state.batches;
  let batchCount = state.batchCount;
  let batchSize = state.batchSize;
  let batchPlanReady = state.batchPlanReady;

  if (phase === "chunking") {
    const count = num(payload, "batchCount") ?? batchTotal ?? 0;
    const sizesRaw = payload.batchSizes;
    const sizes =
      Array.isArray(sizesRaw) && sizesRaw.every((x) => typeof x === "number")
        ? (sizesRaw as number[])
        : Array.from({ length: count }, () => 0);
    if (count > 0) {
      batchCount = count;
      batchPlanReady = true;
      batches = initBatchPlan(count, sizes, targetLang, ts);
    }
    batchSize = num(payload, "batchSize") ?? batchSize;
  }

  if (batchIndex != null && batchStep) {
    const localIdx = batchLocalIndex ?? batchIndex;
    batches = upsertBatch(batches, batchIndex, {
      localIndex: localIdx,
      stringCount: stringCount ?? batches.find((b) => b.index === batchIndex)?.stringCount ?? 0,
      step: batchStep,
      targetLang: targetLang ?? null,
      attempt: attempt ?? batches.find((b) => b.index === batchIndex)?.attempt ?? 1,
      judgeScoreAvg:
        judgeScoreAvg ??
        batches.find((b) => b.index === batchIndex)?.judgeScoreAvg ??
        null,
      reviewRound:
        reviewRound ??
        batches.find((b) => b.index === batchIndex)?.reviewRound ??
        0,
      updatedAt: ts,
    });
    if (batchTotal != null && batchTotal > batchCount) batchCount = batchTotal;
  }

  if (phase === "completed") {
    batches = batches.map((b) =>
      b.step === "done"
        ? b
        : { ...b, step: "done" as const, updatedAt: ts },
    );
  }

  return {
    macroPhase: macroFromPayload(phase),
    percent,
    stringsTotal,
    stringsDone,
    batchCount: batchCount || batches.length,
    batchSize,
    batches,
    batchPlanReady,
    latestDetail: detail ?? state.latestDetail,
    targetLang,
    lastEventAt: ts,
    activeBatchIndices: computeActive(batches),
  };
}

export function batchStepLabel(step: BatchStep): string {
  switch (step) {
    case "queued":
      return "Queued";
    case "translate_sending":
      return "Sending to translator";
    case "translate_waiting":
      return "Translator responding";
    case "judge_sending":
      return "Sending to reviewer";
    case "judge_waiting":
      return "Reviewer scoring";
    case "judge_done":
      return "Review complete";
    case "retrying":
      return "Retrying strings";
    case "done":
      return "Done";
    case "failed":
      return "Failed";
    default:
      return step;
  }
}

export function batchStepShort(step: BatchStep): string {
  switch (step) {
    case "queued":
      return "Wait";
    case "translate_sending":
      return "Send";
    case "translate_waiting":
      return "LLM";
    case "judge_sending":
      return "Judge→";
    case "judge_waiting":
      return "Judge";
    case "judge_done":
      return "Scored";
    case "retrying":
      return "Retry";
    case "done":
      return "✓";
    case "failed":
      return "!";
    default:
      return "…";
  }
}

const MACRO_STEPS: { id: PipelineMacroPhase; label: string }[] = [
  { id: "extracting", label: "Read file" },
  { id: "chunking", label: "Plan batches" },
  { id: "translating", label: "Translate" },
  { id: "scoring", label: "Review" },
  { id: "regenerating", label: "Build file" },
  { id: "completed", label: "Done" },
];

export function macroStepIndex(phase: PipelineMacroPhase): number {
  if (phase === "pending") return -1;
  if (phase === "failed" || phase === "cancelled") return -2;
  const idx = MACRO_STEPS.findIndex((s) => s.id === phase);
  if (idx >= 0) return idx;
  if (phase === "translating" || phase === "scoring") {
    return MACRO_STEPS.findIndex((s) => s.id === phase);
  }
  return 0;
}

export { MACRO_STEPS };
