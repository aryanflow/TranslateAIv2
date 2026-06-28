"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  parseQaBundle,
  pickPrimaryTranslatedArtifactKey,
  pickQaBundleKey,
  qaRowsToCompactTableCsv,
  reviewerMean,
  type QaReviewRow,
} from "@/lib/jobs/qa-bundle";
import { withShortJobIdInFilename } from "@/lib/jobs/download-filename";
import {
  API_PREFIX,
  TENANT_ID,
  apiHeaders,
  formatApiError,
  jobEventsUrl,
  readUpstreamErrorBody,
  tenantOnlyHeaders,
} from "@/lib/dev-api";
import { langLabel } from "@/lib/lang-options";
import { sseToFriendlyLine } from "@/lib/job-events";
import {
  applyJobPipelineEvent,
  INITIAL_PIPELINE_STATE,
  type PipelineViewState,
} from "@/lib/job-pipeline-state";
import { JobPipelineVisualizer } from "@/components/jobs/JobPipelineVisualizer";
import { estimateEtaSeconds, formatDurationSeconds } from "@/components/jobs/job-visual-utils";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";

const JD = {
  bg: "#0A0A0A",
  surface: "#111111",
  border: "#1F1F1F",
  fg: "#F5F5F5",
  muted: "#6B6B6B",
  accent: "#D4A847",
  success: "#3ECF8E",
  danger: "#F87171",
  hover: "#1A1A1A",
  rowWash: "#141414",
} as const;

type JobDetailApi = {
  id: string;
  status: string;
  progress: number;
  sourceLang: string;
  targetLangs: string[];
  stringsTotal: number | null;
  batchTotal: number | null;
  batchesCompleted: number;
  batchSize?: number;
  fileKey?: string;
  uploadFileLabel?: string;
  retriedBatchCount?: number;
  createdAt: string;
  updatedAt: string;
  errorMessage: string | null;
  resultUrls: string[];
  judgePassScoreMin10?: number;
};

type LogTone = "muted" | "info" | "success" | "warn" | "danger";

type LogRow = { id: string; atMs: number; message: string; tone: LogTone };

const ACTIVE = new Set([
  "pending",
  "extracting",
  "chunking",
  "translating",
  "scoring",
  "regenerating",
]);

function monoClass() {
  return "font-[family-name:var(--jd-mono),ui-monospace,monospace]";
}

function truncateJobId(uuid: string) {
  return uuid.replace(/-/g, "").slice(0, 8).toLowerCase();
}

function formatLogClock(ms: number) {
  const d = new Date(ms);
  try {
    return new Intl.DateTimeFormat(undefined, {
      hour: "numeric",
      minute: "2-digit",
      second: "2-digit",
    }).format(d);
  } catch {
    return d.toISOString().slice(11, 19);
  }
}

function formatDurationApprox(startIso: string, endIso: string) {
  const a = new Date(startIso).getTime();
  const b = new Date(endIso).getTime();
  if (Number.isNaN(a) || Number.isNaN(b) || b < a) return "—";
  const secTotal = Math.round((b - a) / 1000);
  if (secTotal < 3600) {
    const m = Math.floor(secTotal / 60);
    const s = secTotal % 60;
    if (m <= 0) return `${secTotal}s`;
    return `${m}m ${String(s)}s`;
  }
  const h = Math.floor(secTotal / 3600);
  const rem = secTotal % 3600;
  const m = Math.round(rem / 60);
  return `${h}h ${m}m`;
}

const TEXT_PREVIEW_KEY_RE =
  /\.(json|xml|csv|txt|md|tsv|htm|html|svg)(\?|#|$)/i;

function objectKeyUsesTextPreview(key: string): boolean {
  const path = key.split("?")[0]?.split("#")[0] ?? key;
  return TEXT_PREVIEW_KEY_RE.test(path);
}

function formatTextPreviewBody(raw: string, key: string): string {
  const base = key.split("?")[0]?.toLowerCase() ?? "";
  if (base.endsWith(".json")) {
    try {
      return JSON.stringify(JSON.parse(raw) as unknown, null, 2);
    } catch {
      return raw;
    }
  }
  return raw;
}

type FilePreviewPanelState =
  | { kind: "closed" }
  | { kind: "loading"; title: string }
  | { kind: "text"; title: string; body: string }
  | { kind: "iframe"; title: string; url: string }
  | { kind: "error"; title: string; message: string };

function sseToLogLine(payload: Record<string, unknown>): { message: string; tone: LogTone } {
  const mapped = sseToFriendlyLine(payload);
  return { message: mapped.message, tone: mapped.tone as LogTone };
}

function DocIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      width={14}
      height={14}
      viewBox="0 0 24 24"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden
    >
      <path
        d="M7 3.5h6l5 5V20a.5.5 0 0 1-.5.5H7A1.5 1.5 0 0 1 5.5 19V5A1.5 1.5 0 0 1 7 3.5Z"
        stroke="currentColor"
        strokeWidth={1.4}
      />
      <path d="M13 4v5h5" stroke="currentColor" strokeWidth={1.4} strokeLinejoin="round" />
    </svg>
  );
}

