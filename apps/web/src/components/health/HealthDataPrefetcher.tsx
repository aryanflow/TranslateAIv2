"use client";

import { useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";
import {
  fetchUpstreamHealthDeps,
  fetchUpstreamVersion,
  HEALTH_DEPS_STALE_MS,
  healthDepsQueryKey,
  UPSTREAM_VERSION_STALE_MS,
  upstreamVersionQueryKey,
} from "@/lib/health-queries";

const PREFETCH_GC_MS = 20 * 60 * 1000;

/**
 * Warm the React Query cache for Health & Build as soon as any dashboard route mounts.
 * Uses a non-zero staleTime so opening `/health` reuses the cache instead of refetching
 * immediately (deps probes are slow). Idle-only scheduling was too easy to starve on busy
 * pages like Translate.
 */
export function HealthDataPrefetcher() {
  const queryClient = useQueryClient();

  useEffect(() => {
    const common = { gcTime: PREFETCH_GC_MS } as const;
    void queryClient.prefetchQuery({
      queryKey: healthDepsQueryKey,
      queryFn: fetchUpstreamHealthDeps,
      staleTime: HEALTH_DEPS_STALE_MS,
      ...common,
    });
    void queryClient.prefetchQuery({
      queryKey: upstreamVersionQueryKey,
      queryFn: fetchUpstreamVersion,
      staleTime: UPSTREAM_VERSION_STALE_MS,
      ...common,
    });
  }, [queryClient]);

  return null;
}
