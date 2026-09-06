import { safeFetch, validateUrlOrThrow } from '@crawlmouse/engine';

export const USER_AGENT = 'CrawlmouseResearch/1.0 (+https://crawlmouse.com/bot)';
export const TIMEOUT_MS = 10_000;
export const CONCURRENCY = 10;
export const MAX_REDIRECTS = 5;

/** Hard fetch ceiling for robots.txt. Beyond this the capture is an error, not a truncation. */
export const ROBOTS_FETCH_MAX_BYTES = 2 * 1024 * 1024;
/** What we STORE. A longer body is kept to this length and flagged `truncated`. */
export const ROBOTS_STORE_MAX_BYTES = 512 * 1024;

export interface TextResult {
  status: number;
  finalUrl: string;
  body: string;
}

export interface HeaderResult {
  status: number;
  finalUrl: string;
  server: string | null;
  cfRay: boolean;
}

/**
 * GET a text resource through the engine's SSRF-guarded fetcher: every redirect hop is revalidated
 * and the connection is pinned to a validated IP. Used for robots.txt, the only body this tool reads.
 */
export async function fetchText(url: string, maxBytes: number): Promise<TextResult> {
  const res = await safeFetch(url, { timeoutMs: TIMEOUT_MS, userAgent: USER_AGENT, maxBytes });
  return { status: res.status, finalUrl: res.finalUrl, body: res.body };
}

const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);

/**
 * Response headers only, never page content: HEAD first, falling back to GET with the body stream
 * cancelled before any of it is read. Redirects are followed by hand so each hop can be
 * SSRF-validated, and so the headers reported are the FINAL response's — which is the one that says
 * whether the site the crawler ends up at is behind Cloudflare.
 */
export async function fetchHeaders(url: string): Promise<HeaderResult> {
  let current = url;
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    await validateUrlOrThrow(current);
    let res = await request(current, 'HEAD');
    // Some origins answer HEAD with 405/501; retry those as GET, discarding the body unread.
    if (res.status === 405 || res.status === 501) res = await request(current, 'GET');

    const location = res.headers.get('location');
    if (REDIRECT_STATUSES.has(res.status) && location) {
      current = new URL(location, current).toString();
      continue;
    }
    return {
      status: res.status,
      finalUrl: current,
      server: res.headers.get('server'),
      cfRay: res.headers.has('cf-ray'),
    };
  }
  throw new Error(`Too many redirects (> ${MAX_REDIRECTS}) starting from ${url}`);
}

async function request(url: string, method: 'HEAD' | 'GET'): Promise<Response> {
  const res = await fetch(url, {
    method,
    redirect: 'manual',
    signal: AbortSignal.timeout(TIMEOUT_MS),
    headers: { 'user-agent': USER_AGENT, accept: '*/*' },
  });
  // Nothing downstream reads the body; cancelling releases the socket without buffering a page.
  await res.body?.cancel().catch(() => {});
  return res;
}

/**
 * One retry, and only for a thrown error — a DNS failure, refused connection, TLS error or timeout.
 * An HTTP response is a result whatever its status, so a 403 or a 500 is recorded, never retried.
 */
export async function withRetry<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch {
    return await fn();
  }
}

/** Runs `fn` over `items` with at most `limit` in flight. Results keep the input order. */
export async function pool<T, R>(
  items: readonly T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>,
  onProgress?: (done: number, total: number) => void,
): Promise<R[]> {
  const out = new Array<R>(items.length);
  let next = 0;
  let done = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    for (;;) {
      const i = next++;
      if (i >= items.length) return;
      out[i] = await fn(items[i]!, i);
      done += 1;
      onProgress?.(done, items.length);
    }
  });
  await Promise.all(workers);
  return out;
}

export function errorMessage(e: unknown): string {
  const raw = e instanceof Error ? e.message : String(e);
  return raw.length > 200 ? `${raw.slice(0, 200)}…` : raw;
}
