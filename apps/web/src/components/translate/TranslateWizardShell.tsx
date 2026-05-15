"use client";

import { useCallback, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { LANG_OPTIONS } from "@/lib/lang-options";
import type { ReactNode } from "react";

const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? "http://127.0.0.1:3001";
const TENANT_ID = process.env.NEXT_PUBLIC_DEV_TENANT_ID ?? "";

function formatApiError(e: unknown): string {
  if (e instanceof TypeError) {
    return `Cannot reach the API at ${API_BASE} (${e.message}). Start the API (e.g. \`pnpm --filter api dev\` from the repo root) and ensure Postgres/Redis match your DATABASE_URL and REDIS_URL. Check NEXT_PUBLIC_API_URL in apps/web/.env.local.`;
  }
  return e instanceof Error ? e.message : "Something went wrong.";
}

function apiHeaders(): HeadersInit {
  return {
    "Content-Type": "application/json",
    ...(TENANT_ID ? { "X-Tenant-Id": TENANT_ID } : {}),
  };
}

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

type JobStatusResponse = {
  id: string;
  status: string;
  progress: number;
};

/** Presigned upload → POST /jobs → poll status (SSE omits tenant headers in browsers). */
export function TranslateWizardShell() {
  const [file, setFile] = useState<File | null>(null);
  const [sourceLang, setSourceLang] = useState<string>("american_english");
  const [targets, setTargets] = useState<string[]>(["spanish"]);
  const [batchSize, setBatchSize] = useState(50);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [jobId, setJobId] = useState<string | null>(null);
  const [jobStatus, setJobStatus] = useState<JobStatusResponse | null>(null);

  const tenantOk = useMemo(() => TENANT_ID.length > 0, []);

  const toggleTarget = (value: string) => {
    setTargets((prev) =>
      prev.includes(value) ? prev.filter((v) => v !== value) : [...prev, value],
    );
  };

  const pollJob = useCallback(async (id: string) => {
    for (;;) {
      const res = await fetch(`${API_BASE}/jobs/${id}`, {
        headers: apiHeaders(),
      });
      if (!res.ok) throw new Error(await res.text());
      const data = (await res.json()) as JobStatusResponse;
      setJobStatus(data);
      if (data.status === "completed" || data.status === "failed") {
        return;
      }
      await new Promise((r) => setTimeout(r, 2000));
    }
  }, []);

  const run = async () => {
    setError(null);
    if (!tenantOk) {
      setError("Set NEXT_PUBLIC_DEV_TENANT_ID to a valid tenant UUID from your database.");
      return;
    }
    if (!file) {
      setError("Choose a file first.");
      return;
    }
    if (!targets.length) {
      setError("Pick at least one target language.");
      return;
    }

    setBusy(true);
    setJobId(null);
    setJobStatus(null);

    try {
      const pre = await fetch(`${API_BASE}/files/presigned-url`, {
        method: "POST",
        headers: apiHeaders(),
        body: JSON.stringify({
          fileName: file.name,
          contentType: file.type || "application/octet-stream",
        }),
      });
      if (!pre.ok) throw new Error(`Presign failed: ${await pre.text()}`);
      const { uploadUrl, fileKey } = (await pre.json()) as {
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

      const jobRes = await fetch(`${API_BASE}/jobs`, {
        method: "POST",
        headers: apiHeaders(),
        body: JSON.stringify({
          fileKey,
          sourceLang,
          targetLangs: targets,
          batchSize,
        }),
      });
      if (!jobRes.ok) throw new Error(`Create job failed: ${await jobRes.text()}`);
      const created = (await jobRes.json()) as { jobId: string };
      setJobId(created.jobId);
      await pollJob(created.jobId);
    } catch (e) {
      setError(formatApiError(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mt-10 space-y-5">
      {!tenantOk ? (
        <p className="rounded-lg border border-[var(--edge)] bg-[var(--bg0)]/80 px-4 py-3 text-[13px] text-[var(--muted)]">
          Add{" "}
          <code className="rounded bg-[var(--panel)] px-1.5 py-0.5 font-mono text-[12px]">
            NEXT_PUBLIC_DEV_TENANT_ID
          </code>{" "}
          to{" "}
          <code className="rounded bg-[var(--panel)] px-1.5 py-0.5 font-mono text-[12px]">apps/web/.env.local</code>{" "}
          (tenant must exist in Postgres).
        </p>
      ) : null}

      <StepCard step={1} title="Source file" className="animate-in-delay-1">
        <p className="text-[13px] leading-relaxed text-[var(--muted)]">
          Direct upload via presigned URL — API streams from S3 into extractors; huge catalogs stay off the API
          process.
        </p>
        <div className="flex flex-wrap items-center gap-2 pt-1">
          <input
            type="file"
            accept=".xml,.json,.csv,.xlsx,.xls"
            className="max-w-full text-[13px] text-[var(--muted)] file:mr-3 file:rounded-md file:border file:border-[var(--edge-bright)] file:bg-[var(--panel)] file:px-3 file:py-1.5 file:text-[12px] file:font-medium file:text-[var(--fg)]"
            onChange={(e) => setFile(e.target.files?.[0] ?? null)}
          />
        </div>
      </StepCard>

      <StepCard step={2} title="Languages & batching" className="animate-in-delay-2">
        <div className="grid gap-4 sm:grid-cols-2">
          <label className="space-y-1.5">
            <span className="text-[11px] font-medium uppercase tracking-wide text-[var(--muted-deep)]">
              Source
            </span>
            <select
              value={sourceLang}
              onChange={(e) => setSourceLang(e.target.value)}
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
              Batch size
            </span>
            <input
              type="number"
              min={10}
              max={500}
              value={batchSize}
              onChange={(e) => setBatchSize(Number(e.target.value))}
              className="w-full rounded-lg border border-[var(--edge)] bg-[var(--bg0)] px-3 py-2 text-[13px] text-[var(--fg)]"
            />
          </label>
        </div>
        <div className="space-y-2">
          <span className="text-[11px] font-medium uppercase tracking-wide text-[var(--muted-deep)]">
            Target languages
          </span>
          <div className="flex flex-wrap gap-2">
            {LANG_OPTIONS.map((o) => {
              const on = targets.includes(o.value);
              return (
                <button
                  key={o.value}
                  type="button"
                  onClick={() => toggleTarget(o.value)}
                  className={cn(
                    "rounded-full border px-3 py-1 text-[12px] font-medium transition-colors",
                    on
                      ? "border-[var(--accent)] bg-[var(--accent)]/15 text-[var(--fg)]"
                      : "border-[var(--edge)] text-[var(--muted)] hover:border-[var(--edge-bright)]",
                  )}
                >
                  {o.label}
                </button>
              );
            })}
          </div>
        </div>
      </StepCard>

      <div className="flex flex-wrap items-center gap-3">
        <Button type="button" size="sm" disabled={busy || !tenantOk} onClick={() => void run()}>
          {busy ? "Working…" : "Start translation"}
        </Button>
        {jobId ? (
          <span className="text-[12px] text-[var(--muted)]">
            Job{" "}
            <code className="rounded bg-[var(--panel)] px-1.5 py-0.5 font-mono text-[11px]">{jobId}</code>
            {jobStatus ? (
              <>
                {" "}
                · {jobStatus.status} · {Math.round(jobStatus.progress)}%
              </>
            ) : null}
          </span>
        ) : null}
      </div>

      {error ? (
        <p className="rounded-lg border border-red-500/40 bg-red-500/10 px-4 py-3 text-[13px] text-red-200">
          {error}
        </p>
      ) : null}
    </div>
  );
}
