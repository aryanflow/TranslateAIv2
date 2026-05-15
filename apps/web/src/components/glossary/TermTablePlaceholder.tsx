/** Term preferences — source phrase → preferred POS wording */
export function TermTablePlaceholder() {
  return (
    <div className="mt-8 overflow-hidden rounded-xl border border-[var(--edge)] bg-[var(--bg-elevated)]/40 shadow-sm">
      <div className="grid grid-cols-[1.2fr_1.4fr_1fr] gap-0 border-b border-[var(--edge)] bg-[var(--panel)]/80 px-4 py-3 text-[11px] font-semibold uppercase tracking-[0.14em] text-[var(--muted-deep)]">
        <div>Source term</div>
        <div>Preferred target</div>
        <div>Notes</div>
      </div>
      <div className="px-4 py-14 text-center">
        <p className="text-sm text-[var(--muted)]">Connect to GET /glossary?sourceLang&targetLang for live rows.</p>
        <p className="mt-2 text-xs text-[var(--muted-deep)]">Bulk CSV import in a later slice.</p>
      </div>
    </div>
  );
}
