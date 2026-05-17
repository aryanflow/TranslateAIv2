export function phaseLabel(status: string): string {
  const map: Record<string, string> = {
    pending: "Queued",
    extracting: "Reading file",
    chunking: "Splitting batches",
    translating: "Translating",
    scoring: "Quality review",
    regenerating: "Building download",
    completed: "Done",
    failed: "Failed",
    cancelled: "Cancelled",
  };
  return map[status] ?? status;
}

/** ETA from observed progress velocity (rough heuristic). */
export function estimateEtaSeconds(job: {
  progress: number;
  createdAt: string;
  status: string;
}): number | null {
  if (job.status === "completed" || job.status === "failed" || job.status === "cancelled")
    return null;
  const p = job.progress;
  if (p <= 3) return null;
  const start = new Date(job.createdAt).getTime();
  const elapsedMs = Date.now() - start;
  if (elapsedMs < 2500) return null;
  const etaMs = ((100 - p) * elapsedMs) / p;
  if (!Number.isFinite(etaMs) || etaMs < 0) return null;
  return etaMs / 1000;
}

export function formatDurationSeconds(sec: number): string {
  if (sec < 90) return `${Math.max(5, Math.round(sec))}s`;
  if (sec < 3600) return `${Math.round(sec / 60)} min`;
  return `${(sec / 3600).toFixed(1)} h`;
}

/** Local wall clock for job timeline (live activity Started line). */
export function formatJobStartedLog(isoDate: string): string {
  const d = new Date(isoDate);
  if (Number.isNaN(d.getTime())) return isoDate;
  try {
    // `timeZoneName` + `dateStyle`/`timeStyle` together reject in many engines (Node, some browsers).
    return d.toLocaleString(undefined, {
      dateStyle: "medium",
      timeStyle: "medium",
    });
  } catch {
    return d.toISOString();
  }
}
