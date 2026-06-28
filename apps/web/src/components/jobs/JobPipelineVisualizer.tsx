"use client";

import { useMemo } from "react";
import { cn } from "@/lib/utils";
import {
  batchStepLabel,
  batchStepShort,
  macroStepIndex,
  MACRO_STEPS,
  type BatchStep,
  type PipelineViewState,
} from "@/lib/job-pipeline-state";
import {
  estimateEtaSeconds,
  formatDurationSeconds,
  phaseLabel,
} from "@/components/jobs/job-visual-utils";

type Props = {
  pipeline: PipelineViewState;
  jobStatus: string;
  progress: number;
  createdAt: string;
  /** Compact mode for wizard inline card */
  variant?: "full" | "compact";
  className?: string;
};

function stepTone(step: BatchStep): string {
  switch (step) {
    case "done":
      return "border-[var(--ok)]/45 bg-[var(--ok)]/[0.1] text-[var(--ok)]";
    case "failed":
      return "border-[var(--danger)]/45 bg-[var(--danger)]/[0.1] text-[var(--danger)]";
    case "retrying":
      return "border-amber-400/45 bg-amber-400/[0.08] text-amber-200/90";
    case "judge_waiting":
    case "judge_sending":
    case "judge_done":
      return "border-violet-400/35 bg-violet-400/[0.08] text-violet-200/90";
    case "translate_sending":
    case "translate_waiting":
      return "border-[var(--accent)]/45 bg-[var(--accent)]/[0.12] text-[var(--accent-muted)]";
    case "queued":
    default:
      return "border-[var(--edge)] bg-[var(--bg0)]/60 text-[var(--muted-deep)]";
  }
}

function isActiveStep(step: BatchStep): boolean {
  return (
    step === "translate_sending" ||
    step === "translate_waiting" ||
    step === "judge_sending" ||
    step === "judge_waiting" ||
    step === "retrying"
  );
}

function MacroRail({
  macroPhase,
  jobStatus,
}: {
  macroPhase: PipelineViewState["macroPhase"];
  jobStatus: string;
}) {
  const current = macroStepIndex(
    jobStatus === "completed" ||
      jobStatus === "failed" ||
      jobStatus === "cancelled"
      ? (jobStatus as PipelineViewState["macroPhase"])
      : macroPhase,
  );

  return (
    <ol className="flex flex-wrap items-center gap-1 sm:gap-0" aria-label="Pipeline stages">
      {MACRO_STEPS.map((step, i) => {
        const done = current > i || jobStatus === "completed";
        const active = current === i && jobStatus !== "completed" && jobStatus !== "failed";
        const failed = jobStatus === "failed" && i === Math.max(0, current);
        return (
          <li key={step.id} className="flex items-center">
            <span
              className={cn(
                "flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.1em] transition-colors motion-reduce:transition-none",
                done && !failed && "border-[var(--ok)]/35 bg-[var(--ok)]/[0.06] text-[var(--ok)]",
                active && "border-[var(--accent)]/50 bg-[var(--accent)]/[0.1] text-[var(--accent)]",
                !done && !active && "border-[var(--edge)] text-[var(--muted-deep)]",
                failed && "border-[var(--danger)]/40 text-[var(--danger)]",
              )}
            >
              {active ? (
                <span className="relative flex h-1.5 w-1.5">
                  <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-[var(--accent)] opacity-70 motion-reduce:animate-none" />
                  <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-[var(--accent)]" />
                </span>
              ) : done ? (
                <span aria-hidden>✓</span>
              ) : (
                <span className="h-1.5 w-1.5 rounded-full bg-[var(--edge-bright)]" aria-hidden />
              )}
              {step.label}
            </span>
            {i < MACRO_STEPS.length - 1 ? (
              <span
                className={cn(
                  "mx-1 hidden h-px w-3 sm:block",
                  done ? "bg-[var(--ok)]/30" : "bg-[var(--edge)]",
                )}
                aria-hidden
              />
            ) : null}
          </li>
        );
      })}
    </ol>
  );
}

