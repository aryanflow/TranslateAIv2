"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { LANG_OPTIONS, langLabel } from "@/lib/lang-options";
import {
  API_PREFIX,
  TENANT_ID,
  apiHeaders,
  formatApiError,
} from "@/lib/dev-api";
import { phaseLabel } from "@/components/jobs/job-visual-utils";
import type { ReactNode } from "react";

function StepCard({
  step,
  title,
  children,
  className,
}: {
  step: number;
  title: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "animate-in relative overflow-hidden rounded-xl border border-[var(--edge)] bg-gradient-to-b from-[var(--bg-elevated)]/90 to-[var(--panel)]/80 p-5 shadow-[0_1px_0_rgba(255,255,255,0.04)_inset]",
        className,
      )}
    >
      <div className="pointer-events-none absolute -right-8 -top-8 h-32 w-32 rounded-full bg-[var(--accent)]/[0.04] blur-2xl" />
      <div className="relative flex gap-4">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-[var(--edge-bright)] bg-[var(--bg0)] font-[family-name:var(--font-serif)] text-sm font-extrabold text-[var(--accent)]">
          {step}
        </div>
        <div className="min-w-0 flex-1 space-y-3">
          <h2 className="text-sm font-semibold tracking-tight text-[var(--fg)]">{title}</h2>
          {children}
        </div>
      </div>
    </div>
  );
}

type IngestPhase = "idle" | "uploading" | "previewing" | "ready" | "error";

type PreviewPayload = {
  format: string;
  totalStrings: number;
  preview: string[];
  previewStringIds?: number[];
  previewTruncated: boolean;
};

type JobPollState = {
  id: string;
  status: string;
  progress: number;
  batchesCompleted?: number;
  batchTotal?: number | null;
  stringsTotal?: number | null;
  judgePassScoreMin10?: number;
  judgePassScoreMin01?: number;
  minTranslationScoreStored?: number | null;
};

function PipelinePulse() {
  return (
    <span className="relative flex h-3 w-3">
      <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-[var(--accent)] opacity-75 motion-reduce:animate-none" />
      <span className="relative inline-flex h-3 w-3 rounded-full bg-[var(--accent)]" />
    </span>
  );
}

function ProgressBar({ value }: { value: number }) {
  const pct = Math.min(100, Math.max(0, value));
  return (
    <div className="mt-3 h-2 overflow-hidden rounded-full bg-[var(--panel)] ring-1 ring-[var(--edge)]">
      <div
        className="h-full rounded-full bg-gradient-to-r from-[var(--accent)] to-[var(--accent-muted)] transition-[width] duration-700 ease-out motion-reduce:transition-none"
        style={{ width: `${pct}%` }}
      />
    </div>
  );
}

