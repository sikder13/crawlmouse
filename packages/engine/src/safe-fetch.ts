import http from 'node:http';
import https from 'node:https';
import { gunzipSync } from 'node:zlib';
import { createGunzip, createInflate, createBrotliDecompress } from 'node:zlib';
import type { Readable } from 'node:stream';
import { validateUrlOrThrow, createSafeLookup, type DnsResolver } from './ssrf-guard.js';

const DEFAULT_MAX_BYTES = 10 * 1024 * 1024; // 10 MB decompressed
const DEFAULT_MAX_REDIRECTS = 5;
const DEFAULT_TIMEOUT_MS = 10_000;
const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);
const GZIP_MAGIC = [0x1f, 0x8b];

export interface SafeFetchOptions {
  /** Injectable DNS resolver (tests). */
  resolver?: DnsResolver;
  /** Cap on the decompressed body size; oversize responses are aborted. */
  maxBytes?: number;
  maxRedirects?: number;
  timeoutMs?: number;
  userAgent?: string;
  /**
   * Extra request headers (UA, Accept, Accept-Encoding, From, ...). Merged over the two built-in
   * defaults; a `user-agent` here wins over `userAgent`. Framing, routing and credential headers
   * are refused (see FORBIDDEN_HEADERS). Omitted: the request is byte-for-byte what it was.
   */
  headers?: Record<string, string>;
  /**
   * Wall-clock bound for the whole call across every redirect hop. `timeoutMs` is socket idle time,
   * so a slow-drip response is not bounded by it. Omitted: no total bound (unchanged behaviour).
   */
  totalDeadlineMs?: number;
  /** Test-only escape hatch: skip SSRF validation + IP pinning for loopback fixtures. */
  bypassSsrf?: boolean;
}

export interface SafeFetchHop {
  from: string;
  status: number;
  location: string;
}

export interface SafeFetchResult {
  status: number;
  body: string;
  headers: http.IncomingHttpHeaders;
  finalUrl: string;
  /** One entry per redirect followed, in order; empty when the first response was final. */
  hops: SafeFetchHop[];
}

const FORBIDDEN_HEADERS = new Set([
  'host',
  'authorization',
  'proxy-authorization',
  'cookie',
  'content-length',
  'transfer-encoding',
  'connection',
]);

function normalizeHeaders(headers: Record<string, string> | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [name, value] of Object.entries(headers ?? {})) {
    const key = name.toLowerCase();
    if (FORBIDDEN_HEADERS.has(key)) throw new Error(`Header ${key} is not allowed`);
    out[key] = value;
  }
  return out;
}

/**
 * Fetches a URL with SSRF protection that the engine's raw fetches previously
 * lacked: every URL (and every redirect hop) is validated, the connection is
 * pinned to a validated IP (closing the DNS-rebinding window), redirects are
 * followed manually so each Location is re-validated, the body is size-capped,
 * and gzip/deflate/br — including gzipped sitemap *files* — are decompressed.
 */
export async function safeFetch(url: string, opts: SafeFetchOptions = {}): Promise<SafeFetchResult> {
  const maxBytes = opts.maxBytes ?? DEFAULT_MAX_BYTES;
  const maxRedirects = opts.maxRedirects ?? DEFAULT_MAX_REDIRECTS;
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const lookup = opts.bypassSsrf ? undefined : createSafeLookup(opts.resolver);
  const extraHeaders = normalizeHeaders(opts.headers);
  const deadlineAt = opts.totalDeadlineMs === undefined ? undefined : Date.now() + opts.totalDeadlineMs;
  const hops: SafeFetchHop[] = [];

  let currentUrl = url;
  for (let hop = 0; hop <= maxRedirects; hop++) {
    // Validate each hop. This catches raw IP-literal targets, which Node's socket
    // layer would NOT route through our pinning `lookup`.
    if (!opts.bypassSsrf) await validateUrlOrThrow(currentUrl, { resolver: opts.resolver });

    const res = await requestOnce(currentUrl, {
      lookup,
      timeoutMs,
      maxBytes,
      userAgent: opts.userAgent,
      extraHeaders,
      deadlineAt,
    });

    if (REDIRECT_STATUSES.has(res.status) && res.headers.location) {
      const raw = Array.isArray(res.headers.location) ? res.headers.location[0]! : res.headers.location;
      const next = new URL(raw, currentUrl).toString();
      hops.push({ from: currentUrl, status: res.status, location: next });
      currentUrl = next;
      continue;
    }
    return { status: res.status, body: res.body, headers: res.headers, finalUrl: currentUrl, hops };
  }
  throw new Error(`Too many redirects (> ${maxRedirects}) starting from ${url}`);
}

