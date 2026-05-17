import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

const PREFIX = "/api/upstream";

function upstreamBase(): string {
  const raw =
    process.env.API_PROXY_TARGET ?? process.env.NEXT_PUBLIC_API_URL ?? "";
  const trimmed = raw.trim();
  if (trimmed) return trimmed.replace(/\/$/, "");
  /** Matches `resolveApiBaseUrl` server fallback so `/api/upstream` works without `.env.local` in dev */
  if (process.env.NODE_ENV === "development") {
    return "http://127.0.0.1:3001";
  }
  return "";
}

/**
 * Proxies `${origin}${PREFIX}/…` → Nest (`API_PROXY_TARGET` or `NEXT_PUBLIC_API_URL`).
 */
export function middleware(request: NextRequest) {
  const base = upstreamBase();
  if (!base) {
    return NextResponse.next();
  }
  const { pathname, search } = request.nextUrl;
  const suffix = pathname.startsWith(PREFIX)
    ? pathname.slice(PREFIX.length) || "/"
    : pathname;
  const pathPart = suffix.startsWith("/") ? suffix : `/${suffix}`;
  const url = `${base}${pathPart}${search}`;
  return NextResponse.rewrite(url);
}

export const config = {
  matcher: ["/api/upstream/:path*"],
};
