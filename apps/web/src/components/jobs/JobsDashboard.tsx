"use client";

import Link from "next/link";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useSearchParams } from "next/navigation";
import { cn } from "@/lib/utils";
import { API_PREFIX, TENANT_ID, apiHeaders, formatApiError } from "@/lib/dev-api";
import { langLabel } from "@/lib/lang-options";
import {
  estimateEtaSeconds,
  formatDurationSeconds,
  phaseLabel,
} from "@/components/jobs/job-visual-utils";

type JobRow = {
  id: string;
  status: string;
  progress: number;
  sourceLang: string;
  targetLangs: string[];
  batchSize: number;
  stringsTotal: number | null;
  batchTotal: number | null;
  batchesCompleted: number;
  fileKey?: string;
  uploadFileLabel?: string;
  createdAt: string;
  updatedAt: string;
  errorMessage: string | null;
  resultUrls: string[];
  judgePassScoreMin10?: number;
  judgePassScoreMin01?: number;
  minTranslationScoreStored?: number | null;
};

type PeekState = { label: string; body: string } | null;

const JL = {
  bg: "#0A0A0A",
  border: "#1F1F1F",
  fg: "#F5F5F5",
  muted: "#6B6B6B",
  accent: "#D4A847",
  success: "#3ECF8E",
  danger: "#F87171",
  rowHover: "#1A1A1A",
} as const;

const ACTIVE = new Set([
  "pending",
  "extracting",
  "chunking",
  "translating",
  "scoring",
  "regenerating",
]);

function truncateJobId(uuid: string) {
  return uuid.replace(/-/g, "").slice(0, 8).toLowerCase();
}

function statusLabel(status: string) {
  if (status === "completed") return "Completed";
  if (status === "failed") return "Failed";
  if (status === "cancelled") return "Cancelled";
  return phaseLabel(status);
}

function statusPillStyle(status: string) {
  if (status === "completed")
    return { bg: "rgba(62,207,142,0.1)", fg: JL.success };
  if (status === "failed") return { bg: "rgba(248,113,113,0.1)", fg: JL.danger };
  if (status === "cancelled")
    return { bg: "rgba(107,107,107,0.12)", fg: JL.muted };
  return { bg: "rgba(212,168,71,0.06)", fg: JL.accent };
}

/** Wall time when the job was created (translation run started). */
function formatStartedAt(iso: string): { compact: string; full: string } {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return { compact: "—", full: iso };
  const full = d.toLocaleString(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  });
  try {
    const compact = new Intl.DateTimeFormat(undefined, {
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
    }).format(d);
    return { compact, full };
  } catch {
    return { compact: full, full };
  }
}

