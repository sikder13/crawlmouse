/**
 * The Browser Run client: one call to the REST `/content` endpoint per side of a page, returning the
 * HTML the browser holds when the page settles. Nothing here touches the disk: the reply is read into
 * memory, bounded by MAX_REPLY_BYTES, and handed back.
 *
 * The two sides of a page are the same request but for two fields: the static side refuses the `script`
 * resource type and sends `setJavaScriptEnabled: false`. Both run in Browser Run, from the same network,
 * with the same user agent, viewport and wait. Refusing the resource type is documented to stop script
 * files from loading. A script written inline in the HTML is not a request, so only turning JavaScript
 * off can stop it running on the static side; Cloudflare documents that field for `/snapshot`, and
 * STATIC_JS_OFF_SHOWN_LIVE records whether live.test.ts has shown `/content` honours it.
 */
import {
  REJECTED_RESOURCE_TYPES,
  STATIC_REJECTED_RESOURCE_TYPES,
  URL_RULES,
  wirePattern,
} from './policy.js';

/**
 * What the Browser Run documentation said when this was built. The limits page was last updated
 * 2026-10-14; all of it was read on 2026-11-05. Cloudflare renamed the product from Browser Rendering on
 * 2026-04-15; the token variable keeps the old name.
 */
export const BROWSER_RUN = {
  read_on: '2026-11-05',
  limits_updated: '2026-10-14',
  endpoint: 'https://api.cloudflare.com/client/v4/accounts/{account_id}/browser-run/content',
  /** Workers Paid: Quick Actions requests per second, per account; over it, a 429. */
  requests_per_second: 30,
  /** A browser closes after this long without a command. */
  browser_timeout_s: 60,
  /** The longest `gotoOptions.timeout` the endpoint takes. */
  max_goto_timeout_s: 60,
  usd_per_browser_hour: 0.09,
  included_browser_hours_per_month: 10,
  /** The reply header carrying the browser time a request used, in milliseconds. */
  browser_ms_header: 'x-browser-ms-used',
} as const;

/**
 * The render identity's user agent: the string the v2 fixtures' `identity_role: render` rows record.
 * Browser Run's documentation (automatic request headers, read 2026-11-05) says it adds headers a
 * request cannot remove that name it as its own (`cf-brapi-request-id`, `Signature-agent`), so this
 * string does not hide what the request is.
 */
export const RENDER_USER_AGENT =
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';
export const RENDER_VIEWPORT = { width: 1366, height: 768 } as const;
/** No network connection for 500 ms, or the cap, whichever comes first. */
export const RENDER_WAIT_UNTIL = 'networkidle0';
export const RENDER_TIMEOUT_MS = 15_000;
/** The most reply bytes read; a longer reply is not a page this measures. */
export const MAX_REPLY_BYTES = 10 * 1024 * 1024;
/**
 * How long one request to Browser Run may stay open, body included: the wait cap and a margin for the
 * browser to start and the reply to arrive. Our choice, not a documented figure.
 */
export const REQUEST_TIMEOUT_MS = RENDER_TIMEOUT_MS + 30_000;

export const ENV = {
  account: 'CLOUDFLARE_ACCOUNT_ID',
  token: 'CLOUDFLARE_BROWSER_RENDERING_TOKEN',
} as const;

export type RenderSide = 'rendered' | 'static';

/**
 * The date the live inline-script probe showed `/content` honouring `setJavaScriptEnabled: false` on
 * the static side, or null while it has not. The spec renders this, so it says "unproven" until then.
 */
export const STATIC_JS_OFF_SHOWN_LIVE: string | null = null;

export function renderRequestBody(url: string, side: RenderSide) {
  return {
    url,
    ...(side === 'static' ? { setJavaScriptEnabled: false as const } : {}),
    userAgent: RENDER_USER_AGENT,
    viewport: { ...RENDER_VIEWPORT },
    gotoOptions: { waitUntil: RENDER_WAIT_UNTIL, timeout: RENDER_TIMEOUT_MS },
    rejectResourceTypes: [
      ...(side === 'static' ? STATIC_REJECTED_RESOURCE_TYPES : REJECTED_RESOURCE_TYPES),
    ] as string[],
    rejectRequestPattern: URL_RULES.map((r) => wirePattern(r.pattern)),
  };
}

export const RENDER_FAILURES = [
  'rate_limited',
  'timed_out',
  'page_failed',
  'api_error',
  'bad_reply',
  'oversize',
  'network_error',
] as const;
export type RenderFailure = (typeof RENDER_FAILURES)[number];

