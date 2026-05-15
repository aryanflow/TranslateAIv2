"use client";

import { useQuery } from "@tanstack/react-query";
import { cn } from "@/lib/utils";

const apiBase = process.env.NEXT_PUBLIC_API_URL ?? "http://127.0.0.1:3001";

type Deps = {
  postgres: { status: string; latencyMs?: number };
  redis: { status: string; note?: string };
  s3: { status: string; note?: string };
  llm: {
    translator: { id: string; status: string; latencyMs: number; p95Ms: number; lastError: string | null };
    judge: { id: string; status: string; latencyMs: number; p95Ms: number; lastError: string | null };
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

export function DepsPanel() {
  const q = useQuery({
    queryKey: ["health-deps", apiBase],
    queryFn: async () => {
      const res = await fetch(`${apiBase}/health/deps`);
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
        API not reachable at <span className="font-mono text-[var(--fg-soft)]">{apiBase}</span>. Start the Nest server
        for live dependency checks.
      </div>
    );
  }

  const d = q.data;

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
      <li className="rounded-xl border border-[var(--edge)] bg-[var(--bg-elevated)]/50 p-4 sm:col-span-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <span className="text-sm font-medium text-[var(--fg)]">Translator · {d.llm.translator.id}</span>
          <StatusChip status={d.llm.translator.status} />
        </div>
        <p className="mt-2 font-mono text-xs text-[var(--muted)]">
          p50 ~{d.llm.translator.latencyMs}ms · p95 ~{d.llm.translator.p95Ms}ms
        </p>
      </li>
      <li className="rounded-xl border border-[var(--edge)] bg-[var(--bg-elevated)]/50 p-4 sm:col-span-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <span className="text-sm font-medium text-[var(--fg)]">Judge · {d.llm.judge.id}</span>
          <StatusChip status={d.llm.judge.status} />
        </div>
        <p className="mt-2 font-mono text-xs text-[var(--muted)]">
          p50 ~{d.llm.judge.latencyMs}ms · p95 ~{d.llm.judge.p95Ms}ms
        </p>
      </li>
    </ul>
  );
}