/** Upload → extract preview → single target → job + resilient progress UX */
export function TranslateWizardShell() {
  const [localFileName, setLocalFileName] = useState<string | null>(null);
  const [fileKey, setFileKey] = useState<string | null>(null);
  const [ingestPhase, setIngestPhase] = useState<IngestPhase>("idle");
  const [previewPayload, setPreviewPayload] = useState<PreviewPayload | null>(null);
  const [sourceLang, setSourceLang] = useState<string>("american_english");
  const [targetLang, setTargetLang] = useState<string>("spanish");
  const [batchSize, setBatchSize] = useState(80);
  const [busySubmit, setBusySubmit] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [activeJobId, setActiveJobId] = useState<string | null>(null);
  const [jobLive, setJobLive] = useState<JobPollState | null>(null);

  const tenantOk = useMemo(() => TENANT_ID.length > 0, []);

  useEffect(() => {
    if (targetLang !== sourceLang) return;
    const alt = LANG_OPTIONS.find((o) => o.value !== sourceLang);
    if (alt) setTargetLang(alt.value);
  }, [sourceLang, targetLang]);

  const fetchPreviewForKey = useCallback(async (key: string) => {
    const res = await fetch(`${API_PREFIX}/files/preview`, {
      method: "POST",
      headers: apiHeaders(),
      body: JSON.stringify({ fileKey: key, limit: 280 }),
    });
    if (!res.ok) throw new Error(await res.text());
    return (await res.json()) as PreviewPayload;
  }, []);

  const ingestFile = async (file: File | null) => {
    setError(null);
    setPreviewPayload(null);
    setFileKey(null);
    setLocalFileName(file?.name ?? null);
    setIngestPhase("idle");
    setActiveJobId(null);
    setJobLive(null);

    if (!file || !tenantOk) return;

    setIngestPhase("uploading");
    try {
      const pre = await fetch(`${API_PREFIX}/files/presigned-url`, {
        method: "POST",
        headers: apiHeaders(),
        body: JSON.stringify({
          fileName: file.name,
          contentType: file.type || "application/octet-stream",
        }),
      });
      if (!pre.ok) throw new Error(`Presign failed: ${await pre.text()}`);
      const { uploadUrl, fileKey: key } = (await pre.json()) as {
        uploadUrl: string;
        fileKey: string;
      };

      const put = await fetch(uploadUrl, {
        method: "PUT",
        body: file,
        headers: {
          "Content-Type": file.type || "application/octet-stream",
        },
      });
      if (!put.ok) throw new Error("Upload to object storage failed.");

      setFileKey(key);
      setIngestPhase("previewing");
      const pv = await fetchPreviewForKey(key);
      setPreviewPayload(pv);
      setIngestPhase("ready");
    } catch (e) {
      setIngestPhase("error");
      setError(formatApiError(e));
    }
  };

  useEffect(() => {
    if (!activeJobId || !tenantOk) return;

    let cancelled = false;

    const tick = async () => {
      try {
        const res = await fetch(`${API_PREFIX}/jobs/${activeJobId}`, {
          headers: apiHeaders(),
        });
        if (!res.ok) return;
        const data = (await res.json()) as {
          id: string;
          status: string;
          progress: number;
          batchesCompleted?: number;
          batchTotal?: number | null;
          stringsTotal?: number | null;
          judgePassScoreMin10?: number;
          judgePassScoreMin01?: number;
          minTranslationScoreStored?: number | null;
        };
        if (cancelled) return;
        setJobLive({
          id: data.id,
          status: data.status,
          progress: data.progress,
          batchesCompleted: data.batchesCompleted,
          batchTotal: data.batchTotal,
          stringsTotal: data.stringsTotal,
          judgePassScoreMin10: data.judgePassScoreMin10,
          judgePassScoreMin01: data.judgePassScoreMin01,
          minTranslationScoreStored: data.minTranslationScoreStored,
        });
      } catch {
        /* ignore transient poll errors */
      }
    };

    void tick();
    const id = window.setInterval(() => void tick(), 2200);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, [activeJobId, tenantOk]);

  const startTranslation = async () => {
    setError(null);
    if (!tenantOk) {
      setError("Set NEXT_PUBLIC_DEV_TENANT_ID to a valid tenant UUID from your database.");
      return;
    }
    if (!fileKey || ingestPhase !== "ready") {
      setError("Finish uploading and extracting strings before starting.");
      return;
    }

    setBusySubmit(true);
    try {
      const jobRes = await fetch(`${API_PREFIX}/jobs`, {
        method: "POST",
        headers: apiHeaders(),
        body: JSON.stringify({
          fileKey,
          sourceLang,
          targetLangs: [targetLang],
          batchSize,
        }),
      });
      if (!jobRes.ok) throw new Error(`Create job failed: ${await jobRes.text()}`);
      const created = (await jobRes.json()) as { jobId: string };
      setActiveJobId(created.jobId);
      setJobLive({
        id: created.jobId,
        status: "pending",
        progress: 0,
      });
    } catch (e) {
      setError(formatApiError(e));
    } finally {
      setBusySubmit(false);
    }
  };

  const ingestLabel =
    ingestPhase === "idle"
      ? "Choose a file to begin."
      : ingestPhase === "uploading"
        ? "Uploading…"
        : ingestPhase === "previewing"
          ? "Extracting strings…"
          : ingestPhase === "ready"
            ? "Ready — strings extracted."
            : "Could not ingest file.";

  return (
    <div className="mt-10 space-y-5">
      {!tenantOk ? (
        <p className="rounded-lg border border-[var(--edge)] bg-[var(--bg0)]/80 px-4 py-3 text-[13px] text-[var(--muted)]">
          Add{" "}
          <code className="rounded bg-[var(--panel)] px-1.5 py-0.5 font-mono text-[12px]">
            NEXT_PUBLIC_DEV_TENANT_ID
          </code>{" "}
          to{" "}
          <code className="rounded bg-[var(--panel)] px-1.5 py-0.5 font-mono text-[12px]">
            apps/web/.env.local
          </code>{" "}
          (tenant must exist in Postgres).
        </p>
      ) : null}

      <StepCard step={1} title="Source file" className="animate-in-delay-1">
        <p className="text-[13px] leading-relaxed text-[var(--muted)]">
          As soon as you pick a catalog we upload it, extract strings with the same engine as jobs,
          and tuck them into a collapsible list below. Fixtures:{" "}
          <code className="rounded bg-[var(--panel)] px-1 py-0.5 font-mono text-[11px]">
            samples/strings-sample.json
          </code>
          ,{" "}
          <code className="rounded bg-[var(--panel)] px-1 py-0.5 font-mono text-[11px]">
            strings-sample-200.json
          </code>
          ,{" "}
          <code className="rounded bg-[var(--panel)] px-1 py-0.5 font-mono text-[11px]">
            strings-sample.csv
          </code>
          .
        </p>
        <div className="flex flex-wrap items-center gap-3 pt-2">
          <input
            type="file"
            accept=".xml,.json,.csv,.xlsx,.xls"
            className="max-w-full text-[13px] text-[var(--muted)] file:mr-3 file:rounded-md file:border file:border-[var(--edge-bright)] file:bg-[var(--panel)] file:px-3 file:py-1.5 file:text-[12px] file:font-medium file:text-[var(--fg)]"
            disabled={ingestPhase === "uploading" || ingestPhase === "previewing"}
            onChange={(e) => void ingestFile(e.target.files?.[0] ?? null)}
          />
          <span className="text-[12px] text-[var(--muted-deep)]">{ingestLabel}</span>
        </div>

        {previewPayload ? (
          <details className="group mt-4 rounded-lg border border-[var(--edge)] bg-[var(--bg0)]/85">
            <summary className="cursor-pointer select-none list-none px-4 py-3 text-[13px] font-semibold text-[var(--fg)] [&::-webkit-details-marker]:hidden">
              <span className="flex flex-wrap items-center justify-between gap-2">
                <span>
                  Extracted strings{" "}
                  <span className="font-normal text-[var(--muted)]">
                    ({previewPayload.totalStrings.toLocaleString()} total
                    {previewPayload.previewTruncated ? ", preview capped" : ""})
                  </span>
                </span>
                <span className="rounded-md border border-[var(--edge-bright)] px-2 py-0.5 font-mono text-[10px] uppercase tracking-wide text-[var(--muted)]">
                  {previewPayload.format}
                </span>
              </span>
            </summary>
            <div className="max-h-52 space-y-1 overflow-auto border-t border-[var(--edge)] px-4 py-3 font-mono text-[11px] leading-snug text-[var(--muted)]">
              {previewPayload.preview.map((s, i) => {
                const sid =
                  previewPayload.previewStringIds?.[i] ??
                  i + 1;
                return (
                  <p key={`${sid}-${s.slice(0, 24)}`} className="truncate" title={s}>
                    <span className="tabular-nums text-[var(--muted-deep)]">{sid}.</span> {s}
                  </p>
                );
              })}
            </div>
          </details>
        ) : null}
      </StepCard>

      <StepCard step={2} title="Language & pipeline" className="animate-in-delay-2">
        <div className="grid gap-4 sm:grid-cols-2">
          <label className="space-y-1.5">
            <span className="text-[11px] font-medium uppercase tracking-wide text-[var(--muted-deep)]">
              Source
            </span>
            <select
              value={sourceLang}
              onChange={(e) => setSourceLang(e.target.value)}
              disabled={!tenantOk}
              className="w-full rounded-lg border border-[var(--edge)] bg-[var(--bg0)] px-3 py-2 text-[13px] text-[var(--fg)]"
            >
              {LANG_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </label>
          <label className="space-y-1.5">
            <span className="text-[11px] font-medium uppercase tracking-wide text-[var(--muted-deep)]">
              Target language
            </span>
            <select
              value={targetLang}
              onChange={(e) => setTargetLang(e.target.value)}
              disabled={!tenantOk}
              className="w-full rounded-lg border border-[var(--edge)] bg-[var(--bg0)] px-3 py-2 text-[13px] text-[var(--fg)]"
            >
              {LANG_OPTIONS.filter((o) => o.value !== sourceLang).map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </label>
          <label className="space-y-1.5 sm:col-span-2">
            <span className="text-[11px] font-medium uppercase tracking-wide text-[var(--muted-deep)]">
              Batch size
            </span>
            <input
              type="number"
              min={10}
              max={500}
              value={batchSize}
              onChange={(e) => setBatchSize(Number(e.target.value))}
              disabled={!tenantOk}
              className="w-full max-w-[200px] rounded-lg border border-[var(--edge)] bg-[var(--bg0)] px-3 py-2 text-[13px] text-[var(--fg)]"
            />
            <span className="mt-1 block text-[11px] text-[var(--muted-deep)]">
              Larger batches mean fewer rounds through the translator — tune if uploads are huge.
            </span>
          </label>
        </div>
        <p className="text-[12px] leading-relaxed text-[var(--muted)]">
          The <strong className="font-medium text-[var(--fg-soft)]">Quality reviewer</strong> scores each batch on a{" "}
          <strong className="font-medium text-[var(--fg-soft)]">0–10</strong> scale; batches below your configured gate are retried (defaults follow{" "}
          <code className="rounded bg-[var(--panel)] px-1 py-0.5 font-mono text-[10px]">minTranslationScore</code>
          ). Exact thresholds appear on the live job card once the API persists the job record.
        </p>
      </StepCard>

      <div className="flex flex-wrap items-center gap-3">
        <Button
          type="button"
          size="sm"
          disabled={
            busySubmit ||
            !tenantOk ||
            ingestPhase !== "ready" ||
            sourceLang === targetLang
          }
          onClick={() => void startTranslation()}
        >
          {busySubmit ? "Sending…" : "Start translation"}
        </Button>
        {sourceLang === targetLang ? (
          <span className="text-[12px] text-amber-200/90">
            Pick a different target than the source language.
          </span>
        ) : null}
      </div>

      {activeJobId && jobLive ? (
        <div className="animate-in relative overflow-hidden rounded-xl border border-[var(--accent)]/35 bg-[var(--accent)]/[0.06] p-5 shadow-[0_12px_48px_-24px_rgba(212,175,92,0.55)]">
          <div className="pointer-events-none absolute -left-16 top-1/2 h-48 w-48 -translate-y-1/2 rounded-full bg-[var(--accent)]/[0.07] blur-3xl" />
          <div className="relative flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
            <div className="flex gap-3">
              <PipelinePulse />
              <div>
                <p className="font-[family-name:var(--font-serif)] text-lg font-semibold text-[var(--fg)]">
                  Job running — safe to leave
                </p>
                <p className="mt-1 max-w-prose text-[13px] leading-relaxed text-[var(--muted)]">
                  Progress saves automatically. Reload anytime;{" "}
                  <Link
                    href={`/jobs?highlight=${activeJobId}`}
                    className="font-medium text-[var(--accent-muted)] underline-offset-4 hover:underline"
                  >
                    open this job on the Jobs board
                  </Link>{" "}
                  for batch breakdowns, downloads, and previews when it completes.
                </p>
                <p className="mt-3 font-mono text-[11px] text-[var(--muted-deep)]">
                  job id · {activeJobId}
                </p>
              </div>
            </div>
            <div className="w-full shrink-0 md:max-w-xs">
              <div className="flex flex-wrap items-baseline justify-between gap-2 text-[11px] font-semibold uppercase tracking-[0.14em] text-[var(--muted-deep)]">
                <span>{phaseLabel(jobLive.status)}</span>
                <span className="tabular-nums text-[var(--fg)]">
                  {Math.round(jobLive.progress)}%
                </span>
              </div>
              <ProgressBar value={jobLive.progress} />
              <p className="mt-2 text-[11px] text-[var(--muted)]">
                {langLabel(sourceLang)} → {langLabel(targetLang)}
                {jobLive.batchTotal != null ? (
                  <>
                    {" "}
                    · batches {jobLive.batchesCompleted ?? 0}/{jobLive.batchTotal}
                  </>
                ) : null}
                {jobLive.stringsTotal != null ? (
                  <> · {jobLive.stringsTotal.toLocaleString()} strings</>
                ) : null}
                {jobLive.judgePassScoreMin10 != null ? (
                  <>
                    {" "}
                    · reviewer gate ≥ {jobLive.judgePassScoreMin10.toFixed(1)}/10
                    {jobLive.minTranslationScoreStored != null ? (
                      <span className="text-[var(--muted-deep)]"> (job threshold)</span>
                    ) : (
                      <span className="text-[var(--muted-deep)]"> (default)</span>
                    )}
                  </>
                ) : null}
              </p>
            </div>
          </div>
        </div>
      ) : null}

      {error ? (
        <p className="rounded-lg border border-red-500/40 bg-red-500/10 px-4 py-3 text-[13px] text-red-200">
          {error}
        </p>
      ) : null}
    </div>
  );
}
