import { Suspense } from "react";
import { PageHeader } from "@/components/shell/PageHeader";
import { JobsDashboard } from "@/components/jobs/JobsDashboard";

export default function JobsPage() {
  return (
    <div className="animate-in">
      <PageHeader
        eyebrow="Operations"
        title="Jobs"
        description="Live pipeline visuals, batch counts, ETA hints, SSE activity, and downloads when regeneration completes."
      />
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
