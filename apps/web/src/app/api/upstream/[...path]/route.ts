import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { getUpstreamApiOrigin } from "@/lib/upstream-base";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const HOP_REQUEST = new Set([
  "connection",
  "keep-alive",
  "transfer-encoding",
  "te",
  "trailer",
  "upgrade",
  "host",
  "content-length",
]);

const TRANSIENT_UPSTREAM_RE =
  /ECONNREFUSED|ECONNRESET|ETIMEDOUT|fetch failed|UND_ERR_|ENOTFOUND|EHOSTUNREACH|ENETUNREACH|AggregateError|EPIPE/i;

/** Nest cold start under Turbo often exceeds a few seconds. */
const UPSTREAM_RETRY_DELAYS_MS = [0, 200, 500, 1000, 2000, 4000, 8000];
const ALT_LOOPBACK_RETRY_DELAYS_MS = [0, 400, 1200];

function describeFetchFailure(e: unknown): string {
  const parts: string[] = [];
  const seen = new Set<unknown>();

  function walk(node: unknown) {
    if (node === null || node === undefined) return;
    if (typeof node !== "object" && typeof node !== "function") {
      parts.push(String(node));
      return;
    }
    if (seen.has(node)) return;
    seen.add(node);
    if (node instanceof Error && node.message) parts.push(node.message);
    const agg =
      typeof AggregateError !== "undefined" && node instanceof AggregateError
        ? node.errors
        : null;
    if (agg?.length) for (const sub of agg) walk(sub);
    const cause = (node as { cause?: unknown }).cause;
    if (cause !== undefined) walk(cause);
  }

  walk(e);
  return [...new Set(parts)].filter(Boolean).slice(0, 6).join(" | ");
}

function swapLoopbackHostname(urlStr: string): string | null {
  try {
    const next = new URL(urlStr);
    if (next.hostname === "127.0.0.1") next.hostname = "localhost";
    else if (next.hostname === "localhost" || next.hostname === "::1") {
      next.hostname = "127.0.0.1";
    } else return null;
    return next.toString();
  } catch {
    return null;
  }
}

async function fetchWithRetryDelays(
  target: string,
  init: RequestInit,
  delaysMs: readonly number[],
): Promise<Response> {
  let lastError: unknown;
  for (let i = 0; i < delaysMs.length; i++) {
    const delay = delaysMs[i]!;
    if (delay > 0) {
      await new Promise<void>((resolve) =>
        globalThis.setTimeout(resolve, delay),
      );
    }
    try {
      return await fetch(target, init);
    } catch (e) {
      lastError = e;
      const msg = describeFetchFailure(e);
      const lastAttempt = i === delaysMs.length - 1;
      if (lastAttempt || !TRANSIENT_UPSTREAM_RE.test(msg)) throw e;
    }
  }
  throw lastError;
}

async function fetchUpstream(
  target: string,
  init: RequestInit,
): Promise<Response> {
  try {
    return await fetchWithRetryDelays(target, init, UPSTREAM_RETRY_DELAYS_MS);
  } catch (primaryErr) {
    const alt = swapLoopbackHostname(target);
    if (!alt || alt === target) throw primaryErr;
    try {
      return await fetchWithRetryDelays(
        alt,
        init,
        ALT_LOOPBACK_RETRY_DELAYS_MS,
      );
    } catch {
      throw primaryErr;
    }
  }
}

function buildTargetUrl(path: string[], search: string): string | null {
  const base = getUpstreamApiOrigin();
  if (!base) return null;
  const suffix = path.length ? `/${path.join("/")}` : "";
  return `${base}${suffix}${search}`;
}

function proxyUnreachableMessage(origin: string, fetchError: string): string {
  const base =
    `Next.js proxy could not reach the API (${origin}): ${fetchError}. ` +
    `Check API_PROXY_TARGET / NEXT_PUBLIC_API_URL, and that this Next process can open a TCP connection to that host.`;
  if (/ECONNREFUSED|fetch failed|ECONNRESET|ENOTFOUND/i.test(fetchError)) {
    return (
      base +
      ` Common fix: start Nest on port 3001 — from the repo root run \`pnpm dev\` or \`pnpm dev:api\`. ` +
      `Quick check: \`curl -sS ${origin}/health/live\`. ` +
      `If Next runs inside Docker and the API on your Mac, use API_PROXY_TARGET=http://host.docker.internal:3001 (not 127.0.0.1).`
    );
  }
  return `${base} (Docker: use host.docker.internal or the API service name, not 127.0.0.1, unless the API runs in the same container network.)`;
}

