import { safeFetch, type SafeFetchOptions } from '../../../packages/engine/src/safe-fetch.js';
import { identityHeaders, type IdentityName } from './identities.js';
import type { ResponseShape } from './classify.js';

/**
 * Every request to a target goes through the engine's safeFetch (and so through ssrf-guard): there is no
 * second HTTP client here. `bypassSsrf` and `resolver` exist on SafeFetchOptions for tests; they are only
 * ever set by test and rehearsal code that builds a Fetcher directly, never from configuration.
 */

export type FetchErrorClass = 'ssrf_refused' | 'too_large' | 'timeout' | 'redirects' | 'network';

export function classifyFetchError(message: string): FetchErrorClass {
  if (/private or reserved|Disallowed URL scheme|Credentials in URL|DNS resolution failed|Invalid URL|Blocked connection/i.test(message)) {
    return 'ssrf_refused';
  }
  if (/exceeded \d+ bytes/i.test(message)) return 'too_large';
  if (/timed out|Total deadline/i.test(message)) return 'timeout';
  if (/Too many redirects/i.test(message)) return 'redirects';
  return 'network';
}

export interface FetchRecord {
  identity: IdentityName | 'robots';
  host: string;
  status: number;
  ms: number;
  bytes: number;
  hops: number;
  words: number;
  errorClass?: FetchErrorClass;
  /** Internal: used for classification, never written to a results file. */
  shape: ResponseShape;
  body: string;
}

export type Fetcher = (url: string, identity: IdentityName) => Promise<FetchRecord>;

export interface FetcherOptions {
  from?: string;
  timeoutMs?: number;
  totalDeadlineMs?: number;
  maxBytes?: number;
  /** Test and rehearsal only. */
  safeFetchOverrides?: Pick<SafeFetchOptions, 'bypassSsrf' | 'resolver'>;
}

export function countWords(html: string): number {
  const text = html
    .replace(/<(script|style|svg|noscript)[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<[^>]*>/g, ' ');
  const m = text.match(/\S+/g);
  return m ? m.length : 0;
}

const hostOf = (u: string): string => {
  try {
    return new URL(u).hostname.toLowerCase();
  } catch {
    return '';
  }
};

export function createFetcher(opts: FetcherOptions = {}): Fetcher {
  return async (url, identity) => {
    const t0 = Date.now();
    const host = hostOf(url);
    try {
      const r = await safeFetch(url, {
        headers: identityHeaders(identity, opts.from),
        timeoutMs: opts.timeoutMs ?? 10_000,
        totalDeadlineMs: opts.totalDeadlineMs ?? 30_000,
        maxBytes: opts.maxBytes,
        ...opts.safeFetchOverrides,
      });
      const isHtml = String(r.headers['content-type'] ?? '').toLowerCase().includes('html') || r.status !== 200;
      const words = r.status === 200 && isHtml ? countWords(r.body) : 0;
      return {
        identity,
        host,
        status: r.status,
        ms: Date.now() - t0,
        bytes: Buffer.byteLength(r.body),
        hops: r.hops.length,
        words,
        body: r.body,
        shape: {
          status: r.status,
          headers: r.headers,
          bodyHead: r.body.slice(0, 4096),
          words,
          originHost: host,
          finalHost: hostOf(r.finalUrl),
        },
      };
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      return {
        identity,
        host,
        status: 0,
        ms: Date.now() - t0,
        bytes: 0,
        hops: 0,
        words: 0,
        body: '',
        errorClass: classifyFetchError(msg),
        shape: { status: 0, headers: {}, bodyHead: '', words: 0, originHost: host, finalHost: host },
      };
    }
  };
}
