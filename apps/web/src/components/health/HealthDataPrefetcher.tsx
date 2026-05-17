"use client";

import { useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";
import {
  fetchUpstreamHealthDeps,
  fetchUpstreamVersion,
  healthDepsQueryKey,
  upstreamVersionQueryKey,
} from "@/lib/health-queries";

/**
 * Warm the React Query cache for Health & Build panels while the user is elsewhere
 * in the dashboard (idle-time fetch, non-blocking).
 */
export function HealthDataPrefetcher() {
  const queryClient = useQueryClient();

  useEffect(() => {
    const run = () => {
      void queryClient.prefetchQuery({
        queryKey: healthDepsQueryKey,
        queryFn: fetchUpstreamHealthDeps,
      });
      void queryClient.prefetchQuery({
        queryKey: upstreamVersionQueryKey,
        queryFn: fetchUpstreamVersion,
      });
    };

    if (typeof window === "undefined") return;

    if ("requestIdleCallback" in window) {
      const id = window.requestIdleCallback(run, { timeout: 5000 });
      return () => window.cancelIdleCallback(id);
    }

    const t = window.setTimeout(run, 400);
    return () => window.clearTimeout(t);
  }, [queryClient]);

  return null;
}
