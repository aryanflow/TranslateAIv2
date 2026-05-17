import type { ReactNode } from "react";
import { HealthDataPrefetcher } from "@/components/health/HealthDataPrefetcher";
import { DashboardNav } from "@/components/shell/DashboardNav";

export default function DashboardLayout({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-dvh flex-1">
      <DashboardNav />
      <div className="relative z-[1] min-h-0 min-w-0 flex-1 overflow-auto">
        <HealthDataPrefetcher />
        <div className="mx-auto max-w-[1200px] px-5 py-8 sm:px-8 sm:py-10 lg:px-12 lg:py-12">{children}</div>
      </div>
    </div>
  );
}
