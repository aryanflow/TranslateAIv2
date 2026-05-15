/** Live job view — strings, phase, judge scores, retries */
export function JobQueuePlaceholder() {
  return (
    <div className="mt-8 grid gap-4 sm:grid-cols-3">
      <div className="rounded-xl border border-[var(--edge)] bg-[var(--bg-elevated)]/50 p-4">
        <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-[var(--muted-deep)]">Progress</p>
        <p className="mt-2 font-[family-name:var(--font-serif)] text-2xl font-bold tabular-nums text-[var(--fg)]">
          0 <span className="text-[var(--muted-deep)]">/</span> 0
        </p>
        <p className="mt-1 text-xs text-[var(--muted)]">strings completed</p>
      </div>
      <div className="rounded-xl border border-[var(--edge)] bg-[var(--bg-elevated)]/50 p-4 sm:col-span-2">
        <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-[var(--muted-deep)]">Live stream</p>
        <p className="mt-2 font-mono text-xs leading-relaxed text-[var(--muted)]">
          SSE: <span className="text-[var(--accent-muted)]">GET /jobs/:id/events</span> — translator output, judge score,
          retry badges.
        </p>
      </div>
    </div>
  );
}
