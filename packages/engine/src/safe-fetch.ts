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
  /**
   * `false` returns a redirect response as it is, Location and all, instead of following it, so a
   * caller can pace and vet each hop itself. Omitted: redirects are followed (unchanged behaviour).
   */
  followRedirects?: boolean;
  /**
   * Called with each decoded body chunk's size as it arrives, including on a response that is then
   * cut off at `maxBytes` or by a deadline, so a caller can count what it received. Omitted: unchanged.
   */
  onBodyBytes?: (bytes: number) => void;
  /**
   * The body returned holds at most the first `keepBytes` decoded bytes, cut back to a whole UTF-8
   * character, and reading stops once more than that has arrived: the connection is closed, and
   * `truncated` is set on the result. A body that is gzip without a Content-Encoding is inflated only
   * as far as `keepBytes` too. Omitted: the whole body, up to `maxBytes` (unchanged behaviour).
   */
  keepBytes?: number;
  /** Test-only escape hatch: skip SSRF validation + IP pinning for loopback fixtures. */
  bypassSsrf?: boolean;
}

export interface SafeFetchResult {
  status: number;
  body: string;
  headers: http.IncomingHttpHeaders;
  finalUrl: string;
  /** Set only when `keepBytes` was passed: true when the body is its first `keepBytes`. */
  truncated?: boolean;
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
export async function safeFetch(
  url: string,
  opts: SafeFetchOptions = {},
): Promise<SafeFetchResult> {
  const maxBytes = opts.maxBytes ?? DEFAULT_MAX_BYTES;
  const maxRedirects = opts.maxRedirects ?? DEFAULT_MAX_REDIRECTS;
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const lookup = opts.bypassSsrf ? undefined : createSafeLookup(opts.resolver);
  const extraHeaders = normalizeHeaders(opts.headers);
  const deadlineAt =
    opts.totalDeadlineMs === undefined ? undefined : Date.now() + opts.totalDeadlineMs;

  let currentUrl = url;
  for (let hop = 0; hop <= maxRedirects; hop++) {
    // Checked before each hop as well as inside each request, so no hop starts after the deadline.
    // A DNS lookup already running is not interrupted; the system resolver's timeout bounds it.
    if (deadlineAt !== undefined && Date.now() >= deadlineAt) {
      throw new Error(`Total deadline exceeded: ${currentUrl}`);
    }
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
      onBodyBytes: opts.onBodyBytes,
      keepBytes: opts.keepBytes,
    });

    if (
      opts.followRedirects !== false &&
      REDIRECT_STATUSES.has(res.status) &&
      res.headers.location
    ) {
      const raw = Array.isArray(res.headers.location)
        ? res.headers.location[0]!
        : res.headers.location;
      currentUrl = new URL(raw, currentUrl).toString();
      continue;
    }
    return {
      status: res.status,
      body: res.body,
      headers: res.headers,
      finalUrl: currentUrl,
      ...(opts.keepBytes !== undefined && { truncated: res.truncated }),
    };
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
  onBodyBytes?: (bytes: number) => void;
  keepBytes?: number;
}