interface RequestOnceOptions {
  lookup?: ReturnType<typeof createSafeLookup>;
  timeoutMs: number;
  maxBytes: number;
  userAgent?: string;
  extraHeaders: Record<string, string>;
  deadlineAt?: number;
}

function requestOnce(
  url: string,
  { lookup, timeoutMs, maxBytes, userAgent, extraHeaders, deadlineAt }: RequestOnceOptions,
): Promise<{ status: number; body: string; headers: http.IncomingHttpHeaders }> {
  return new Promise((resolve, reject) => {
    let deadlineTimer: NodeJS.Timeout | undefined;
    const settleResolve = (v: { status: number; body: string; headers: http.IncomingHttpHeaders }) => {
      if (deadlineTimer) clearTimeout(deadlineTimer);
      resolve(v);
    };
    const settleReject = (e: unknown) => {
      if (deadlineTimer) clearTimeout(deadlineTimer);
      reject(e);
    };
    let target: URL;
    try {
      target = new URL(url);
    } catch {
      settleReject(new Error(`Invalid URL: ${url}`));
      return;
    }
    const mod = target.protocol === 'https:' ? https : http;
    const req = mod.request(
      target,
      {
        method: 'GET',
        lookup,
        timeout: timeoutMs,
        headers: {
          'user-agent': userAgent ?? 'CrawlmouseBot/1.0 (+https://crawlmouse.com/bot)',
          'accept-encoding': 'gzip, deflate, br',
          ...extraHeaders,
        },
      },
      (res) => {
        const encoding = String(res.headers['content-encoding'] ?? '').toLowerCase();
        let stream: Readable = res;
        if (encoding === 'gzip') stream = res.pipe(createGunzip());
        else if (encoding === 'deflate') stream = res.pipe(createInflate());
        else if (encoding === 'br') stream = res.pipe(createBrotliDecompress());

        let received = 0;
        const chunks: Buffer[] = [];
        stream.on('data', (chunk: Buffer) => {
          received += chunk.length;
          if (received > maxBytes) {
            stream.destroy();
            req.destroy();
            settleReject(new Error(`Response body exceeded ${maxBytes} bytes`));
            return;
          }
          chunks.push(chunk);
        });
        stream.on('end', () => {
          let buf = Buffer.concat(chunks);
          // Content-level gzip (e.g. sitemap.xml.gz served as application/gzip with
          // no content-encoding header): detect the magic bytes and decompress once,
          // capping the decompressed size to defend against gzip bombs.
          if (buf.length >= 2 && buf[0] === GZIP_MAGIC[0] && buf[1] === GZIP_MAGIC[1]) {
            try {
              buf = gunzipSync(buf, { maxOutputLength: maxBytes });
            } catch {
              /* leave as-is if it isn't actually valid gzip */
            }
          }
          settleResolve({ status: res.statusCode ?? 0, body: buf.toString('utf8'), headers: res.headers });
        });
        stream.on('error', settleReject);
      },
    );
    if (deadlineAt !== undefined) {
      deadlineTimer = setTimeout(() => {
        // Reject first: once the response has started, destroying the request does not
        // reliably surface an error on the response stream.
        settleReject(new Error(`Total deadline exceeded: ${url}`));
        req.destroy();
      }, Math.max(0, deadlineAt - Date.now()));
    }
    req.on('error', settleReject);
    req.on('timeout', () => req.destroy(new Error(`Request timed out after ${timeoutMs}ms: ${url}`)));
    req.end();
  });
}
