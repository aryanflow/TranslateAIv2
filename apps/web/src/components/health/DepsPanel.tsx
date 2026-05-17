"use client";

import { useQuery } from "@tanstack/react-query";
import { cn } from "@/lib/utils";

type LlmProbe = {
  id: string;
  provider: string;
  modelId: string;
  status: string;
  latencyMs?: number;
  /** Reserved for future metrics (not populated by API yet). */
  p95Ms?: number | null;
  lastError: string | null;
};

type Deps = {
  postgres: { status: string; latencyMs?: number };
  redis: { status: string; note?: string };
  s3: { status: string; note?: string };
  llm: {
    translator: LlmProbe;
    judge: LlmProbe;
  };
};

function StatusChip({ status }: { status: string }) {
  const up = status === "up";
  const down = status === "down";
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider",
        up && "bg-[rgba(92,212,154,0.12)] text-[var(--ok)]",
        down && "bg-[rgba(232,93,93,0.12)] text-[var(--danger)]",
        !up && !down && "bg-[var(--edge)] text-[var(--muted)]",
      )}
    >
      {status}
    </span>
  );
}

function formatProbeMs(ms: number | undefined | null) {
  if (ms == null || Number.isNaN(ms)) return "—";
  return `${ms}`;
}

function LlmCard({ title, probe }: { title: string; probe: LlmProbe }) {
  const modelLine =
    probe.modelId?.trim().length > 0 ? `${probe.provider} · ${probe.modelId}` : probe.provider;
  const p95 =
    probe.p95Ms != null && !Number.isNaN(probe.p95Ms) ? ` · p95 ~${probe.p95Ms}ms` : "";

  return (
    <li className="rounded-xl border border-[var(--edge)] bg-[var(--bg-elevated)]/50 p-4 sm:col-span-2">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0 space-y-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm font-medium text-[var(--fg)]">{title}</span>
            <StatusChip status={probe.status} />
          </div>
          <p
            className="break-all font-mono text-[11px] leading-snug text-[var(--muted-deep)]"
            title="Configured Bedrock model id"
          >
            {modelLine}
          </p>
        </div>
      </div>
      <p className="mt-2 font-mono text-xs text-[var(--muted)]">
        Last probe ~{formatProbeMs(probe.latencyMs)}ms{p95}
      </p>
      {probe.lastError ? (
        <p className="mt-2 break-words font-mono text-[11px] leading-relaxed text-[var(--danger)]">
          {probe.lastError}
        </p>
      ) : null}
    </li>
  );
}

function normalizeLlmProbe(raw: Partial<LlmProbe> & Pick<LlmProbe, "id" | "status" | "lastError">): LlmProbe {
  return {
    id: raw.id,
    provider: raw.provider ?? "bedrock",
    modelId: raw.modelId ?? "",
    status: raw.status,
    latencyMs: raw.latencyMs,
    p95Ms: raw.p95Ms ?? null,
    lastError: raw.lastError ?? null,
  };
}

export function DepsPanel() {
  const q = useQuery({
    queryKey: ["health-deps", "upstream"],
    queryFn: async () => {
      const res = await fetch("/api/upstream/health/deps");
      if (!res.ok) {
        throw new Error("deps failed");
      }
      return res.json() as Promise<Deps>;
    },
  });

  if (q.isLoading) {
    return (
      <div className="skeleton-shine grid gap-3 sm:grid-cols-2">
        {[1, 2, 3, 4].map((i) => (
          <div key={i} className="h-24 rounded-xl border border-[var(--edge)] bg-[var(--panel)]/50" />
        ))}
      </div>
    );
  }

  if (q.isError || !q.data) {
    return (
      <div className="rounded-xl border border-dashed border-[var(--edge-bright)] bg-[var(--bg0)]/40 p-5 text-sm text-[var(--muted)]">
        API not reachable via <span className="font-mono text-[var(--fg-soft)]">/api/upstream</span>. Start the Nest server
        for live dependency checks.
      </div>
    );
  }

  const d = q.data;

  const translator = normalizeLlmProbe(d.llm.translator);
  const judge = normalizeLlmProbe(d.llm.judge);

  return (
    <ul className="grid gap-3 sm:grid-cols-2">
      <li className="rounded-xl border border-[var(--edge)] bg-[var(--bg-elevated)]/50 p-4">
        <div className="flex items-center justify-between gap-2">
          <span className="text-sm font-medium text-[var(--fg)]">PostgreSQL</span>
          <StatusChip status={d.postgres.status} />
        </div>
        {d.postgres.latencyMs != null ? (
          <p className="mt-2 font-mono text-xs text-[var(--muted)]">latency ~{d.postgres.latencyMs}ms</p>
        ) : null}
      </li>
      <li className="rounded-xl border border-[var(--edge)] bg-[var(--bg-elevated)]/50 p-4">
        <div className="flex items-center justify-between gap-2">
          <span className="text-sm font-medium text-[var(--fg)]">Redis</span>
          <StatusChip status={d.redis.status} />
        </div>
        {"note" in d.redis && d.redis.note ? (
          <p className="mt-2 text-xs text-[var(--muted-deep)]">{d.redis.note}</p>
        ) : null}
      </li>
      <LlmCard title="Translator" probe={translator} />
      <LlmCard title="Judge (Quality reviewer)" probe={judge} />
      {judge.status === "degraded" &&
      judge.lastError?.toLowerCase().includes("empty") ? (
        <li className="rounded-xl border border-amber-500/35 bg-amber-500/[0.06] p-4 sm:col-span-2">
          <p className="text-[13px] font-medium text-[var(--fg)]">Judge returned no text</p>
          <p className="mt-2 text-[12px] leading-relaxed text-[var(--muted)]">
            Some Bedrock models omit content on very short probes. The API now retries empty responses and defaults to{" "}
            <code className="rounded bg-[var(--panel)] px-1 py-0.5 font-mono text-[11px]">
              openai.gpt-oss-20b-1:0
            </code>{" "}
            for scoring — switch back to{" "}
            <code className="rounded bg-[var(--panel)] px-1 py-0.5 font-mono text-[11px]">
              openai.gpt-oss-120b-1:0
            </code>{" "}
            in{" "}
            <code className="rounded bg-[var(--panel)] px-1 py-0.5 font-mono text-[11px]">
              BEDROCK_SCORING_MODEL_ID
            </code>{" "}
            if your region reliably streams 120B output; optionally raise{" "}
            <code className="rounded bg-[var(--panel)] px-1 py-0.5 font-mono text-[11px]">
              BEDROCK_SCORING_MAX_TOKENS
            </code>
            .
          </p>
        </li>
      ) : null}
    </ul>
  );
}
