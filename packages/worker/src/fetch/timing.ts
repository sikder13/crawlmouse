import { AsyncLocalStorage } from 'node:async_hooks';
import dc from 'node:diagnostics_channel';
import type { ClientRequest } from 'node:http';
import type { Socket } from 'node:net';
import { MAX_TIMING_MS, type RequestTiming } from '@crawlmouse/types/v2';
import type { Clock } from '../clock.js';

/**
 * How long each phase of a request took, observed without touching safeFetch (protected by
 * OPERATING-RULES §5): Node's http client announces every request it creates on the
 * `http.client.request.created` diagnostics channel, synchronously, inside the async context of the
 * call that made it. `timed` runs a fetch inside a context of its own, so the request it creates is
 * told apart from every other request in flight.
 *
 * Times are taken from the worker's clock, from the moment the request was created. Two things are
 * not measured:
 * - the address lookup safeFetch's SSRF guard makes before the request (validateUrlOrThrow): only the
 *   socket's own lookup, the pinned one, is `dns_ms`;
 * - a connection reused from the agent's pool makes no lookup and no connection, so both are null.
 */

export { MAX_TIMING_MS };

/** A duration as a timing field holds it: whole milliseconds, 0 to MAX_TIMING_MS. */
export const boundedMs = (ms: number): number =>
  Math.min(MAX_TIMING_MS, Math.max(0, Number.isNaN(ms) ? 0 : Math.round(ms)));

interface Marks {
  sent: number | null;
  lookup: number | null;
  connect: number | null;
  response: number | null;
}

const context = new AsyncLocalStorage<{ clock: Clock; marks: Marks }>();

dc.subscribe('http.client.request.created', (message) => {
  const ctx = context.getStore();
  if (!ctx) return;
  const { request } = message as { request: ClientRequest };
  const { clock, marks } = ctx;
  // One request per call: safeFetch is asked not to follow redirects. A later one would replace it.
  marks.sent = clock.now();
  marks.lookup = marks.connect = marks.response = null;
  request.once('socket', (socket: Socket) => {
    if (!socket.connecting) return; // reused from the pool: no lookup, no connection
    socket.once('lookup', () => (marks.lookup = clock.now()));
    const ready = 'encrypted' in socket ? 'secureConnect' : 'connect';
    socket.once(ready, () => (marks.connect = clock.now()));
  });
  request.once('response', () => (marks.response = clock.now()));
});

/** Runs `fetch`, and gives its result with the timing of the request it made. */
export async function timed<T>(
  clock: Clock,
  fetch: () => Promise<T>,
): Promise<{ value: T; timing: RequestTiming }> {
  const marks: Marks = { sent: null, lookup: null, connect: null, response: null };
  const called = clock.now();
  const value = await context.run({ clock, marks }, fetch);
  const ended = clock.now();
  const from = marks.sent ?? called;
  const since = (t: number | null) => (t === null ? null : boundedMs(t - from));
  return {
    value,
    timing: {
      dns_ms: since(marks.lookup),
      connect_ms: since(marks.connect),
      ttfb_ms: since(marks.response),
      total_ms: boundedMs(ended - from),
    },
  };
}
