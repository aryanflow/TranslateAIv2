import { Suspense } from "react";
import { PageHeader } from "@/components/shell/PageHeader";
import { JobsDashboard } from "@/components/jobs/JobsDashboard";

export default function JobsPage() {
  return (
    <div className="animate-in">
      <PageHeader eyebrow="Operations" title="Jobs" />
      <Suspense
        fallback={
          <p className="mt-8 text-[13px] text-[var(--muted)]">Loading jobs…</p>
        }
      >
        <JobsDashboard />
      </Suspense>
    </div>
  );
}
