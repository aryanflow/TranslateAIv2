export const API_PREFIX = "/api/upstream";
export const TENANT_ID = process.env.NEXT_PUBLIC_DEV_TENANT_ID ?? "";

export function apiHeaders(): HeadersInit {
  return {
    "Content-Type": "application/json",
    ...(TENANT_ID ? { "X-Tenant-Id": TENANT_ID } : {}),
  };
}

/** EventSource cannot send headers — tenant id is passed as query (see API TenantGuard). */
export function jobEventsUrl(jobId: string): string {
  const origin =
    typeof window !== "undefined" ? window.location.origin : "";
  const q = TENANT_ID ? `?tenantId=${encodeURIComponent(TENANT_ID)}` : "";
  return `${origin}${API_PREFIX}/jobs/${jobId}/events${q}`;
}

export function formatApiError(e: unknown): string {
  if (e instanceof TypeError) {
    return `Cannot reach the API via ${API_PREFIX} (${e.message}). Start the API, set API_PROXY_TARGET or NEXT_PUBLIC_API_URL for local dev, and ensure Postgres/Redis are up.`;
  }
  return e instanceof Error ? e.message : "Something went wrong.";
}
