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
            Edit optional copy per{" "}
            <span className="text-[var(--fg-soft)]">source → target</span>; jobs fill glossary and terminology
            slots automatically when you leave the placeholders in place.
          </>
        }
      />
      <PromptEditors />
    </div>
  );
}
