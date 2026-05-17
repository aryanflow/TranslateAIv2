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
            Ship a baseline enterprise retail/POS system prompt from the API. Saved rows add an optional
            system overlay plus a [A]/[B]/[C] user-style template merged into every batch —
            glossary and terminology placeholders are hydrated by jobs.
          </>
        }
      />
      <PromptEditors />
    </div>
  );
}
