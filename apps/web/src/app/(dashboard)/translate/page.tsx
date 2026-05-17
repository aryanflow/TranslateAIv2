import { PageHeader } from "@/components/shell/PageHeader";
import { TranslateWizardShell } from "@/components/translate/TranslateWizardShell";

export default function TranslatePage() {
  return (
    <div className="animate-in">
      <div
        className="pointer-events-none mb-6 h-px w-full max-w-lg bg-gradient-to-r from-[var(--accent)]/55 via-[var(--edge-bright)] to-transparent"
        aria-hidden
      />
      <PageHeader
        eyebrow="Localization"
        title="New translation"
        description="Upload a catalog, pick one target language, inspect extracted strings, then start a translation job — progress persists on the Jobs board."
      />
      <TranslateWizardShell />
    </div>
  );
}