export function JobsDashboard() {
  const searchParams = useSearchParams();
  const highlightId = searchParams.get("highlight");

  const [jobs, setJobs] = useState<JobRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [peek, setPeek] = useState<PeekState>(null);
  const [peekBusyId, setPeekBusyId] = useState<string | null>(null);
  const [peekFind, setPeekFind] = useState("");
  const [listQuery, setListQuery] = useState("");

  const rowRefs = useRef<Record<string, HTMLDivElement | null>>({});
  const [modalPortalEl, setModalPortalEl] = useState<HTMLElement | null>(null);

  const tenantOk = useMemo(() => TENANT_ID.length > 0, []);

  useLayoutEffect(() => {
    setModalPortalEl(document.body);
  }, []);

  const fetchJobs = useCallback(async () => {
    if (!tenantOk) return;
    const res = await fetch(`${API_PREFIX}/jobs`, { headers: apiHeaders() });
    if (!res.ok) throw new Error(await res.text());
    const data = (await res.json()) as { jobs: JobRow[] };
    setJobs(data.jobs);
  }, [tenantOk]);

  const requestDownloadUrl = useCallback(async (key: string) => {
    const res = await fetch(`${API_PREFIX}/files/download-url`, {
      method: "POST",
      headers: apiHeaders(),
      body: JSON.stringify({ key }),
    });
    if (!res.ok) throw new Error(await res.text());
    return (await res.json()) as { url: string };
  }, []);

  const openSourcePeek = useCallback(
    async (job: JobRow) => {
      const key = job.fileKey;
      if (!key) return;
      const lower = key.toLowerCase();
      if (lower.endsWith(".xlsx") || lower.endsWith(".xls")) {
        setError("Spreadsheet — open job to download.");
        return;
      }
      setPeekBusyId(job.id);
      setError(null);
      try {
        const { url } = await requestDownloadUrl(key);
        const res = await fetch(url);
        if (!res.ok) throw new Error(await res.text());
        const text = await res.text();
        const clipped =
          text.length > 48_000 ? `${text.slice(0, 48_000)}\n\n…` : text;
        const label = job.uploadFileLabel ?? key.split("/").pop() ?? "Source";
        setPeekFind("");
        setPeek({ label, body: clipped });
      } catch (e) {
        setError(formatApiError(e));
      } finally {
        setPeekBusyId(null);
      }
    },
    [requestDownloadUrl],
  );

  const hasActiveJobs = useMemo(
    () => jobs.some((j) => ACTIVE.has(j.status)),
    [jobs],
  );

  const filteredJobs = useMemo(() => {
    const q = listQuery.trim().toLowerCase();
    if (!q) return jobs;
    return jobs.filter((j) => {
      if (j.id.toLowerCase().includes(q) || truncateJobId(j.id).includes(q)) return true;
      if (j.status.toLowerCase().includes(q)) return true;
      if (statusLabel(j.status).toLowerCase().includes(q)) return true;
      if (j.uploadFileLabel?.toLowerCase().includes(q)) return true;
      if (j.fileKey?.toLowerCase().includes(q)) return true;
      if (langLabel(j.sourceLang).toLowerCase().includes(q)) return true;
      const started = formatStartedAt(j.createdAt);
      if (started.compact.toLowerCase().includes(q) || started.full.toLowerCase().includes(q))
        return true;
      return j.targetLangs.some(
        (t) => t.toLowerCase().includes(q) || langLabel(t).toLowerCase().includes(q),
      );
    });
  }, [jobs, listQuery]);

  const peekLineHits = useMemo(() => {
    if (!peek) return null;
    const q = peekFind.trim().toLowerCase();
    if (!q) return null;
    return peek.body
      .split("\n")
      .map((text, i) => ({ n: i + 1, text }))
      .filter(({ text }) => text.toLowerCase().includes(q));
  }, [peek, peekFind]);

  useEffect(() => {
    if (!tenantOk || !hasActiveJobs) return;
    const poll = window.setInterval(() => {
      void fetchJobs().catch((e) => setError(formatApiError(e)));
    }, 4500);
    return () => window.clearInterval(poll);
  }, [tenantOk, hasActiveJobs, fetchJobs]);

  useEffect(() => {
    if (!tenantOk) {
      queueMicrotask(() => setLoading(false));
      return;
    }
    let cancelled = false;
    void (async () => {
      try {
        await fetchJobs();
        if (!cancelled) setError(null);
      } catch (e) {
        if (!cancelled) setError(formatApiError(e));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [tenantOk, fetchJobs]);

  useEffect(() => {
    if (!highlightId || !tenantOk) return;
    requestAnimationFrame(() => {
      rowRefs.current[highlightId]?.scrollIntoView({
        behavior: "smooth",
        block: "center",
      });
    });
  }, [highlightId, tenantOk, jobs.length]);

  useEffect(() => {
    if (!peek) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setPeek(null);
        setPeekFind("");
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [peek]);

  if (!tenantOk) {
    return (
      <p
        className="mt-8 rounded-lg border px-4 py-3 text-[13px]"
        style={{ borderColor: JL.border, color: JL.muted }}
      >
        <code className="rounded bg-[#111] px-1.5 py-0.5 font-mono text-[12px]">
          NEXT_PUBLIC_DEV_TENANT_ID
        </code>{" "}
        in{" "}
        <code className="rounded bg-[#111] px-1.5 py-0.5 font-mono text-[12px]">
          apps/web/.env.local
        </code>
      </p>
    );
  }

  return (
    <>
    <div
      className="mt-8 rounded-lg border px-5 py-8 sm:px-8"
      style={{ background: JL.bg, borderColor: JL.border, color: JL.fg }}
    >
      <div
        className="flex flex-col gap-3 border-b pb-5 sm:flex-row sm:items-center sm:justify-between"
        style={{ borderColor: JL.border }}
      >
        <input
          type="search"
          value={listQuery}
          onChange={(e) => setListQuery(e.target.value)}
          placeholder="Search jobs…"
          disabled={loading}
          aria-label="Search jobs"
          className="min-h-9 w-full max-w-md rounded-[6px] border bg-transparent px-3 py-2 text-[13px] outline-none transition-opacity duration-150 placeholder:text-[#6B6B6B] disabled:opacity-35"
          style={{ borderColor: JL.border, color: JL.fg }}
        />
        <button
          type="button"
          disabled={loading}
          className="shrink-0 self-end text-[13px] font-normal transition-opacity duration-150 hover:opacity-80 disabled:opacity-35 sm:self-auto"
          style={{ color: JL.accent }}
          onClick={() => void fetchJobs().catch((e) => setError(formatApiError(e)))}
        >
          Refresh
        </button>
      </div>

      {error ? (
        <p className="mt-4 text-[13px]" style={{ color: JL.danger }}>
          {error}
        </p>
      ) : null}

      {loading ? (
        <div className="mt-6 space-y-0">
          {Array.from({ length: 6 }).map((_, i) => (
            <div
              key={`sk-${String(i)}`}
              className="skeleton-shine relative overflow-hidden border-b py-5 motion-reduce:animate-none"
              style={{ borderColor: JL.border }}
            >
              <div className="h-3 w-24 rounded bg-neutral-700/35" />
              <div className="mt-3 h-5 w-[min(320px,70%)] rounded bg-neutral-700/30" />
              <div className="mt-2 h-3 w-40 rounded bg-neutral-700/25" />
            </div>
          ))}
        </div>
      ) : jobs.length === 0 ? (
        <div className="mt-16 text-center text-[13px]" style={{ color: JL.muted }}>
          <Link
            href="/translate"
            className="transition-opacity duration-150 hover:opacity-85"
            style={{ color: JL.accent }}
          >
            New translation
          </Link>
        </div>
      ) : (
        <div className="mt-6">
          <h2
            className="mb-1 text-[13px] font-medium uppercase tracking-[0.06em]"
            style={{ color: JL.muted }}
          >
            Recent
          </h2>
          <div className="divide-y divide-[#1F1F1F]">
            {filteredJobs.length === 0 ? (
              <p className="py-10 text-center text-[13px]" style={{ color: JL.muted }}>
                No matches ·{" "}
                <button
                  type="button"
                  className="transition-opacity duration-150 hover:opacity-85"
                  style={{ color: JL.accent }}
                  onClick={() => setListQuery("")}
                >
                  Clear
                </button>
              </p>
            ) : (
              filteredJobs.map((job) => {
              const active = ACTIVE.has(job.status);
              const targets = job.targetLangs.map((t) => langLabel(t)).join(", ");
              const source = langLabel(job.sourceLang);
              const eta = estimateEtaSeconds(job);
              const started = formatStartedAt(job.createdAt);
              const batchMeta =
                job.batchTotal != null
                  ? `${job.batchesCompleted}/${job.batchTotal} batches`
                  : `${job.batchesCompleted} batches`;
              const strings =
                job.stringsTotal != null
                  ? `${job.stringsTotal.toLocaleString()} strings`
                  : "—";
              const pill = statusPillStyle(job.status);
              const highlight = highlightId === job.id;
              const tailParts = [
                batchMeta,
                strings,
                active ? `${Math.round(job.progress)}%` : null,
                eta != null ? `~${formatDurationSeconds(eta)} left` : null,
              ].filter(Boolean);
              const peekBusy = peekBusyId === job.id;
              const canPeek = Boolean(job.fileKey);

              return (
                <div
                  key={job.id}
                  ref={(el) => {
                    rowRefs.current[job.id] = el;
                  }}
                  className={cn(
                    "rounded-md py-4 pl-1 pr-1 transition-colors duration-150 hover:bg-[#1A1A1A] focus-within:outline-none focus-within:ring-1 focus-within:ring-[#D4A847]/40",
                    highlight && "ring-1 ring-[#D4A847]/35",
                  )}
                >
                  <div className="flex flex-row items-start justify-between gap-3">
                    <div className="min-w-0 flex-1 space-y-2">
                      <div className="flex flex-wrap items-center gap-2">
                        <span
                          className="rounded-[6px] px-2 py-0.5 text-[13px] font-normal capitalize tracking-normal"
                          style={{ backgroundColor: pill.bg, color: pill.fg }}
                        >
                          {statusLabel(job.status)}
                        </span>
                        <Link
                          href={`/jobs/${job.id}`}
                          className="font-mono text-[12px] tabular-nums transition-opacity duration-150 hover:opacity-85"
                          style={{ color: JL.muted }}
                        >
                          {truncateJobId(job.id)}
                        </Link>
                      </div>
                      <Link
                        href={`/jobs/${job.id}`}
                        className="block text-[18px] font-light leading-snug tracking-wide transition-opacity duration-150 hover:opacity-90 sm:text-[20px]"
                        style={{ color: JL.fg }}
                      >
                        {source}{" "}
                        <span style={{ color: JL.muted }} className="font-light">
                          →
                        </span>{" "}
                        {targets}
                      </Link>
                      <div
                        className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[13px] tracking-tight"
                        style={{ color: JL.muted }}
                      >
                        <span
                          className="font-mono text-[11px] tabular-nums"
                          style={{ color: JL.muted }}
                          title={started.full}
                        >
                          Started {started.compact}
                        </span>
                        {tailParts.length ? (
                          <>
                            <span className="select-none opacity-35" aria-hidden>
                              ·
                            </span>
                            <span>{tailParts.join(" · ")}</span>
                          </>
                        ) : null}
                        {canPeek ? (
                          <>
                            <span className="select-none opacity-35" aria-hidden>
                              ·
                            </span>
                            <button
                              type="button"
                              disabled={peekBusy}
                              title="Quick read of the uploaded source file"
                              aria-busy={peekBusy}
                              className="border-0 bg-transparent p-0 text-[12px] font-normal underline decoration-dotted underline-offset-[3px] transition-opacity duration-150 hover:opacity-90 disabled:cursor-wait disabled:opacity-50"
                              style={{ color: JL.accent }}
                              onClick={() => void openSourcePeek(job)}
                            >
                              Source
                            </button>
                          </>
                        ) : null}
                      </div>
                      {active ? (
                        <div className="max-w-md overflow-hidden bg-[#141414]">
                          <div
                            className={cn(
                              "jd-job-progress-shimmer h-[2px] motion-reduce:animate-none",
                            )}
                            style={{ width: `${Math.round(job.progress)}%` }}
                          />
                        </div>
                      ) : null}
                    </div>
                    <Link
                      href={`/jobs/${job.id}`}
                      className="shrink-0 self-center pt-0.5 text-[13px] transition-opacity duration-150 hover:opacity-85"
                      style={{ color: JL.muted }}
                      aria-label="Open job"
                    >
                      <span className="tabular-nums" style={{ color: JL.accent }}>
                        →
                      </span>
                    </Link>
                  </div>
                </div>
              );
              })
            )}
          </div>
        </div>
      )}

    </div>
      {modalPortalEl && peekBusyId
        ? createPortal(
            <div
              className="fixed inset-0 z-[500] flex items-center justify-center bg-black/45 p-4 backdrop-blur-[1px] sm:p-6"
              role="status"
              aria-live="polite"
              aria-label="Loading source file"
            >
              <div
                className="flex max-w-sm items-center gap-3 rounded-lg border px-5 py-4 shadow-2xl"
                style={{ background: JL.bg, borderColor: JL.border, color: JL.fg }}
              >
                <span
                  className="inline-block h-4 w-4 shrink-0 animate-spin rounded-full border-2 border-[#D4A847]/25 border-t-[#D4A847] motion-reduce:animate-none motion-reduce:border-[#D4A847]/60"
                  aria-hidden
                />
                <span className="text-[13px] leading-snug">Opening source…</span>
              </div>
            </div>,
            modalPortalEl,
          )
        : null}
      {modalPortalEl && peek
        ? createPortal(
            <div
              className="fixed inset-0 z-[500] flex items-center justify-center bg-black/55 p-4 backdrop-blur-[1px] sm:p-6"
              role="dialog"
              aria-modal="true"
              aria-label="Source peek"
              onMouseDown={(e) => {
                if (e.target === e.currentTarget) {
                  setPeek(null);
                  setPeekFind("");
                }
              }}
            >
              <div
                className="flex min-h-0 w-[min(100%,42rem)] max-h-[min(70vh,560px)] max-w-2xl flex-col overflow-hidden rounded-lg border shadow-2xl"
                style={{ background: JL.bg, borderColor: JL.border, color: JL.fg }}
              >
            <div
              className="flex items-center justify-between gap-3 border-b px-4 py-3"
              style={{ borderColor: JL.border }}
            >
              <p className="min-w-0 truncate font-mono text-[12px]" style={{ color: JL.muted }}>
                {peek.label}
              </p>
              <button
                type="button"
                className="shrink-0 text-[12px] transition-opacity duration-150 hover:opacity-80"
                style={{ color: JL.accent }}
                onClick={() => {
                  setPeek(null);
                  setPeekFind("");
                }}
              >
                Close
              </button>
            </div>
            <div className="border-b px-4 py-2" style={{ borderColor: JL.border }}>
              <input
                type="search"
                value={peekFind}
                onChange={(e) => setPeekFind(e.target.value)}
                placeholder="Find in file…"
                aria-label="Find in file"
                className="w-full min-h-8 rounded-[6px] border bg-transparent px-2.5 py-1.5 text-[12px] outline-none placeholder:text-[#6B6B6B]"
                style={{ borderColor: JL.border, color: JL.fg }}
              />
            </div>
            {peekLineHits ? (
              peekLineHits.length === 0 ? (
                <p className="p-4 text-center text-[13px]" style={{ color: JL.muted }}>
                  No matches
                </p>
              ) : (
                <div
                  className="min-h-0 flex-1 overflow-auto font-mono text-[11px] leading-relaxed"
                  style={{ color: JL.fg }}
                >
                  {peekLineHits.map(({ n, text }) => (
                    <div
                      key={n}
                      className="flex gap-2 border-b border-[#1F1F1F]/80 px-4 py-0.5"
                      style={{ borderColor: JL.border }}
                    >
                      <span className="w-9 shrink-0 select-none tabular-nums opacity-50">{n}</span>
                      <span className="min-w-0 whitespace-pre-wrap break-all">{text}</span>
                    </div>
                  ))}
                </div>
              )
            ) : (
              <pre
                className="min-h-0 flex-1 overflow-auto p-4 font-mono text-[11px] leading-relaxed"
                style={{ color: JL.fg }}
              >
                {peek.body}
              </pre>
            )}
              </div>
            </div>,
            modalPortalEl,
          )
        : null}
    </>
  );
}
