import { PageHeader } from "@/components/shell/PageHeader";
import { TranslateWizardShell } from "@/components/translate/TranslateWizardShell";

export default function TranslatePage() {
  return (
    <div className="animate-in">
      <PageHeader
        eyebrow="Localization"
        title="New translation"
        description="Upload a catalog, pick one target language, inspect extracted strings, then ship a BullMQ job — progress persists on the Jobs board."
      />
      <TranslateWizardShell />
    </div>
  );
}