function BatchChip({
  batch,
  compact,
}: {
  batch: PipelineViewState["batches"][number];
  compact?: boolean;
}) {
  const active = isActiveStep(batch.step);
  const label = compact
    ? batchStepShort(batch.step)
    : `#${batch.localIndex + 1}`;

  return (
    <div
      title={`Batch ${batch.localIndex + 1} · ${batch.stringCount} strings · ${batchStepLabel(batch.step)}${batch.judgeScoreAvg != null ? ` · avg ${batch.judgeScoreAvg.toFixed(1)}/10` : ""}`}
      className={cn(
        "relative flex flex-col items-center justify-center rounded-md border text-center transition-[border-color,background-color,box-shadow] duration-300 motion-reduce:transition-none",
        compact ? "min-h-[2.25rem] min-w-[2.25rem] px-1 py-1" : "min-h-[3rem] min-w-[2.75rem] px-1.5 py-1.5",
        stepTone(batch.step),
        active && "shadow-[0_0_0_1px_rgba(212,175,92,0.2)]",
      )}
    >
      {active ? (
        <span className="pointer-events-none absolute inset-0 overflow-hidden rounded-md">
          <span className="jd-batch-shimmer absolute inset-0 opacity-40 motion-reduce:opacity-0" />
        </span>
      ) : null}
      <span className="relative font-mono text-[10px] font-bold tabular-nums leading-none">
        {label}
      </span>
      {!compact ? (
        <span className="relative mt-0.5 max-w-full truncate font-mono text-[8px] uppercase tracking-wide opacity-80">
          {batchStepShort(batch.step)}
        </span>
      ) : null}
      {!compact && batch.stringCount > 0 ? (
        <span className="relative mt-0.5 font-mono text-[8px] tabular-nums opacity-60">
          {batch.stringCount}s
        </span>
      ) : null}
    </div>
  );
}

