/**
 * Nest API origin for `/api/upstream/*` (see `app/api/upstream/[...path]/route.ts`).
 * Route handlers run on Node and can read `API_PROXY_TARGET` (not only `NEXT_PUBLIC_*`).
 */
export function getUpstreamApiOrigin(): string | null {
  for (const envKey of ["API_PROXY_TARGET", "NEXT_PUBLIC_API_URL"] as const) {
    const raw = process.env[envKey];
    const trimmed = String(raw ?? "").trim();
    if (
      trimmed.length > 0 &&
      trimmed !== "undefined" &&
      trimmed !== "null"
    ) {
      return trimmed.replace(/\/$/, "");
    }
  }
  if (process.env.NODE_ENV === "development") {
    return "http://localhost:3001";
  }
  return null;
}
