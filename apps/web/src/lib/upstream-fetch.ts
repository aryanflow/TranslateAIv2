/** Client-side fetch to `/api/upstream/*` with brief retries (cold API / Turbo startup races). */

const RETRY_DELAYS_MS = [0, 400, 1200, 2500, 5000];

function isRetryableStatus(status: number): boolean {
  return status === 502 || status === 503 || status === 504;
}

function isRetryableError(e: unknown): boolean {
  if (!(e instanceof TypeError)) return false;
  return /failed to fetch|network|load failed/i.test(e.message);
}

export async function upstreamFetch(
  input: string,
  init?: RequestInit,
): Promise<Response> {
  let lastResponse: Response | null = null;
  let lastError: unknown;

  for (let i = 0; i < RETRY_DELAYS_MS.length; i++) {
    const delay = RETRY_DELAYS_MS[i]!;
    if (delay > 0) {
      await new Promise<void>((resolve) => globalThis.setTimeout(resolve, delay));
    }
    try {
      const res = await fetch(input, init);
      lastResponse = res;
      const lastAttempt = i === RETRY_DELAYS_MS.length - 1;
      if (!isRetryableStatus(res.status) || lastAttempt) return res;
    } catch (e) {
      lastError = e;
      const lastAttempt = i === RETRY_DELAYS_MS.length - 1;
      if (lastAttempt || !isRetryableError(e)) throw e;
    }
  }

  if (lastResponse) return lastResponse;
  throw lastError ?? new TypeError("Failed to fetch");
}
