/**
 * Nest API origin for `/api/upstream/*` (see `app/api/upstream/[...path]/route.ts`).
 * Route handlers run on Node and can read `API_PROXY_TARGET` (not only `NEXT_PUBLIC_*`).
 */
export function getUpstreamApiOrigin(): string | null {
  const raw =
    process.env.API_PROXY_TARGET ?? process.env.NEXT_PUBLIC_API_URL ?? "";
  const trimmed = raw.trim();
  if (trimmed) return trimmed.replace(/\/$/, "");
  if (process.env.NODE_ENV === "development") {
    return "http://127.0.0.1:3001";
  }
  return null;
}