export function JobPipelineVisualizer({
  pipeline,
  jobStatus,
  progress,
  createdAt,
  variant = "full",
  className,
}: Props) {
  const etaSec = useMemo(
    () =>
      estimateEtaSeconds({
        progress,
        createdAt,
        status: jobStatus,
      }),
    [progress, createdAt, jobStatus],
  );

  const doneCount = pipeline.batches.filter((b) => b.step === "done").length;
  const activeBatches = pipeline.batches.filter((b) => isActiveStep(b.step));

  const statusLine = pipeline.latestDetail ?? phaseLabel(jobStatus);

  return (
    <div className={cn("space-y-4", className)}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <MacroRail macroPhase={pipeline.macroPhase} jobStatus={jobStatus} />
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] tabular-nums text-[var(--muted)]">
          {pipeline.stringsDone != null && pipeline.stringsTotal != null ? (
            <span>
              {pipeline.stringsDone.toLocaleString()} / {pipeline.stringsTotal.toLocaleString()} strings
            </span>
          ) : pipeline.stringsTotal != null ? (
            <span>{pipeline.stringsTotal.toLocaleString()} strings</span>
          ) : null}
          {pipeline.batchPlanReady && pipeline.batchCount > 0 ? (
            <span>
              · {doneCount}/{pipeline.batchCount} batches
            </span>
          ) : null}
          {etaSec != null && jobStatus !== "completed" && jobStatus !== "failed" ? (
            <span className="text-[var(--accent-muted)]">
              · ~{formatDurationSeconds(etaSec)} left
            </span>
          ) : null}
        </div>
      </div>

      {pipeline.batchPlanReady && pipeline.batches.length > 0 ? (
        <div>
          <div className="mb-2 flex items-center justify-between gap-2">
            <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-[var(--muted-deep)]">
              Batch grid
            </p>
            <div className="flex flex-wrap gap-2 text-[9px] text-[var(--muted-deep)]">
              <span className="inline-flex items-center gap-1">
                <span className="h-2 w-2 rounded-sm border border-[var(--accent)]/45 bg-[var(--accent)]/[0.12]" />
                Translator
              </span>
              <span className="inline-flex items-center gap-1">
                <span className="h-2 w-2 rounded-sm border border-violet-400/35 bg-violet-400/[0.08]" />
                Reviewer
              </span>
              <span className="inline-flex items-center gap-1">
                <span className="h-2 w-2 rounded-sm border border-amber-400/45 bg-amber-400/[0.08]" />
                Retry
              </span>
              <span className="inline-flex items-center gap-1">
                <span className="h-2 w-2 rounded-sm border border-[var(--ok)]/45 bg-[var(--ok)]/[0.1]" />
                Done
              </span>
            </div>
          </div>
          <div
            className={cn(
              "flex flex-wrap gap-1.5 rounded-lg border border-[var(--edge)] bg-[var(--bg0)]/50 p-2.5",
              variant === "compact" && "max-h-28 overflow-y-auto",
            )}
          >
            {pipeline.batches.map((b) => (
              <BatchChip key={b.index} batch={b} compact={variant === "compact"} />
            ))}
          </div>
        </div>
      ) : pipeline.macroPhase === "chunking" || jobStatus === "chunking" ? (
        <div className="flex items-center gap-2 rounded-lg border border-dashed border-[var(--accent-muted)]/40 bg-[var(--panel)]/30 px-3 py-2.5">
          <span className="relative flex h-2 w-2">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-[var(--accent)] opacity-60 motion-reduce:animate-none" />
            <span className="relative inline-flex h-2 w-2 rounded-full bg-[var(--accent)]" />
          </span>
          <p className="text-[12px] text-[var(--muted)]">Breaking catalogue into translation batches…</p>
        </div>
      ) : pipeline.macroPhase === "extracting" || jobStatus === "extracting" ? (
        <div className="flex items-center gap-2 rounded-lg border border-dashed border-[var(--edge-bright)] bg-[var(--panel)]/20 px-3 py-2.5">
          <span className="relative flex h-2 w-2">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-[var(--muted)] opacity-50 motion-reduce:animate-none" />
            <span className="relative inline-flex h-2 w-2 rounded-full bg-[var(--muted)]" />
          </span>
          <p className="text-[12px] text-[var(--muted)]">Reading catalogue from storage…</p>
        </div>
      ) : null}

      {activeBatches.length > 0 ? (
        <div className="space-y-1.5 rounded-lg border border-[var(--accent)]/25 bg-[var(--accent)]/[0.04] px-3 py-2.5">
          <p className="text-[10px] font-semibold uppercase tracking-[0.1em] text-[var(--accent-muted)]">
            Live · {activeBatches.length} batch{activeBatches.length === 1 ? "" : "es"} in flight
          </p>
          <ul className="space-y-1">
            {activeBatches.slice(0, variant === "compact" ? 2 : 4).map((b) => (
              <li
                key={b.index}
                className="flex flex-wrap items-baseline gap-x-2 text-[12px] leading-snug text-[var(--fg-soft)]"
              >
                <span className="font-mono text-[11px] tabular-nums text-[var(--accent)]">
                  Batch {b.localIndex + 1}
                </span>
                <span className="text-[var(--muted)]">·</span>
                <span>{batchStepLabel(b.step)}</span>
                {b.stringCount > 0 ? (
                  <span className="font-mono text-[10px] text-[var(--muted-deep)]">
                    ({b.stringCount} strings)
                  </span>
                ) : null}
              </li>
            ))}
          </ul>
        </div>
      ) : statusLine && jobStatus !== "completed" ? (
        <p className="text-[12px] leading-snug text-[var(--muted)]">{statusLine}</p>
      ) : null}
    </div>
  );
}
