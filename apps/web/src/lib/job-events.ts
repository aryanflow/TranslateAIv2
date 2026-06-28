export type JobEventTone = "muted" | "info" | "success" | "warn" | "danger";

function phaseLabelNeutral(slug: string) {
  if (!slug) return "Update";
  return slug.charAt(0).toUpperCase() + slug.slice(1).replace(/_/g, " ");
}

/** Maps Nest job SSE payloads to human-readable timeline lines. */
export function sseToFriendlyLine(payload: Record<string, unknown>): {
  message: string;
  tone: JobEventTone;
} {
  const phase = typeof payload.phase === "string" ? payload.phase : "event";
  const batchStep =
    typeof payload.batchStep === "string" ? payload.batchStep.trim() : "";
  const batchLocal =
    typeof payload.batchLocalIndex === "number"
      ? payload.batchLocalIndex + 1
      : typeof payload.batchIndex === "number"
        ? payload.batchIndex + 1
        : undefined;

  if (batchStep) {
    const batchPrefix = batchLocal != null ? `Batch ${batchLocal}` : "Batch";
    switch (batchStep) {
      case "translate_sending":
        return { message: `${batchPrefix} · sending to translator`, tone: "info" };
      case "translate_waiting":
        return { message: `${batchPrefix} · translator responding…`, tone: "info" };
      case "judge_sending":
        return { message: `${batchPrefix} · sending to reviewer`, tone: "info" };
      case "judge_waiting":
        return { message: `${batchPrefix} · reviewer scoring…`, tone: "info" };
      case "judge_done":
        return { message: `${batchPrefix} · review scored`, tone: "info" };
      case "retrying":
        return { message: `${batchPrefix} · retrying low-score strings`, tone: "warn" };
      case "done":
        return { message: `${batchPrefix} · completed`, tone: "success" };
      case "queued":
        return { message: `${batchPrefix} · queued`, tone: "muted" };
      default:
        break;
    }
  }

  switch (phase) {
    case "pending":
      return { message: "Queued", tone: "muted" };
    case "extracting":
      return { message: "Reading catalogue", tone: "muted" };
    case "chunking": {
      const detail =
        typeof payload.detail === "string" ? payload.detail.trim() : "";
      if (detail) return { message: detail, tone: "info" };
      return { message: "Breaking into batches", tone: "info" };
    }
    case "translating": {
      const detail =
        typeof payload.detail === "string" ? payload.detail.trim() : "";
      if (detail) return { message: detail, tone: "info" };
      const bi =
        typeof payload.batchIndex === "number" ? payload.batchIndex : undefined;
      return {
        message:
          bi !== undefined ? `Translating · batch ${bi + 1}` : "Translating",
        tone: "info",
      };
    }
    case "scoring": {
      const detail =
        typeof payload.detail === "string" ? payload.detail.trim() : "";
      if (detail) return { message: detail, tone: "info" };
      const bi =
        typeof payload.batchIndex === "number" ? payload.batchIndex : undefined;
      return {
        message:
          bi !== undefined ? `Quality review · batch ${bi + 1}` : "Quality review",
        tone: "info",
      };
    }
    case "regenerating":
      return { message: "Building deliverables", tone: "muted" };
    case "completed":
      return { message: "Completed", tone: "success" };
    case "failed": {
      const err =
        typeof payload.error === "string" ? payload.error : "Something went wrong";
      return {
        message: err.length > 120 ? `${err.slice(0, 117)}…` : err,
        tone: "danger",
      };
    }
    case "cancelled":
      return { message: "Cancelled", tone: "warn" };
    default:
      return { message: phaseLabelNeutral(phase), tone: "info" };
  }
}

const ACTIVE_JOB = new Set([
  "pending",
  "extracting",
  "chunking",
  "translating",
  "scoring",
  "regenerating",
]);

export function isActiveJobStatus(status: string): boolean {
  return ACTIVE_JOB.has(status);
}
