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

function buildTargetUrl(path: string[], search: string): string | null {
  const base = getUpstreamApiOrigin();
  if (!base) return null;
  const suffix = path.length ? `/${path.join("/")}` : "";
  return `${base}${suffix}${search}`;
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
    upstream = await fetch(target, {
      method,
      headers: forwardRequestHeaders(req),
      body: body && body.byteLength > 0 ? body : undefined,
      signal: AbortSignal.timeout(120_000),
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    const origin = base ?? "(unknown)";
    return NextResponse.json(
      {
        statusCode: 502,
        message: `Next.js proxy could not reach the API (${origin}): ${msg}. Start the Nest API, check API_PROXY_TARGET / NEXT_PUBLIC_API_URL, and ensure this Next server can open a TCP connection (Docker: use host.docker.internal or the service name, not 127.0.0.1, unless API runs on the same host).`,
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
    const upstream = await fetch(target, {
      method: "OPTIONS",
      headers: forwardRequestHeaders(req),
      signal: AbortSignal.timeout(30_000),
    });
    return new NextResponse(null, {
      status: upstream.status,
      headers: forwardResponseHeaders(upstream),
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    const origin = base ?? "(unknown)";
    return NextResponse.json(
      {
        statusCode: 502,
        message: `Next.js proxy could not reach the API (${origin}): ${msg}`,
        error: "Bad Gateway",
      },
      { status: 502 },
    );
  }
}