export type RenderReply =
  | { ok: true; html: string; browserMs: number }
  | { ok: false; reason: RenderFailure; retryAfterMs: number | null; browserMs: number };

export interface BrowserRunClient {
  content(url: string, side: RenderSide): Promise<RenderReply>;
}

type Fetch = (url: string, init: RequestInit) => Promise<Response>;

export interface ClientOptions {
  accountId: string;
  token: string;
  fetch?: Fetch;
  requestTimeoutMs?: number;
}

/**
 * The browser time a reply reports. When it reports none, or no reply came, the time is not known and
 * is counted at the request timeout, the longest the request could have been open; the browser's own
 * time could still be longer. The header is not read on a 429: it is counted at zero, on the assumption
 * that no browser time was used.
 */
function browserMsOf(res: Response, unknownMs: number): number {
  const raw = res.headers.get(BROWSER_RUN.browser_ms_header);
  const ms = raw === null ? NaN : Number(raw);
  return Number.isFinite(ms) && ms >= 0 ? ms : unknownMs;
}

/** Retry-After in seconds as milliseconds; null when absent, empty, an HTTP date or anything else. */
function retryAfterMsOf(res: Response): number | null {
  const raw = res.headers.get('retry-after')?.trim() ?? '';
  return /^[0-9]+$/.test(raw) ? Number(raw) * 1000 : null;
}

/** The reply body as text, or null once it passes MAX_REPLY_BYTES (the stream is then cancelled). */
async function boundedText(res: Response): Promise<string | null> {
  if (!res.body) return '';
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let bytes = 0;
  let text = '';
  for (;;) {
    const { done, value } = await reader.read();
    if (done) return text + decoder.decode();
    bytes += value.byteLength;
    if (bytes > MAX_REPLY_BYTES) {
      await reader.cancel();
      return null;
    }
    text += decoder.decode(value, { stream: true });
  }
}

function failure(reason: RenderFailure, browserMs: number, retryAfterMs: number | null = null) {
  return { ok: false as const, reason, retryAfterMs, browserMs };
}

export function browserRunClient(opts: ClientOptions): BrowserRunClient {
  const doFetch: Fetch = opts.fetch ?? ((url, init) => fetch(url, init));
  const endpoint = BROWSER_RUN.endpoint.replace('{account_id}', encodeURIComponent(opts.accountId));
  const timeoutMs = opts.requestTimeoutMs ?? REQUEST_TIMEOUT_MS;
  return {
    async content(url, side) {
      const signal = AbortSignal.timeout(timeoutMs);
      const lost = () => failure(signal.aborted ? 'timed_out' : 'network_error', timeoutMs);
      let res: Response;
      try {
        res = await doFetch(endpoint, {
          method: 'POST',
          headers: { authorization: `Bearer ${opts.token}`, 'content-type': 'application/json' },
          body: JSON.stringify(renderRequestBody(url, side)),
          signal,
        });
      } catch {
        return lost();
      }
      if (res.status === 429) {
        await res.body?.cancel().catch(() => {});
        return failure('rate_limited', 0, retryAfterMsOf(res));
      }
      const browserMs = browserMsOf(res, timeoutMs);
      if (!res.ok) {
        await res.body?.cancel().catch(() => {});
        return failure(res.status === 422 ? 'page_failed' : 'api_error', browserMs);
      }
      let text: string | null;
      try {
        text = await boundedText(res);
      } catch {
        return { ...lost(), browserMs };
      }
      if (text === null) return failure('oversize', browserMs);
      let parsed: unknown;
      try {
        parsed = JSON.parse(text);
      } catch {
        return failure('bad_reply', browserMs);
      }
      const envelope = parsed as { success?: unknown; result?: unknown };
      if (envelope?.success !== true || typeof envelope.result !== 'string') {
        return failure('bad_reply', browserMs);
      }
      return { ok: true, html: envelope.result, browserMs };
    },
  };
}

/** A client when the environment holds both the account and the token; otherwise none. */
export function clientFromEnv(
  env: Record<string, string | undefined>,
  fetchImpl?: Fetch,
): BrowserRunClient | null {
  const accountId = env[ENV.account]?.trim();
  const token = env[ENV.token]?.trim();
  if (!accountId || !token) return null;
  return browserRunClient({ accountId, token, fetch: fetchImpl });
}