function forwardRequestHeaders(req: NextRequest): Headers {
  const h = new Headers();
  req.headers.forEach((value, key) => {
    if (HOP_REQUEST.has(key.toLowerCase())) return;
    h.set(key, value);
  });
  return h;
}

function forwardResponseHeaders(up: Response): Headers {
  const h = new Headers();
  up.headers.forEach((value, key) => {
    if (["transfer-encoding", "connection"].includes(key.toLowerCase())) return;
    h.set(key, value);
  });
  return h;
}

async function proxy(req: NextRequest, path: string[]) {
  const base = getUpstreamApiOrigin();
  const target = buildTargetUrl(path, req.nextUrl.search);
  if (!target) {
    return NextResponse.json(
      {
        statusCode: 503,
        message:
          "Web API proxy is not configured. Set API_PROXY_TARGET or NEXT_PUBLIC_API_URL to your Nest API origin (e.g. https://api.example.com). Without this, /api/upstream requests cannot reach the API.",
        error: "Service Unavailable",
      },
      { status: 503 },
    );
  }

  const method = req.method.toUpperCase();
  const body =
    method === "GET" || method === "HEAD" ? undefined : await req.arrayBuffer();

  let upstream: Response;
  try {
    upstream = await fetchUpstream(target, {
      method,
      headers: forwardRequestHeaders(req),
      body: body && body.byteLength > 0 ? body : undefined,
      signal: AbortSignal.timeout(120_000),
    });
  } catch (e) {
    const msg = describeFetchFailure(e);
    const origin = base ?? "(unknown)";
    return NextResponse.json(
      {
        statusCode: 502,
        message: proxyUnreachableMessage(origin, msg),
        error: "Bad Gateway",
      },
      { status: 502 },
    );
  }

  return new NextResponse(upstream.body, {
    status: upstream.status,
    statusText: upstream.statusText,
    headers: forwardResponseHeaders(upstream),
  });
}

type RouteCtx = { params: Promise<{ path: string[] }> };

export async function GET(req: NextRequest, ctx: RouteCtx) {
  const { path } = await ctx.params;
  return proxy(req, path ?? []);
}

export async function POST(req: NextRequest, ctx: RouteCtx) {
  const { path } = await ctx.params;
  return proxy(req, path ?? []);
}

export async function PUT(req: NextRequest, ctx: RouteCtx) {
  const { path } = await ctx.params;
  return proxy(req, path ?? []);
}

export async function PATCH(req: NextRequest, ctx: RouteCtx) {
  const { path } = await ctx.params;
  return proxy(req, path ?? []);
}

export async function DELETE(req: NextRequest, ctx: RouteCtx) {
  const { path } = await ctx.params;
  return proxy(req, path ?? []);
}

export async function OPTIONS(req: NextRequest, ctx: RouteCtx) {
  const { path } = await ctx.params;
  const base = getUpstreamApiOrigin();
  const target = buildTargetUrl(path, req.nextUrl.search);
  if (!target) {
    return new NextResponse(null, { status: 204 });
  }
  try {
    const upstream = await fetchUpstream(target, {
      method: "OPTIONS",
      headers: forwardRequestHeaders(req),
      signal: AbortSignal.timeout(30_000),
    });
    return new NextResponse(null, {
      status: upstream.status,
      headers: forwardResponseHeaders(upstream),
    });
  } catch (e) {
    const msg = describeFetchFailure(e);
    const origin = base ?? "(unknown)";
    return NextResponse.json(
      {
        statusCode: 502,
        message: proxyUnreachableMessage(origin, msg),
        error: "Bad Gateway",
      },
      { status: 502 },
    );
  }
}
