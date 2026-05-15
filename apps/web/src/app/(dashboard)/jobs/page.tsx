import { PageHeader } from "@/components/shell/PageHeader";
import { JobQueuePlaceholder } from "@/components/jobs/JobQueuePlaceholder";

export default function JobsPage() {
  return (
    <div className="animate-in">
      <PageHeader
        eyebrow="Operations"
        title="Jobs"
        description="History, live SSE progress, batch diagnostics, and download links when chunks finish scoring and rebuild."
      />
      <JobQueuePlaceholder />
    </div>
  );
}
