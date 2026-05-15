import { PageHeader } from "@/components/shell/PageHeader";
import { PromptEditors } from "@/components/prompts/PromptEditors";

export default function PromptsPage() {
  return (
    <div className="animate-in">
      <PageHeader
        eyebrow="Model context"
        title="Prompts"
        description={
          <>
            One row per <span className="text-[var(--fg-soft)]">source → target</span> pair. System layer holds
            non‑negotiable POS rules; user layer carries tone and variables.
          </>
        }
      />
      <PromptEditors />
    </div>
  );
}