function requestOnce(
  url: string,
  {
    lookup,
    timeoutMs,
    maxBytes,
    userAgent,
    extraHeaders,
    deadlineAt,
    onBodyBytes,
    keepBytes = Infinity,
  }: RequestOnceOptions,
): Promise<{
  status: number;
  body: string;
  headers: http.IncomingHttpHeaders;
  truncated: boolean;
}> {
  return new Promise((resolve, reject) => {
    let deadlineTimer: NodeJS.Timeout | undefined;
    const settleResolve = (v: {
      status: number;
      body: string;
      headers: http.IncomingHttpHeaders;
      truncated: boolean;
    }) => {
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
        const body = new Kept(keepBytes);
        let done = false;
        const finish = (buf: Buffer, truncated: boolean) => {
          settleResolve({
            status: res.statusCode ?? 0,
            body: buf.toString('utf8'),
            headers: res.headers,
            truncated,
          });
        };
        stream.on('data', (chunk: Buffer) => {
          if (done) return;
          received += chunk.length;
          onBodyBytes?.(chunk.length);
          if (body.add(chunk)) {
            // All that may be kept is kept: stop reading.
            done = true;
            finish(body.buffer(), true);
            stream.destroy();
            req.destroy();
            return;
          }
          if (received > maxBytes) {
            done = true;
            stream.destroy();
            req.destroy();
            settleReject(new Error(`Response body exceeded ${maxBytes} bytes`));
          }
        });
        stream.on('end', () => {
          if (done) return;
          done = true;
          const buf = body.buffer();
          // Content-level gzip (e.g. sitemap.xml.gz served as application/gzip with
          // no content-encoding header): detect the magic bytes and decompress once,
          // capping the decompressed size to defend against gzip bombs.
          if (buf.length >= 2 && buf[0] === GZIP_MAGIC[0] && buf[1] === GZIP_MAGIC[1]) {
            if (keepBytes === Infinity) {
              try {
                return finish(gunzipSync(buf, { maxOutputLength: maxBytes }), false);
              } catch {
                return finish(buf, false); // leave as-is if it isn't actually valid gzip
              }
            }
            gunzipKept(buf, keepBytes).then(
              (kept) => finish(kept.buf, kept.cut),
              () => finish(buf, false),
            );
            return;
          }
          finish(buf, false);
        });
        stream.on('error', settleReject);
      },
    );
    if (deadlineAt !== undefined) {
      deadlineTimer = setTimeout(
        () => {
          // Reject first: once the response has started, destroying the request does not
          // reliably surface an error on the response stream.
          settleReject(new Error(`Total deadline exceeded: ${url}`));
          req.destroy();
        },
        Math.max(0, deadlineAt - Date.now()),
      );
    }
    req.on('error', settleReject);
    req.on('timeout', () =>
      req.destroy(new Error(`Request timed out after ${timeoutMs}ms: ${url}`)),
    );
    req.end();
  });
}

/** The first `keepBytes` of a body, kept as it arrives, and whether more than that arrived. */
class Kept {
  private readonly chunks: Buffer[] = [];
  private kept = 0;
  private cut = false;

  constructor(private readonly keepBytes: number) {}

  /** Takes the next chunk; true once more than keepBytes have arrived. */
  add(chunk: Buffer): boolean {
    const { kept, keepBytes } = this;
    if (kept < keepBytes) {
      const part = kept + chunk.length > keepBytes ? chunk.subarray(0, keepBytes - kept) : chunk;
      this.chunks.push(part);
      this.kept += part.length;
    }
    if (kept + chunk.length > keepBytes) this.cut = true;
    return this.cut;
  }

  /** What was kept, as one buffer: when more arrived, cut back to a whole UTF-8 character. */
  buffer(): Buffer {
    let buf = Buffer.concat(this.chunks);
    const cut = this.cut;
    // A cut body ends on a whole UTF-8 character: drop a trailing partial one.
    if (cut) buf = buf.subarray(0, utf8Boundary(buf));
    return buf;
  }
}

/** A gzip body's content up to `keepBytes`, inflated no further, and whether there was more. */
function gunzipKept(input: Buffer, keepBytes: number): Promise<{ buf: Buffer; cut: boolean }> {
  return new Promise((resolve, reject) => {
    const out = new Kept(keepBytes);
    const inflate = createGunzip();
    let settled = false;
    inflate.on('data', (chunk: Buffer) => {
      if (settled || !out.add(chunk)) return;
      settled = true;
      inflate.destroy();
      resolve({ buf: out.buffer(), cut: true });
    });
    inflate.on('end', () => {
      if (settled) return;
      settled = true;
      resolve({ buf: out.buffer(), cut: false });
    });
    inflate.on('error', (e) => {
      if (settled) return;
      settled = true;
      reject(e);
    });
    inflate.end(input);
  });
}

/** The length of `buf` without a UTF-8 character its end cuts short. */
function utf8Boundary(buf: Buffer): number {
  let start = buf.length;
  // Back over continuation bytes (10xxxxxx) to the byte that starts the last character.
  while (start > 0 && start > buf.length - 4 && (buf[start - 1]! & 0xc0) === 0x80) start--;
  if (start === 0) return buf.length;
  const lead = buf[start - 1]!;
  const width = lead >= 0xf0 ? 4 : lead >= 0xe0 ? 3 : lead >= 0xc0 ? 2 : 1;
  return buf.length - (start - 1) < width ? start - 1 : buf.length;
}