function dotToneClass(tone: LogTone, pulse?: boolean) {
  const base =
    tone === "success"
      ? "bg-[#3ECF8E]"
      : tone === "danger"
        ? "bg-[#F87171]"
        : tone === "warn"
          ? "bg-[#D4A847]"
          : tone === "info"
            ? "bg-[#6B6B6B]"
            : "bg-[#4b4b4b]";
  return cn(
    "mt-1 h-1 w-1 shrink-0 rounded-full",
    base,
    pulse && "jd-job-log-dot-pulse",
  );
}

export function JobDetailView({ jobId }: { jobId: string }) {
  const [job, setJob] = useState<JobDetailApi | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [qaRows, setQaRows] = useState<QaReviewRow[] | null>(null);
  const [qaMean, setQaMean] = useState<number | null>(null);
  const [qaLoading, setQaLoading] = useState(false);
  const [log, setLog] = useState<LogRow[]>([]);
  const [pipeline, setPipeline] = useState<PipelineViewState>(INITIAL_PIPELINE_STATE);
  const [reviewOpen, setReviewOpen] = useState(false);
  const [reviewSearch, setReviewSearch] = useState("");
  const [idCopied, setIdCopied] = useState(false);
  const [cancelBusy, setCancelBusy] = useState(false);
  const [filePreview, setFilePreview] = useState<FilePreviewPanelState>({ kind: "closed" });

  const logRef = useRef<LogRow[]>([]);

  useEffect(() => {
    logRef.current = log;
  }, [log]);

  const tenantOk = TENANT_ID.length > 0;

  const translatedKey = job?.resultUrls?.length ? pickPrimaryTranslatedArtifactKey(job.resultUrls) : null;
  const qaBundleStorageKey = job?.resultUrls?.length ? pickQaBundleKey(job.resultUrls) : null;

  const translatedLabel =
    translatedKey?.split("/").pop()?.replace(/^results\/?/, "") ??
    null;

  const active = Boolean(job && ACTIVE.has(job.status));
  const terminal =
    job?.status === "completed" || job?.status === "failed" || job?.status === "cancelled";

  const requestDownloadUrl = async (key: string) => {
    const res = await fetch(`${API_PREFIX}/files/download-url`, {
      method: "POST",
      headers: apiHeaders(),
      body: JSON.stringify({ key }),
    });
    if (!res.ok) throw new Error(await readUpstreamErrorBody(res));
    return (await res.json()) as { url: string };
  };

  const downloadKey = async (key: string, fallbackName: string) => {
    try {
      const { url } = await requestDownloadUrl(key);
      const a = document.createElement("a");
      a.href = url;
      const id = job?.id ?? jobId;
      a.download = withShortJobIdInFilename(fallbackName, id);
      a.target = "_blank";
      a.rel = "noopener noreferrer";
      a.click();
    } catch (e) {
      setLoadError(formatApiError(e));
    }
  };

  const previewKey = async (key: string, title: string) => {
    setFilePreview({ kind: "loading", title });
    try {
      const { url } = await requestDownloadUrl(key);
      if (objectKeyUsesTextPreview(key)) {
        const r = await fetch(url, { credentials: "omit" });
        if (!r.ok) {
          setFilePreview({
            kind: "error",
            title,
            message: `Could not load file (HTTP ${String(r.status)}).`,
          });
          return;
        }
        const raw = await r.text();
        setFilePreview({
          kind: "text",
          title,
          body: formatTextPreviewBody(raw, key),
        });
      } else {
        setFilePreview({ kind: "iframe", title, url });
      }
    } catch (e) {
      setFilePreview({
        kind: "error",
        title,
        message: formatApiError(e),
      });
    }
  };

  const fetchJob = useCallback(async () => {
    if (!tenantOk) return;
    const res = await fetch(`${API_PREFIX}/jobs/${jobId}`, { headers: apiHeaders() });
    if (res.status === 404) {
      setJob(null);
      setLoadError("Job not found");
      return;
    }
    if (!res.ok) throw new Error(await readUpstreamErrorBody(res));
    const data = (await res.json()) as JobDetailApi;
    setJob(data);
    setPipeline((prev) => ({
      ...prev,
      percent: data.progress,
      stringsTotal: data.stringsTotal ?? prev.stringsTotal,
      batchCount: data.batchTotal ?? prev.batchCount,
      macroPhase:
        data.status === "completed" ||
        data.status === "failed" ||
        data.status === "cancelled"
          ? (data.status as PipelineViewState["macroPhase"])
          : (data.status as PipelineViewState["macroPhase"]) || prev.macroPhase,
    }));
    setLoadError(null);
  }, [tenantOk, jobId]);

  const cancelJob = useCallback(async () => {
    if (!tenantOk) return;
    setCancelBusy(true);
    setLoadError(null);
    try {
      const res = await fetch(`${API_PREFIX}/jobs/${jobId}/cancel`, {
        method: "POST",
        headers: tenantOnlyHeaders(),
      });
      if (!res.ok) {
        const detail = await readUpstreamErrorBody(res);
        throw new Error(`Cancel failed (${res.status}): ${detail}`);
      }
      await fetchJob();
    } catch (e) {
      setLoadError(formatApiError(e));
    } finally {
      setCancelBusy(false);
    }
  }, [tenantOk, jobId, fetchJob]);

  useEffect(() => {
    void (async () => {
      try {
        await fetchJob();
      } catch (e) {
        setLoadError(formatApiError(e));
      }
    })();
  }, [fetchJob]);

  /** Poll lightly while pipeline runs. */
  useEffect(() => {
    if (!tenantOk || !job || !active) return;
    const id = window.setInterval(() => {
      void fetchJob().catch((e) => setLoadError(formatApiError(e)));
    }, 4000);
    return () => window.clearInterval(id);
  }, [tenantOk, job, active, fetchJob]);

  useEffect(() => {
    if (filePreview.kind === "closed") return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setFilePreview({ kind: "closed" });
    };
    window.addEventListener("keydown", onKey);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = prevOverflow;
    };
  }, [filePreview.kind]);

  /** Seed timeline for terminal jobs (no SSE history). */
  useEffect(() => {
    if (!job || ACTIVE.has(job.status)) return;
    if (logRef.current.length) return;
    const rows: LogRow[] = [
      {
        id: "started",
        atMs: Date.parse(job.createdAt),
        message: "Job started",
        tone: "muted",
      },
    ];
    if (job.status === "completed") {
      rows.push({
        id: "done",
        atMs: Date.parse(job.updatedAt),
        message: "Completed",
        tone: "success",
      });
    }
    if (job.status === "failed") {
      rows.push({
        id: "fail",
        atMs: Date.parse(job.updatedAt),
        message: job.errorMessage?.slice(0, 160) ?? "Failed",
        tone: "danger",
      });
    }
    if (job.status === "cancelled") {
      rows.push({
        id: "cancelled",
        atMs: Date.parse(job.updatedAt),
        message: job.errorMessage?.slice(0, 160) ?? "Cancelled",
        tone: "warn",
      });
    }
    setLog(rows);
  }, [job]);

  /** Active job: open log with start line, SSE appends humane updates. */
  useEffect(() => {
    if (!tenantOk || !job || typeof EventSource === "undefined") return;
    if (!ACTIVE.has(job.status)) return;

    if (!logRef.current.length) {
      setLog([
        {
          id: `start-${job.id}`,
          atMs: Date.parse(job.createdAt),
          message: "Job started",
          tone: "muted",
        },
      ]);
    }

    const url = jobEventsUrl(job.id);
    const es = new EventSource(url);

    es.onmessage = (ev) => {
      try {
        const payload = JSON.parse(ev.data as string) as Record<string, unknown>;
        const { message, tone } = sseToLogLine(payload);
        setPipeline((prev) => applyJobPipelineEvent(prev, payload));
        const atMs =
          typeof payload.ts === "number"
            ? payload.ts
            : typeof payload.timestamp === "string"
              ? Date.parse(payload.timestamp as string)
              : Date.now();
        setLog((prev) => {
          const prevLast = prev[prev.length - 1];
          if (prevLast && prevLast.message === message) return prev;
          return [...prev, { id: crypto.randomUUID(), atMs: Number.isNaN(atMs) ? Date.now() : atMs, message, tone }];
        });
        void fetchJob();
      } catch {
        setLog((prev) => [
          ...prev,
          {
            id: crypto.randomUUID(),
            atMs: Date.now(),
            message: "Update",
            tone: "muted",
          },
        ]);
      }
    };
    es.onerror = () => {
      es.close();
    };

    return () => {
      es.close();
    };
  }, [tenantOk, job?.id, job?.status, fetchJob, job]);

  useEffect(() => {
    let cancelled = false;
    if (!job || job.status !== "completed" || !qaBundleStorageKey) {
      queueMicrotask(() => {
        if (!cancelled) {
          setQaRows(null);
          setQaMean(null);
          setQaLoading(false);
        }
      });
      return () => {
        cancelled = true;
      };
    }
    queueMicrotask(() => {
      if (!cancelled) setQaLoading(true);
    });
    void (async () => {
      try {
        const { url } = await requestDownloadUrl(qaBundleStorageKey);
        const res = await fetch(url);
        if (!res.ok) throw new Error(await readUpstreamErrorBody(res));
        const data: unknown = await res.json();
        const parsed = parseQaBundle(data);
        if (cancelled || !parsed) return;
        setQaRows(parsed.rows);
        setQaMean(reviewerMean(parsed.rows));
      } catch {
        if (!cancelled) setQaRows([]);
      } finally {
        if (!cancelled) setQaLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [job, qaBundleStorageKey]);

  const displayLog = useMemo(() => {
    if (!job || job.status !== "completed" || qaMean == null) return log;
    if (log.some((row) => row.id === "review-pass")) return log;
    const tEnd = Date.parse(job.updatedAt);
    const logMaxAtMs = log.reduce(
      (m, r) => (Number.isFinite(r.atMs) ? Math.max(m, r.atMs) : m),
      0,
    );
    const row: LogRow = {
      id: "review-pass",
      atMs:
        Number.isFinite(tEnd) && Number.isFinite(logMaxAtMs)
          ? Math.max(tEnd, logMaxAtMs + 1)
          : Number.isFinite(tEnd)
            ? tEnd
            : Number.isFinite(logMaxAtMs)
              ? logMaxAtMs + 1
              : Date.now(),
      message: `Review passed · ${qaMean.toFixed(1)} / 10`,
      tone: "success",
    };
    return [...log, row];
  }, [log, job, qaMean]);

  const qaRowsFiltered = useMemo(() => {
    if (!qaRows?.length) return [];
    const q = reviewSearch.trim().toLowerCase();
    if (!q) return qaRows;
    return qaRows.filter((r) => {
      if (String(r.string_id).includes(q)) return true;
      if (r.original.toLowerCase().includes(q)) return true;
      if (r.translation.toLowerCase().includes(q)) return true;
      if (r.reviewer_score_0_to_10.toFixed(1).includes(q)) return true;
      return false;
    });
  }, [qaRows, reviewSearch]);

  const exportReportCsv = () => {
    if (!qaRows?.length || !qaBundleStorageKey) return;
    const body = `\ufeff${qaRowsToCompactTableCsv(qaRows)}`;
    const blob = new Blob([body], { type: "text/csv;charset=utf-8" });
    const slug = qaBundleStorageKey.split("/").pop()?.replace(/\.qa-bundle\.json$/i, "") ?? "review";
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    const id = job?.id ?? jobId;
    a.download = withShortJobIdInFilename(`${slug}.review-report.csv`, id);
    a.click();
    window.setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  };

  const copyJobId = () => {
    if (!job) return;
    void navigator.clipboard.writeText(job.id).then(() => {
      setIdCopied(true);
      window.setTimeout(() => setIdCopied(false), 1200);
    });
  };

  if (!tenantOk) {
    return (
      <p style={{ color: JD.muted }} className={`py-10 text-[13px] ${monoClass()}`}>
        Tenant not configured — set NEXT_PUBLIC_DEV_TENANT_ID.
      </p>
    );
  }

  const statusTone =
    job?.status === "completed"
      ? { bg: "rgba(62,207,142,0.1)", fg: JD.success }
      : job?.status === "failed"
        ? { bg: "rgba(248,113,113,0.1)", fg: JD.danger }
        : job?.status === "cancelled"
          ? { bg: "rgba(107,107,107,0.12)", fg: JD.muted }
          : { bg: "rgba(212,168,71,0.06)", fg: JD.accent };

  const headlineFrom = langLabel(job?.sourceLang ?? "american_english");
  const headlineTo =
    job?.targetLangs?.length ? langLabel(job.targetLangs[0]) : "";

  const uploadLabel = job
    ? job.uploadFileLabel ?? job.fileKey?.split("/").pop() ?? "—"
    : "—";

  const etaSec = job
    ? estimateEtaSeconds({
        progress: job.progress,
        createdAt: job.createdAt,
        status: job.status,
      })
    : null;

  const lastEntryPulsesDot = Boolean(active && displayLog.length > 0);

  return (
    <>
      <div style={{ background: JD.bg, color: JD.fg }} className="px-6 py-10 sm:px-8">
        {loadError ? (
          <p style={{ color: JD.danger }} className={`mb-6 text-[13px] ${monoClass()}`}>
            {loadError}
          </p>
        ) : null}

        {!job ? (
          !loadError && (
            <div className="space-y-3">
              <div className="h-3 w-40 animate-pulse rounded bg-neutral-700/40 motion-reduce:animate-none" />
              <div className="h-8 w-[60%] max-w-md animate-pulse rounded bg-neutral-700/35 motion-reduce:animate-none" />
            </div>
          )
        ) : (
          <>
            {/* Breadcrumb + status */}
            <div className="flex flex-wrap items-center gap-3">
              <Link
                href="/jobs"
                className="flex items-center gap-1 text-[13px] font-medium uppercase tracking-[0.06em] transition-opacity duration-150 hover:opacity-80"
                style={{ color: JD.muted }}
              >
                <span aria-hidden>‹</span>
                Jobs
              </Link>
              <span style={{ color: JD.muted }} className={`text-[12px] ${monoClass()}`}>
                /
              </span>
              <button
                type="button"
                className={`text-[13px] font-medium uppercase tracking-[0.06em] transition-colors duration-150 ${monoClass()}`}
                style={{ color: idCopied ? JD.accent : JD.muted }}
                onClick={() => void copyJobId()}
              >
                {idCopied ? "Copied" : truncateJobId(job.id)}
              </button>
              <span
                className="rounded-[6px] px-2 py-0.5 text-[13px] font-normal normal-case tracking-normal capitalize"
                style={{ backgroundColor: statusTone.bg, color: statusTone.fg }}
              >
                {job.status === "completed"
                  ? "Completed"
                  : job.status === "failed"
                    ? "Failed"
                    : job.status === "cancelled"
                      ? "Cancelled"
                      : job.status}
              </span>
              <div className="ms-auto flex flex-wrap items-center gap-2">
                {active ? (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={cancelBusy}
                    onClick={() => void cancelJob()}
                  >
                    {cancelBusy ? "Cancelling…" : "Cancel job"}
                  </Button>
                ) : null}
              </div>
            </div>

            <div className="mt-10 text-[22px] font-light leading-snug tracking-wide">
              {headlineFrom} <span style={{ color: JD.muted }} className="font-light">→</span>{" "}
              {headlineTo}
            </div>

            <div
              className="mt-4 text-[13px] tracking-tight duration-150"
              style={{ color: JD.muted }}
            >
              {job.stringsTotal != null ? `${job.stringsTotal.toLocaleString()} strings` : "—"}
              {" · "}
              {terminal
                ? formatDurationApprox(job.createdAt, job.updatedAt)
                : etaSec != null
                  ? `~${formatDurationSeconds(etaSec)} remaining`
                  : "Running"}
              {" · "}
              {qaMean != null && job.status === "completed"
                ? `Avg. score ${qaMean.toFixed(1)} / 10`
                : "Avg. score —"}
              {" · "}
              {`${job.retriedBatchCount ?? 0} retried`}
            </div>

            {active ? (
              <div
                className="mt-8 rounded-lg border p-4 sm:p-5"
                style={{ borderColor: JD.border, background: JD.rowWash }}
              >
                <JobPipelineVisualizer
                  pipeline={pipeline}
                  jobStatus={job.status}
                  progress={job.progress}
                  createdAt={job.createdAt}
                  variant="full"
                />
              </div>
            ) : null}

            {active ? (
              <div className="mt-8 overflow-hidden bg-[#141414]">
                <div
                  style={{ width: `${Math.round(job.progress)}%` }}
                  className={cn("jd-job-progress-shimmer h-[2px] rounded-none")}
                />
              </div>
            ) : null}

            <div className="mt-14 lg:grid lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)] lg:gap-x-14">
              <div className="min-w-0 space-y-12 lg:border-r lg:border-[#1f1f1f] lg:pr-10">
                <section>
                  <h2 className={`text-[13px] font-medium uppercase tracking-[0.06em]`} style={{ color: JD.muted }}>
                    Files
                  </h2>

                  {/* Source row */}
                  <div
                    className="group mt-4 flex cursor-default items-start gap-3 border-b py-4 transition-colors duration-150 lg:rounded lg:py-4 lg:hover:bg-[#1A1A1A]"
                    style={{ borderColor: JD.border }}
                  >
                    <DocIcon className="shrink-0 text-[#6B6B6B]" />
                    <div className="min-w-0 flex-1 text-[14px]" style={{ color: JD.fg }}>
                      <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
                        <span>Source file</span>
                        <span className={`text-[14px] ${monoClass()}`} style={{ color: JD.muted }}>
                          {uploadLabel}
                        </span>
                      </div>
                      <div className="mt-3 flex flex-wrap items-center gap-x-5 gap-y-2">
                        <button
                          type="button"
                          disabled={!job.fileKey}
                          className="text-[14px] font-normal transition-opacity duration-150 hover:opacity-90 disabled:pointer-events-none disabled:opacity-30"
                          style={{ color: JD.accent }}
                          onClick={() =>
                            job.fileKey ? void previewKey(job.fileKey, uploadLabel) : undefined
                          }
                        >
                          Preview
                        </button>
                        <button
                          type="button"
                          disabled={!job.fileKey}
                          className="text-[14px] font-normal transition-opacity duration-150 hover:opacity-90 disabled:pointer-events-none disabled:opacity-30"
                          style={{ color: JD.accent }}
                          onClick={() =>
                            job.fileKey
                              ? void downloadKey(
                                  job.fileKey,
                                  job.uploadFileLabel || uploadLabel || "source",
                                )
                              : undefined
                          }
                        >
                          ↓ Download
                        </button>
                      </div>
                    </div>
                  </div>

                  {/* Translated row */}
                  <div
                    className="group mt-px flex cursor-default items-start gap-3 border-b py-4 transition-colors duration-150 lg:rounded lg:py-4 lg:hover:bg-[#1A1A1A]"
                    style={{ borderColor: JD.border }}
                  >
                    <DocIcon className="shrink-0 text-[#6B6B6B]" />
                    <div className="min-w-0 flex-1">
                      {job.status === "completed" && translatedLabel ? (
                        <>
                          <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1 text-[14px]" style={{ color: JD.fg }}>
                            <span>Translated file</span>
                            <span className={monoClass()} style={{ color: JD.muted }}>
                              {translatedLabel}
                            </span>
                          </div>
                          {translatedKey ? (
                            <div className="mt-3 flex flex-wrap items-center gap-x-5 gap-y-2">
                              <button
                                type="button"
                                className="text-[14px] font-normal transition-opacity duration-150 hover:opacity-90"
                                style={{ color: JD.accent }}
                                onClick={() => void previewKey(translatedKey, translatedLabel)}
                              >
                                Preview
                              </button>
                              <button
                                type="button"
                                className="text-[14px] font-normal transition-opacity duration-150 hover:opacity-90"
                                style={{ color: JD.accent }}
                                onClick={() =>
                                  void downloadKey(
                                    translatedKey,
                                    translatedLabel.split("/").pop() ?? "translated",
                                  )
                                }
                              >
                                ↓ Download
                              </button>
                            </div>
                          ) : null}
                        </>
                      ) : (
                        <div className="animate-pulse space-y-3 motion-reduce:animate-none">
                          <div className="flex flex-wrap items-baseline gap-2">
                            <span className="text-[14px]" style={{ color: JD.fg }}>
                              Translated file
                            </span>
                            <span className="skeleton-shine relative h-4 w-[min(280px,50%)] overflow-hidden rounded bg-neutral-700/35" />
                          </div>
                          <span className="skeleton-shine relative inline-block h-4 w-20 overflow-hidden rounded bg-neutral-700/25" />
                        </div>
                      )}
                    </div>
                  </div>
                </section>

                <section>
                  <h2 className={`text-[13px] font-medium uppercase tracking-[0.06em]`} style={{ color: JD.muted }}>
                    Translation review
                  </h2>

                  <div className="mt-4 flex flex-wrap items-center gap-3">
                    <input
                      type="search"
                      value={reviewSearch}
                      onChange={(e) => setReviewSearch(e.target.value)}
                      placeholder="Search…"
                      disabled={!qaRows?.length}
                      aria-label="Search review rows"
                      className="min-h-8 min-w-[10rem] flex-1 rounded-[6px] border bg-transparent px-2.5 py-1.5 text-[13px] outline-none transition-opacity duration-150 placeholder:text-[#6B6B6B] disabled:opacity-30"
                      style={{ borderColor: JD.border, color: JD.fg }}
                    />
                    <div className="flex flex-wrap items-center gap-4">
                    <button
                      type="button"
                      disabled={qaLoading || !qaRows?.length}
                      style={{ borderColor: JD.accent, color: JD.accent }}
                      className={cn(
                        "inline-flex h-8 shrink-0 items-center justify-center rounded-[6px] border bg-transparent px-3 text-[13px] font-medium transition-opacity duration-150 hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-35",
                      )}
                      onClick={() => {
                        setReviewOpen((o) => {
                          const next = !o;
                          if (!next) setReviewSearch("");
                          return next;
                        });
                      }}
                    >
                      Review table
                    </button>
                    <button
                      type="button"
                      disabled={!qaRows?.length}
                      className="text-[13px] font-normal transition-opacity duration-150 hover:opacity-80 disabled:pointer-events-none disabled:opacity-30"
                      style={{ color: JD.muted }}
                      onClick={() => exportReportCsv()}
                    >
                      Export report
                    </button>
                    </div>
                  </div>

                  <div
                    style={{ transitionProperty: "max-height,opacity", transitionTimingFunction: "ease-out" }}
                    className={cn(
                      "overflow-hidden bg-[#111]",
                      reviewOpen ? "mt-6 max-h-[480px] border border-[#1f1f1f] opacity-100 motion-safe:duration-200" : "max-h-0 border border-transparent opacity-0 motion-safe:duration-200",
                      "motion-reduce:transition-none",
                    )}
                  >
                    <div className="max-h-[440px] overflow-auto">
                      {qaLoading ? (
                        <div className="space-y-2 p-5">
                          {Array.from({ length: 8 }).map((_, i) => (
                            <div key={`sk-${String(i)}`} className="h-10 animate-pulse rounded bg-neutral-800/40 motion-reduce:animate-none" />
                          ))}
                        </div>
                      ) : !qaRows?.length ? (
                        <p style={{ color: JD.muted }} className="py-12 text-center text-[13px]">
                          No review rows
                        </p>
                      ) : qaRowsFiltered.length === 0 ? (
                        <p style={{ color: JD.muted }} className="py-12 text-center text-[13px]">
                          No matches
                        </p>
                      ) : (
                        <table className="w-full border-collapse">
                          <thead>
                            <tr className={`text-[11px] uppercase tracking-[0.08em] ${monoClass()}`}>
                              <th className="w-24 px-3 py-3 text-left" style={{ color: JD.muted }}>
                                String ID
                              </th>
                              <th className="min-w-[8rem] px-3 py-3 text-left" style={{ color: JD.muted }}>
                                Source text
                              </th>
                              <th className="min-w-[8rem] px-3 py-3 text-left" style={{ color: JD.muted }}>
                                Translated
                              </th>
                              <th className="px-3 py-3 text-left" style={{ color: JD.muted }}>
                                Score
                              </th>
                            </tr>
                          </thead>
                          <tbody>
                            {qaRowsFiltered.map((r, i) => {
                              const retried = (r.translator_attempt_number ?? 1) > 1;
                              const scoreN = r.reviewer_score_0_to_10;
                              const scoreColor = retried ? JD.danger : scoreN >= 7 ? JD.success : JD.accent;
                              const chipBg =
                                retried ? "rgba(248,113,113,0.08)" :
                                scoreN >= 7 ? "rgba(62,207,142,0.06)"
                                : "rgba(212,168,71,0.08)";
                              return (
                                <tr
                                  key={`${r.string_id}-${i}`}
                                  className="border-t border-[#1f1f1f] text-[13px] leading-relaxed transition-colors duration-150 hover:bg-[#141414]"
                                  style={
                                    retried ? { borderLeft: `4px solid ${JD.accent}` } : {}
                                  }
                                >
                                  <td className={`px-3 py-2 align-top tabular-nums ${monoClass()}`} style={{ color: JD.muted }}>
                                    {r.string_id}
                                  </td>
                                  <td className="max-w-[13rem] break-words px-3 py-2 align-top" style={{ color: JD.fg }}>
                                    {r.original}
                                  </td>
                                  <td className="max-w-[13rem] break-words px-3 py-2 align-top" style={{ color: JD.fg }}>
                                    {r.translation}
                                  </td>
                                  <td className="align-top">
                                    <span
                                      className={`mx-3 my-2 inline-flex rounded-[6px] px-2 py-0.5 text-[11px] font-medium tracking-tight tabular-nums ${monoClass()}`}
                                      style={{
                                        color: scoreColor,
                                        backgroundColor: chipBg,
                                      }}
                                    >
                                      {scoreN.toFixed(1)}
                                    </span>
                                  </td>
                                </tr>
                              );
                            })}
                          </tbody>
                        </table>
                      )}
                    </div>
                  </div>
                </section>
              </div>

              <div
                className="min-w-0 mt-14 border-t border-[#1f1f1f] pt-14 lg:mt-0 lg:border-t-0 lg:border-l lg:border-[#1f1f1f] lg:pl-12 lg:pt-0"
                style={{ background: JD.bg }}
              >
                <h2 className={`text-[13px] font-medium uppercase tracking-[0.06em]`} style={{ color: JD.muted }}>
                  Log
                </h2>
                <ul className="mt-5 space-y-5">
                  {displayLog.map((entry, idx) => {
                    const pulse = lastEntryPulsesDot && idx === displayLog.length - 1;
                    const displayMessage =
                      pulse &&
                      (/^Translating(?:\s|·|,|$)/.test(entry.message) || entry.message === "Translating")
                        ? /^Translating$/.test(entry.message.trim())
                          ? "Translating…"
                          : `${entry.message.trim().replace(/\.+$/, "")}…`
                        : entry.message;

                    return (
                      <li key={entry.id} className="flex gap-4">
                        <span className="flex shrink-0 pt-px">
                          <span className={dotToneClass(entry.tone, pulse)} />
                        </span>
                        <div className="min-w-0 flex-1">
                          <div className={`${monoClass()} text-[11px] tabular-nums`} style={{ color: JD.muted }}>
                            {formatLogClock(entry.atMs)}
                          </div>
                          <div className="mt-0.5 text-[13px] font-normal tracking-tight" style={{ color: JD.fg }}>
                            {displayMessage}
                          </div>
                        </div>
                      </li>
                    );
                  })}
                </ul>
                {!displayLog.length ? (
                  <p className={`mt-6 text-center text-[13px]`} style={{ color: JD.muted }}>
                    Waiting to start
                  </p>
                ) : null}
              </div>
            </div>
          </>
        )}
      </div>

      {filePreview.kind !== "closed" ? (
        <div
          className="fixed inset-0 z-[140] flex items-center justify-center p-4 sm:p-6"
          role="dialog"
          aria-modal="true"
          aria-labelledby="jd-file-preview-title"
        >
          <button
            type="button"
            aria-label="Close preview"
            className="absolute inset-0 bg-black/80 backdrop-blur-[2px] transition-opacity duration-150"
            onClick={() => setFilePreview({ kind: "closed" })}
          />
          <div
            className="relative z-10 flex max-h-[min(92vh,940px)] w-full max-w-[min(100%,56rem)] flex-col overflow-hidden rounded-xl border shadow-2xl motion-safe:animate-in"
            style={{ borderColor: JD.border, background: JD.surface, color: JD.fg }}
          >
            <header
              className="flex shrink-0 items-start justify-between gap-4 border-b px-5 py-4"
              style={{ borderColor: JD.border }}
            >
              <div className="min-w-0">
                <div
                  className="text-[11px] font-medium uppercase tracking-[0.08em]"
                  style={{ color: JD.muted }}
                >
                  Preview
                </div>
                <h2
                  id="jd-file-preview-title"
                  className={cn("mt-1 truncate text-[15px] font-normal leading-snug", monoClass())}
                  title={filePreview.title}
                >
                  {filePreview.title}
                </h2>
              </div>
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="shrink-0 border-[#2a2a2a] bg-transparent text-[13px] text-[var(--fg)] hover:bg-[#1a1a1a]"
                onClick={() => setFilePreview({ kind: "closed" })}
              >
                Close
              </Button>
            </header>

            <div className="min-h-0 flex-1 overflow-hidden bg-[#0d0d0d]">
              {filePreview.kind === "loading" ? (
                <div className="flex flex-col items-center justify-center gap-3 px-6 py-24">
                  <div
                    className="h-8 w-8 animate-spin rounded-full border-2 border-t-transparent motion-reduce:animate-none"
                    style={{ borderColor: `${JD.accent}55`, borderTopColor: JD.accent }}
                    aria-hidden
                  />
                  <p className="text-[13px]" style={{ color: JD.muted }}>
                    Loading file…
                  </p>
                </div>
              ) : null}

              {filePreview.kind === "error" ? (
                <div className="space-y-3 px-6 py-10">
                  <p className="text-[13px]" style={{ color: JD.danger }}>
                    {filePreview.message}
                  </p>
                  <p className="text-[12px] leading-relaxed" style={{ color: JD.muted }}>
                    If this is a CORS issue, configure your storage bucket to allow GET from this
                    origin, or use Download instead.
                  </p>
                </div>
              ) : null}

              {filePreview.kind === "text" ? (
                <pre
                  className={cn(
                    "max-h-[min(72vh,720px)] overflow-auto p-5 text-[12px] leading-relaxed whitespace-pre-wrap break-words",
                    monoClass(),
                  )}
                  style={{ color: JD.fg }}
                >
                  {filePreview.body}
                </pre>
              ) : null}

              {filePreview.kind === "iframe" ? (
                <div className="flex min-h-[min(64vh,560px)] flex-col">
                  <p className="border-b px-5 py-2.5 text-[12px] leading-snug" style={{ borderColor: JD.border, color: JD.muted }}>
                    Embedded view — if the file does not render here, use{" "}
                    <span style={{ color: JD.fg }}>Download</span>.
                  </p>
                  <iframe
                    title={filePreview.title}
                    src={filePreview.url}
                    className="min-h-[min(58vh,500px)] w-full flex-1 border-0 bg-[#fafafa]"
                    sandbox=""
                  />
                </div>
              ) : null}
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}
