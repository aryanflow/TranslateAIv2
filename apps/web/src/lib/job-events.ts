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

  switch (phase) {
    case "pending":
      return { message: "Queued", tone: "muted" };
    case "extracting":
      return { message: "Reading catalogue", tone: "muted" };
    case "chunking":
      return { message: "Planning batches", tone: "muted" };
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
