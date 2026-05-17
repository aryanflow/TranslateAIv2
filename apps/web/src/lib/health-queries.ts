/** Shared React Query keys + fetchers for `/health` and background prefetch. */

export type LlmProbe = {
  id: string;
  provider: string;
  modelId: string;
  status: string;
  latencyMs?: number;
  p95Ms?: number | null;
  lastError: string | null;
};

export type HealthDepsPayload = {
  postgres: { status: string; latencyMs?: number };
  redis: { status: string; note?: string };
  s3: { status: string; note?: string };
  llm: {
    translator: LlmProbe;
    judge: LlmProbe;
  };
};

export type UpstreamVersionPayload = {
  service: string;
  version: string;
  gitSha: string | null;
  buildTime: string | null;
  node: string;
};

export const healthDepsQueryKey = ["health-deps", "upstream"] as const;

export const upstreamVersionQueryKey = ["version", "upstream"] as const;

export async function fetchUpstreamHealthDeps(): Promise<HealthDepsPayload> {
  const res = await fetch("/api/upstream/health/deps");
  if (!res.ok) throw new Error("deps failed");
  return res.json() as Promise<HealthDepsPayload>;
}

export async function fetchUpstreamVersion(): Promise<UpstreamVersionPayload> {
  const res = await fetch("/api/upstream/version");
  if (!res.ok) throw new Error("version fetch failed");
  return res.json() as Promise<UpstreamVersionPayload>;
}
