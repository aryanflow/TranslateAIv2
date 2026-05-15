import { PageHeader } from "@/components/shell/PageHeader";
import { BuildInfo } from "@/components/health/BuildInfo";
import { DepsPanel } from "@/components/health/DepsPanel";

export default function HealthPage() {
  return (
    <div className="animate-in">
      <PageHeader
        eyebrow="Reliability"
        title="Health & dependencies"
        description="Postgres, Redis, S3, translator, and judge — plus build metadata from the API. First-class ops surface, not a hidden debug page."
      />
      <div className="animate-in-delay-1 mt-10 grid gap-10 lg:grid-cols-2">
        <section>
          <h2 className="mb-4 text-xs font-semibold uppercase tracking-[0.2em] text-[var(--muted-deep)]">
            Dependency grid
          </h2>
          <DepsPanel />
        </section>
        <section>
          <h2 className="mb-4 text-xs font-semibold uppercase tracking-[0.2em] text-[var(--muted-deep)]">Build</h2>
          <BuildInfo />
        </section>
      </div>
    </div>
  );
}
