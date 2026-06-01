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
  /** Test-only escape hatch: skip SSRF validation + IP pinning for loopback fixtures. */
  bypassSsrf?: boolean;
}

export interface SafeFetchResult {
  status: number;
  body: string;
  headers: http.IncomingHttpHeaders;
  finalUrl: string;
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

  let currentUrl = url;
  for (let hop = 0; hop <= maxRedirects; hop++) {
    // Validate each hop. This catches raw IP-literal targets, which Node's socket
    // layer would NOT route through our pinning `lookup`.
    if (!opts.bypassSsrf) await validateUrlOrThrow(currentUrl, { resolver: opts.resolver });

    const res = await requestOnce(currentUrl, { lookup, timeoutMs, maxBytes, userAgent: opts.userAgent });

    if (REDIRECT_STATUSES.has(res.status) && res.headers.location) {
      const raw = Array.isArray(res.headers.location) ? res.headers.location[0]! : res.headers.location;
      currentUrl = new URL(raw, currentUrl).toString();
      continue;
    }
    return { status: res.status, body: res.body, headers: res.headers, finalUrl: currentUrl };
  }
  throw new Error(`Too many redirects (> ${maxRedirects}) starting from ${url}`);
}

interface RequestOnceOptions {
  lookup?: ReturnType<typeof createSafeLookup>;
  timeoutMs: number;
  maxBytes: number;
  userAgent?: string;
}

function requestOnce(
  url: string,
  { lookup, timeoutMs, maxBytes, userAgent }: RequestOnceOptions,
): Promise<{ status: number; body: string; headers: http.IncomingHttpHeaders }> {
  return new Promise((resolve, reject) => {
    let target: URL;
    try {
      target = new URL(url);
    } catch {
      reject(new Error(`Invalid URL: ${url}`));
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
            reject(new Error(`Response body exceeded ${maxBytes} bytes`));
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
          resolve({ status: res.statusCode ?? 0, body: buf.toString('utf8'), headers: res.headers });
        });
        stream.on('error', reject);
      },
    );
    req.on('error', reject);
    req.on('timeout', () => req.destroy(new Error(`Request timed out after ${timeoutMs}ms: ${url}`)));
    req.end();
  });
}
