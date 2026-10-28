import type { IncomingHttpHeaders } from 'node:http';
import { safeFetch, type DnsResolver, type SafeFetchHop } from '@crawlmouse/engine/worker';
import type { Clock } from '../clock.js';
import type { Identity } from '../identities.js';

/**
 * Every request the worker makes to a target goes through the engine's safeFetch, and so through its
 * SSRF guard: scheme and credential checks, private-range refusal on every redirect hop, the
 * connection pinned to the address that was checked, and size and time caps. There is no second HTTP
 * client in this package.
 */

export type FetchError =
  | 'ssrf_refused'
  | 'dns_failed'
  | 'too_large'
  | 'timeout'
  | 'redirect_limit'
  | 'network';

/** Mapped from safeFetch's messages; fetcher.test.ts provokes each one from the real safeFetch. */
export function classifyFetchError(message: string): FetchError {
  if (
    /private or reserved|Disallowed URL scheme|Credentials in URL|Blocked connection/i.test(message)
  ) {
    return 'ssrf_refused';
  }
  if (/DNS resolution failed/i.test(message)) return 'dns_failed';
  if (/exceeded \d+ bytes/i.test(message)) return 'too_large';
  if (/timed out|Total deadline exceeded/i.test(message)) return 'timeout';
  if (/Too many redirects/i.test(message)) return 'redirect_limit';
  return 'network';
}

export interface FetchOutcome {
  url: string;
  identity: Identity;
  startedAt: number;
  ms: number;
  /** Null when no response arrived. */
  status: number | null;
  finalUrl: string | null;
  headers: IncomingHttpHeaders;
  hops: SafeFetchHop[];
  /** The decoded body; empty when no response arrived. */
  body: string;
  bytes: number;
  error: FetchError | null;
}

export interface FetchLimits {
  /** Decoded body cap for this request. */
  maxBytes: number;
  /** Wall-clock cap for this request across its redirects. */
  deadlineMs: number;
}

export type Fetcher = (
  url: string,
  identity: Identity,
  limits: FetchLimits,
) => Promise<FetchOutcome>;

/** Per-request ceilings, whatever the batch budget leaves. */
export const MAX_BODY_BYTES = 10 * 1024 * 1024;
export const MAX_REQUEST_MS = 30_000;
export const IDLE_TIMEOUT_MS = 10_000;
export const MAX_REDIRECTS = 5;

/**
 * Loopback fixture servers are unreachable through the guard, so tests pass this. The worker's own
 * entry point never does: server.test.ts checks main.ts and config.ts for it.
 */
export interface TestTransport {
  bypassSsrf?: boolean;
  resolver?: DnsResolver;
}

export function createFetcher(clock: Clock, testTransport?: TestTransport): Fetcher {
  return async (url, identity, limits) => {
    const startedAt = clock.now();
    const headers = Object.fromEntries(identity.headers.map(([n, v]) => [n.toLowerCase(), v]));
    try {
      const r = await safeFetch(url, {
        headers,
        maxBytes: Math.min(MAX_BODY_BYTES, limits.maxBytes),
        totalDeadlineMs: Math.min(MAX_REQUEST_MS, limits.deadlineMs),
        timeoutMs: IDLE_TIMEOUT_MS,
        maxRedirects: MAX_REDIRECTS,
        ...testTransport,
      });
      return {
        url,
        identity,
        startedAt,
        ms: clock.now() - startedAt,
        status: r.status,
        finalUrl: r.finalUrl,
        headers: r.headers,
        hops: r.hops,
        body: r.body,
        bytes: Buffer.byteLength(r.body),
        error: null,
      };
    } catch (e) {
      return {
        url,
        identity,
        startedAt,
        ms: clock.now() - startedAt,
        status: null,
        finalUrl: null,
        headers: {},
        hops: [],
        body: '',
        bytes: 0,
        error: classifyFetchError(e instanceof Error ? e.message : String(e)),
      };
    }
  };
}
