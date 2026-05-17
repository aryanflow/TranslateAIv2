"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import {
  API_PREFIX,
  TENANT_ID,
  apiHeaders,
  formatApiError,
  jobEventsUrl,
} from "@/lib/dev-api";
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
  createdAt: string;
  updatedAt: string;
  errorMessage: string | null;
  resultUrls: string[];
  judgePassScoreMin10?: number;
  judgePassScoreMin01?: number;
  minTranslationScoreStored?: number | null;
};

type PreviewState = { title: string; body: string } | null;

function ProgressBar({ value }: { value: number }) {
  const pct = Math.min(100, Math.max(0, value));
  return (
    <div className="h-2 overflow-hidden rounded-full bg-[var(--panel)] ring-1 ring-[var(--edge)]">
      <div
        className="h-full rounded-full bg-gradient-to-r from-[var(--accent)] to-[var(--accent-muted)] transition-[width] duration-700 ease-out motion-reduce:transition-none"
        style={{ width: `${pct}%` }}
      />
    </div>
  );
}

export function JobsDashboard() {
  const searchParams = useSearchParams();
  const highlightId = searchParams.get("highlight");

  const [jobs, setJobs] = useState<JobRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [liveTail, setLiveTail] = useState<Record<string, string[]>>({});
  const [preview, setPreview] = useState<PreviewState>(null);

  const tenantOk = useMemo(() => TENANT_ID.length > 0, []);
  const cardRefs = useRef<Record<string, HTMLDivElement | null>>({});

  const fetchJobs = useCallback(async () => {
    if (!tenantOk) return;
    const res = await fetch(`${API_PREFIX}/jobs`, { headers: apiHeaders() });
    if (!res.ok) throw new Error(await res.text());
    const data = (await res.json()) as { jobs: JobRow[] };
    setJobs(data.jobs);
  }, [tenantOk]);

  const hasActiveJobs = useMemo(() => {
    const active = new Set([
      "pending",
      "extracting",
      "chunking",
      "translating",
      "scoring",
      "regenerating",
    ]);
    return jobs.some((j) => active.has(j.status));
  }, [jobs]);

  useEffect(() => {
    if (!tenantOk || !hasActiveJobs) return;
    const poll = window.setInterval(() => {
      void fetchJobs().catch((e) => setError(formatApiError(e)));
    }, 4500);
    return () => window.clearInterval(poll);
  }, [tenantOk, hasActiveJobs, fetchJobs]);

  useEffect(() => {
    if (!tenantOk) {
      setLoading(false);
      return;
    }
    let cancelled = false;
    void (async () => {
      try {
        setLoading(true);
        await fetchJobs();
        setError(null);
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
    setExpandedId(highlightId);
    requestAnimationFrame(() => {
      cardRefs.current[highlightId]?.scrollIntoView({
        behavior: "smooth",
        block: "center",
      });
    });
  }, [highlightId, tenantOk]);

  useEffect(() => {
    if (!expandedId || !tenantOk || typeof EventSource === "undefined") return;
    const url = jobEventsUrl(expandedId);
    const es = new EventSource(url);

    const pushLine = (jobId: string, line: string) => {
      setLiveTail((prev) => {
        const cur = prev[jobId] ?? [];
        const next = [...cur, line].slice(-14);
        return { ...prev, [jobId]: next };
      });
    };

    es.onmessage = (ev) => {
      try {
        const raw = JSON.parse(ev.data as string) as Record<string, unknown>;
        const phase =
          typeof raw.phase === "string" ? raw.phase : "event";
        const pct =
          typeof raw.percent === "number" ? raw.percent : undefined;
        const st =
          typeof raw.stringsTotal === "number"
            ? raw.stringsTotal
            : undefined;
        const sd =
          typeof raw.stringsDone === "number" ? raw.stringsDone : undefined;
        const bi =
          typeof raw.batchIndex === "number" ? raw.batchIndex : undefined;
        const tgt =
          typeof raw.targetLang === "string" ? raw.targetLang : undefined;
        const parts = [
          phaseLabel(phase),
          pct !== undefined ? `${pct}%` : null,
          st !== undefined ? `${sd ?? "…"}/${st} strings` : null,
          bi !== undefined ? `batch ${bi}` : null,
          tgt ? langLabel(tgt) : null,
        ].filter(Boolean);
        pushLine(expandedId, parts.join(" · "));
        void fetchJobs();
      } catch {
        pushLine(expandedId, ev.data as string);
      }
    };

    es.onerror = () => {
      es.close();
    };

    return () => {
      es.close();
    };
  }, [expandedId, tenantOk, fetchJobs]);

  const requestDownloadUrl = async (key: string) => {
    const res = await fetch(`${API_PREFIX}/files/download-url`, {
      method: "POST",
      headers: apiHeaders(),
      body: JSON.stringify({ key }),
    });
    if (!res.ok) throw new Error(await res.text());
    return (await res.json()) as { url: string };
  };

  const downloadKey = async (key: string, fallbackName: string) => {
    try {
      const { url } = await requestDownloadUrl(key);
      const a = document.createElement("a");
      a.href = url;
      a.download = fallbackName;
      a.target = "_blank";
      a.rel = "noopener noreferrer";
      a.click();
    } catch (e) {
      setError(formatApiError(e));
    }
  };

  const openPreview = async (key: string, title: string) => {
    if (key.endsWith(".xlsx") || key.endsWith(".xls")) {
      setError("Spreadsheet preview is not available in the browser — use Download.");
      return;
    }
    try {
      const { url } = await requestDownloadUrl(key);
      const res = await fetch(url);
      if (!res.ok) throw new Error(await res.text());
      const text = await res.text();
      const clipped =
        text.length > 120_000 ? `${text.slice(0, 120_000)}\n\n…truncated` : text;
      setPreview({ title, body: clipped });
    } catch (e) {
      setError(formatApiError(e));
    }
  };

  if (!tenantOk) {
    return (
      <p className="mt-6 rounded-lg border border-[var(--edge)] bg-[var(--bg0)]/80 px-4 py-3 text-[13px] text-[var(--muted)]">
        Set{" "}
        <code className="rounded bg-[var(--panel)] px-1.5 py-0.5 font-mono text-[12px]">
          NEXT_PUBLIC_DEV_TENANT_ID
        </code>{" "}
        in{" "}
        <code className="rounded bg-[var(--panel)] px-1.5 py-0.5 font-mono text-[12px]">
          apps/web/.env.local
        </code>
        .
      </p>
    );
  }

  return (
    <div className="mt-8 space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="max-w-xl text-[13px] leading-relaxed text-[var(--muted)]">
          Jobs persist across reloads. In-flight lists refresh automatically; open a row for a live event
          tail (SSE plus list sync). Expanded rows show batch ETA, downloads, and text preview.
        </p>
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={loading}
          onClick={() => void fetchJobs().catch((e) => setError(formatApiError(e)))}
        >
          Refresh
        </Button>
      </div>

      {error ? (
        <p className="rounded-lg border border-red-500/40 bg-red-500/10 px-4 py-3 text-[13px] text-red-200">
          {error}
        </p>
      ) : null}

      {loading ? (
        <p className="text-[13px] text-[var(--muted)]">Loading jobs…</p>
      ) : jobs.length === 0 ? (
        <div className="rounded-xl border border-dashed border-[var(--edge)] bg-[var(--bg0)]/40 px-6 py-12 text-center">
          <p className="font-[family-name:var(--font-serif)] text-lg text-[var(--fg)]">
            No jobs yet
          </p>
          <p className="mt-2 text-[13px] text-[var(--muted)]">
            Start one from{" "}
            <Link className="text-[var(--accent)] underline-offset-4 hover:underline" href="/translate">
              New translation
            </Link>
            .
          </p>
        </div>
      ) : (
        <div className="grid gap-4">
          {jobs.map((job) => {
            const expanded = expandedId === job.id;
            const eta = estimateEtaSeconds(job);
            const batchLine =
              job.batchTotal != null
                ? `${job.batchesCompleted} / ${job.batchTotal} batches`
                : `${job.batchesCompleted} batches processed`;

            return (
              <div
                key={job.id}
                ref={(el) => {
                  cardRefs.current[job.id] = el;
                }}
                className={cn(
                  "overflow-hidden rounded-xl border bg-gradient-to-b from-[var(--bg-elevated)]/90 to-[var(--panel)]/75 shadow-[0_1px_0_rgba(255,255,255,0.04)_inset] transition-colors",
                  expanded
                    ? "border-[var(--accent)]/50 ring-1 ring-[var(--accent)]/25"
                    : "border-[var(--edge)] hover:border-[var(--edge-bright)]",
                  highlightId === job.id ? "ring-2 ring-[var(--accent)]/40" : "",
                )}
              >
                <button
                  type="button"
                  className="flex w-full flex-col gap-3 px-5 py-4 text-left md:flex-row md:items-center md:justify-between"
                  onClick={() =>
                    setExpandedId((cur) => (cur === job.id ? null : job.id))
                  }
                >
                  <div className="min-w-0 space-y-2">
                    <div className="flex flex-wrap items-center gap-2">
                      <span
                        className={cn(
                          "rounded-full px-2.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider",
                          job.status === "completed"
                            ? "bg-emerald-500/15 text-emerald-200"
                            : job.status === "failed"
                              ? "bg-red-500/15 text-red-200"
                              : "bg-[var(--accent)]/15 text-[var(--accent-muted)]",
                        )}
                      >
                        {phaseLabel(job.status)}
                      </span>
                      <code className="truncate font-mono text-[11px] text-[var(--muted)]">
                        {job.id}
                      </code>
                    </div>
                    <p className="text-[13px] text-[var(--fg)]">
                      <span className="text-[var(--muted)]">→</span>{" "}
                      {job.targetLangs.map((t) => langLabel(t)).join(", ")}
                      <span className="text-[var(--muted)]"> · from </span>
                      {langLabel(job.sourceLang)}
                    </p>
                    <p className="text-[11px] text-[var(--muted-deep)]">
                      {batchLine}
                      {job.stringsTotal != null ? (
                        <> · {job.stringsTotal.toLocaleString()} strings total</>
                      ) : null}
                      {job.judgePassScoreMin10 != null ? (
                        <>
                          {" "}
                          · reviewer gate ≥ {job.judgePassScoreMin10.toFixed(1)}/10
                        </>
                      ) : null}
                      {eta != null ? (
                        <>
                          {" "}
                          · ~{formatDurationSeconds(eta)} remaining
                          <span className="text-[var(--muted)]"> (estimate)</span>
                        </>
                      ) : null}
                    </p>
                  </div>
                  <div className="w-full shrink-0 md:max-w-xs md:flex-1">
                    <div className="mb-1 flex justify-between text-[10px] font-medium uppercase tracking-wider text-[var(--muted-deep)]">
                      <span>Pipeline</span>
                      <span className="tabular-nums">{Math.round(job.progress)}%</span>
                    </div>
                    <ProgressBar value={job.progress} />
                  </div>
                </button>

                {expanded ? (
                  <div className="space-y-4 border-t border-[var(--edge)] bg-[var(--bg0)]/40 px-5 py-4">
                    <div className="grid gap-4 md:grid-cols-2">
                      <div className="rounded-lg border border-[var(--edge)] bg-[var(--panel)]/40 p-3">
                        <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-[var(--muted-deep)]">
                          Live activity
                        </p>
                        <ul className="mt-2 max-h-36 space-y-1 overflow-auto font-mono text-[11px] leading-snug text-[var(--muted)]">
                          {(liveTail[job.id] ?? []).length ? (
                            liveTail[job.id].map((line, i) => (
                              <li key={`${i}-${line.slice(0, 24)}`}>{line}</li>
                            ))
                          ) : (
                            <li className="text-[var(--muted-deep)]">
                              Listening… translate batches appear here as SSE events arrive.
                            </li>
                          )}
                        </ul>
                      </div>
                      <div className="rounded-lg border border-[var(--edge)] bg-[var(--panel)]/40 p-3">
                        <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-[var(--muted-deep)]">
                          Artifacts
                        </p>
                        {job.judgePassScoreMin10 != null ? (
                          <p className="mt-2 text-[11px] leading-relaxed text-[var(--muted)]">
                            <span className="font-medium text-[var(--fg-soft)]">Reviewer gate:</span> batches below{" "}
                            <span className="tabular-nums font-semibold text-[var(--fg)]">
                              {job.judgePassScoreMin10.toFixed(1)}
                            </span>
                            /10 are retried (0–10 scale). Use{" "}
                            <em className="text-[var(--fg-soft)] not-italic">.translation-review.csv</em>{" "}
                            for a spreadsheet (original · translated · score · reviewer feedback), or{" "}
                            <em className="text-[var(--fg-soft)] not-italic">.qa-bundle.json</em>{" "}
                            for the structured JSON bundle.
                          </p>
                        ) : null}
                        {job.resultUrls.length ? (
                          <ul className="mt-2 space-y-2">
                            {job.resultUrls.map((key) => {
                              const name = key.split("/").pop() ?? key;
                              const friendly = name.endsWith(".qa-bundle.json")
                                ? `${name} — Original · Translation · Reviewer notes (JSON)`
                                : name.endsWith(".translation-review.csv")
                                  ? `${name} — spreadsheet: original · translated · score · feedback`
                                  : name;
                              return (
                                <li
                                  key={key}
                                  className="flex flex-wrap items-center gap-2 text-[12px]"
                                >
                                  <span className="truncate font-mono text-[var(--muted)]">
                                    {friendly}
                                  </span>
                                  <button
                                    type="button"
                                    className="rounded-md border border-[var(--edge-bright)] px-2 py-1 text-[11px] font-medium text-[var(--fg)] hover:bg-[var(--panel)]"
                                    onClick={() =>
                                      void downloadKey(key, name)
                                    }
                                  >
                                    Download
                                  </button>
                                  <button
                                    type="button"
                                    className="rounded-md border border-transparent px-2 py-1 text-[11px] font-medium text-[var(--accent-muted)] hover:bg-[var(--accent)]/10"
                                    onClick={() =>
                                      void openPreview(key, name)
                                    }
                                  >
                                    Preview
                                  </button>
                                </li>
                              );
                            })}
                          </ul>
                        ) : (
                          <p className="mt-2 text-[12px] text-[var(--muted)]">
                            Outputs appear when the job completes regenerating files.
                          </p>
                        )}
                        {job.errorMessage ? (
                          <p className="mt-3 rounded-md border border-red-500/30 bg-red-500/10 px-2 py-2 text-[11px] text-red-100">
                            {job.errorMessage}
                          </p>
                        ) : null}
                      </div>
                    </div>
                  </div>
                ) : null}
              </div>
            );
          })}
        </div>
      )}

      {preview ? (
        <div
          className="fixed inset-0 z-[100] flex items-center justify-center bg-black/65 p-4 backdrop-blur-[2px]"
          role="dialog"
          aria-modal="true"
          aria-label="Preview"
          onMouseDown={(e) => {
            if (e.target === e.currentTarget) setPreview(null);
          }}
        >
          <div className="flex max-h-[88vh] w-full max-w-4xl flex-col overflow-hidden rounded-2xl border border-[var(--edge)] bg-[var(--bg0)] shadow-2xl">
            <div className="flex items-center justify-between gap-3 border-b border-[var(--edge)] px-5 py-3">
              <p className="min-w-0 truncate font-medium text-[var(--fg)]">{preview.title}</p>
              <button
                type="button"
                className="shrink-0 rounded-lg border border-[var(--edge)] px-3 py-1.5 text-[12px] font-medium text-[var(--fg)] hover:bg-[var(--panel)]"
                onClick={() => setPreview(null)}
              >
                Close
              </button>
            </div>
            <pre className="flex-1 overflow-auto p-5 font-mono text-[11px] leading-relaxed text-[var(--muted)]">
              {preview.body}
            </pre>
          </div>
        </div>
      ) : null}
    </div>
  );
}
