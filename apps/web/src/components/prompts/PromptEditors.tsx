import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/**
 * Per ARCHITECTURE.md: dual editors (system + user) for each source → target row.
 */
export function PromptEditors() {
  return (
    <div className="mt-10 grid gap-5 lg:grid-cols-2">
      {[
        {
          title: "System prompt",
          subtitle: "Global POS rules — brevity, placeholders, no hallucinated markup.",
          foot: "Injected as developer/system where the model API allows.",
        },
        {
          title: "User prompt",
          subtitle: "Tone and variables per target language — formal DE vs. tight EN, etc.",
          foot: `Variables: {{glossary_block}}, {{source_lang}}, {{target_lang}}, {{target_language_name}}`,
        },
      ].map((col, i) => (
        <section
          key={col.title}
          className={cn(
            "animate-in flex flex-col rounded-xl border border-[var(--edge)] bg-[var(--bg-elevated)]/50 p-5",
            i === 1 && "animate-in-delay-1",
          )}
        >
          <h2 className="font-[family-name:var(--font-serif)] text-lg font-bold tracking-tight text-[var(--fg)]">
            {col.title}
          </h2>
          <p className="mt-1.5 text-[13px] leading-relaxed text-[var(--muted)]">{col.subtitle}</p>
          <div className="mt-4 min-h-[200px] flex-1 rounded-lg border border-dashed border-[var(--edge-bright)] bg-[var(--bg0)]/40 p-4 font-mono text-[12px] leading-relaxed text-[var(--muted-deep)]">
            Markdown editor slot — wired to GET/PUT /prompts/:sourceLang/:targetLang
          </div>
          <p className="mt-3 text-[11px] text-[var(--muted-deep)]">{col.foot}</p>
          <Button className="mt-4 w-fit" type="button" size="sm" variant="ghost" disabled>
            Preview assembled messages
          </Button>
        </section>
      ))}
    </div>
  );
}
