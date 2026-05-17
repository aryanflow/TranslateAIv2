import createClient from "openapi-fetch";
import type { paths } from "./v1";

function resolveApiBaseUrl(): string {
  if (typeof window !== "undefined") {
    return `${window.location.origin}/api/upstream`;
  }
  return (
    process.env.API_PROXY_TARGET ??
    process.env.NEXT_PUBLIC_API_URL ??
    "http://127.0.0.1:3001"
  );
}

export const api = createClient<paths>({ baseUrl: resolveApiBaseUrl() });
