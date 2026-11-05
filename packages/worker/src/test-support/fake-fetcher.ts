import type { IncomingHttpHeaders } from 'node:http';
import type { Clock } from '../clock.js';
import type { FetchLimits, FetchOutcome, Fetcher } from '../fetch/fetcher.js';
import type { Identity } from '../identities.js';
import { outcome } from './outcome.js';

export interface FakeResponse {
  status?: number;
  headers?: IncomingHttpHeaders;
  body?: string;
  error?: FetchOutcome['error'];
}

export interface FakeFetcher extends Fetcher {
  calls: Array<{ url: string; identity: Identity; at: number; limits: FetchLimits }>;
}

/** A Fetcher that answers from a function, records each call, and never touches the network. */
export function fakeFetcher(
  clock: Clock,
  respond: (url: string, identity: Identity) => FakeResponse,
): FakeFetcher {
  const calls: FakeFetcher['calls'] = [];
  const f = (async (url: string, identity: Identity, limits: FetchLimits) => {
    calls.push({ url, identity, at: clock.now(), limits });
    const r = respond(url, identity);
    // As safeFetch does: a body past the request's cap ends the request.
    const body = r.body ?? '<html><body>ok</body></html>';
    const error = r.error ?? (Buffer.byteLength(body) > limits.maxBytes ? 'too_large' : null);
    if (error)
      return outcome({
        url,
        identity,
        startedAt: clock.now(),
        status: null,
        finalUrl: null,
        headers: {},
        body: '',
        maxBytes: limits.maxBytes,
        error,
        timing: { dns_ms: null, connect_ms: null, ttfb_ms: null, total_ms: 0 },
      });
    return outcome({
      url,
      identity,
      startedAt: clock.now(),
      status: r.status ?? 200,
      headers: r.headers ?? { 'content-type': 'text/html' },
      body,
      maxBytes: limits.maxBytes,
    });
  }) as FakeFetcher;
  f.calls = calls;
  return f;
}
