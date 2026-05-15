"use client";

import { useQuery } from "@tanstack/react-query";

const apiBase = process.env.NEXT_PUBLIC_API_URL ?? "http://127.0.0.1:3001";

export function BuildInfo() {
  const q = useQuery({
    queryKey: ["version", apiBase],
    queryFn: async () => {
      const res = await fetch(`${apiBase}/version`);
      if (!res.ok) {
        throw new Error("version fetch failed");
      }
      return res.json() as Promise<{
        service: string;
        version: string;
        gitSha: string | null;
        buildTime: string | null;
        node: string;
      }>;
    },
  });

  if (q.isLoading) {
    return (
      <div className="skeleton-shine min-h-[140px] rounded-xl border border-[var(--edge)] bg-[var(--panel)]/60 p-4">
        <div className="h-3 w-24 rounded bg-[var(--edge)]" />
        <div className="mt-4 h-4 w-full max-w-[200px] rounded bg-[var(--edge)]" />
        <div className="mt-3 h-4 w-full max-w-[160px] rounded bg-[var(--edge)]" />
      </div>
    );
  }

  if (q.isError || !q.data) {
    return (
      <div className="rounded-xl border border-dashed border-[var(--edge-bright)] bg-[var(--bg0)]/40 p-5 text-sm text-[var(--muted)]">
        Start the API on <span className="font-mono text-[var(--fg-soft)]">{apiBase}</span> to load{" "}
        <code className="rounded bg-[var(--edge)] px-1.5 py-0.5 font-mono text-xs text-[var(--accent-muted)]">
          GET /version
        </code>
        .
      </div>
    );
  }

  const d = q.data;
  const rows = [
    { k: "Service", v: d.service },
    { k: "Version", v: d.version },
    { k: "Git SHA", v: d.gitSha ?? "—" },
    { k: "Node", v: d.node },
  ];

  return (
    <div className="overflow-hidden rounded-xl border border-[var(--edge)] bg-gradient-to-b from-[var(--bg-elevated)]/90 to-[var(--panel)]/70 p-1 shadow-sm">
      <dl className="divide-y divide-[var(--edge)]/80">
        {rows.map((row) => (
          <div key={row.k} className="flex items-baseline justify-between gap-4 px-4 py-3">
            <dt className="text-[11px] font-semibold uppercase tracking-[0.14em] text-[var(--muted-deep)]">
              {row.k}
            </dt>
            <dd className="truncate font-mono text-xs text-[var(--fg-soft)]">{row.v}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}
