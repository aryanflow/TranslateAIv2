import { PageHeader } from "@/components/shell/PageHeader";
import { TranslateWizardShell } from "@/components/translate/TranslateWizardShell";

export default function TranslatePage() {
  return (
    <div className="animate-in">
      <PageHeader
        eyebrow="Localization"
        title="New translation"
        description="Upload a catalog, pick targets, then review prompts and term preferences before the job enters the BullMQ pipeline."
      />
      <TranslateWizardShell />
    </div>
  );
}
