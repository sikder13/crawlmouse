import type { IncomingHttpHeaders } from 'node:http';
import { safeFetch, type DnsResolver } from '@crawlmouse/engine/worker';
import type { Clock } from '../clock.js';
import type { Identity } from '../identities.js';

/**
 * One request. Every request the worker makes to a target goes through the engine's safeFetch, and so
 * through its SSRF guard: scheme and credential checks, private-range refusal, the connection pinned to
 * the address that was checked, and size and time caps. There is no second HTTP client in this package.
 *
 * Redirects are not followed here. A redirect comes back as it is, and `batch/polite-fetch.ts` decides
 * whether to request its Location, as a separate paced request that safeFetch checks again.
 */

export type FetchError = 'ssrf_refused' | 'dns_failed' | 'too_large' | 'timeout' | 'network';

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
  return 'network';
}

export interface Hop {
  from: string;
  status: number;
  location: string;
}

/** Why a redirect chain ended without requesting its last Location. */
export type RedirectStop =
  | 'off_site'
  | 'not_web'
  | 'robots_disallowed'
  | 'robots_unreadable'
  | 'origin_limit'
  | 'batch_stopped'
  | 'too_many';

export interface FetchOutcome {
  /** The URL first requested. */
  url: string;
  identity: Identity;
  startedAt: number;
  ms: number;
  /** Of the last response received; null when none arrived. */
  status: number | null;
  /** The last URL requested, or the Location a chain stopped at; null when no response arrived. */
  finalUrl: string | null;
  headers: IncomingHttpHeaders;
  /** Redirects, in order; each one's Location was requested unless `redirectStop` says otherwise. */
  hops: Hop[];
  redirectStop: RedirectStop | null;
  /** The decoded body; empty when no response arrived. */
  body: string;
  /** Decoded body bytes received, including those of a response that was then cut off. */
  bytes: number;
  /** The decoded body cap the request was made with; past it the request ends `too_large`. */
  maxBytes: number;
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
    // Counted as it arrives, so a body cut off at its limit or deadline is still charged to the batch.
    let received = 0;
    const maxBytes = Math.min(MAX_BODY_BYTES, limits.maxBytes);
    try {
      const r = await safeFetch(url, {
        onBodyBytes: (n) => {
          received += n;
        },
        headers,
        maxBytes,
        totalDeadlineMs: Math.min(MAX_REQUEST_MS, limits.deadlineMs),
        timeoutMs: IDLE_TIMEOUT_MS,
        followRedirects: false,
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
        hops: [],
        redirectStop: null,
        body: r.body,
        bytes: Buffer.byteLength(r.body),
        maxBytes,
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
        redirectStop: null,
        body: '',
        bytes: received,
        maxBytes,
        error: classifyFetchError(e instanceof Error ? e.message : String(e)),
      };
    }
  };
}
