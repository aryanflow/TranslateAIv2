import { PageHeader } from "@/components/shell/PageHeader";
import { TermTablePlaceholder } from "@/components/glossary/TermTablePlaceholder";

export default function GlossaryPage() {
  return (
    <div className="animate-in">
      <PageHeader
        eyebrow="Synonym lock-in"
        title="Term preferences"
        description="When the source has multiple valid wordings, choose the one cashiers and shoppers should always see on the POS. Injected into batch context when token budget allows."
      />
      <TermTablePlaceholder />
    </div>
  );
}
