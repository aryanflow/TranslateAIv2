export const API_PREFIX = "/api/upstream";
export const TENANT_ID = process.env.NEXT_PUBLIC_DEV_TENANT_ID ?? "";

/** Dev tenant + JSON content type. For POST JSON, always send a body (e.g. `{}`) — Fastify rejects `application/json` with an empty body. */
export function apiHeaders(): HeadersInit {
  return {
    "Content-Type": "application/json",
    ...(TENANT_ID ? { "X-Tenant-Id": TENANT_ID } : {}),
  };
}

/** Tenant header only — use for POSTs with no body (e.g. `POST /jobs/:id/cancel`) so upstream does not require a JSON payload. */
export function tenantOnlyHeaders(): HeadersInit {
  return TENANT_ID ? { "X-Tenant-Id": TENANT_ID } : {};
}

/** Best-effort parse of Nest `{ message, statusCode }` JSON error bodies from `/api/upstream`. */
export async function readUpstreamErrorBody(res: Response): Promise<string> {
  const text = await res.text();
  if (!text.trim()) return res.statusText || `HTTP ${res.status}`;
  try {
    const j = JSON.parse(text) as {
      message?: string | string[];
      error?: string;
    };
    if (Array.isArray(j.message)) return j.message.join("; ");
    if (typeof j.message === "string") return j.message;
    if (typeof j.error === "string") return j.error;
  } catch {
    /* not JSON */
  }
  return text.length > 2000 ? `${text.slice(0, 2000)}…` : text;
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
