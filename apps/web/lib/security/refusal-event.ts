import * as Sentry from '@sentry/nextjs';
import type { RouteClass } from './route-policy';

/**
 * `security.refused`: one sampled event per refusal, to Sentry and PostHog, so a spike of refusals
 * (a flood, a probe, a broken client) shows up without a new vendor. It names the route by its
 * registry row, never the requested path, which can hold an audit id or a report slug; it carries no
 * IP, user id or header value. Edge-safe.
 */
export interface Refusal {
  reason: 'cross_site' | 'not_json' | 'no_route';
  /** The route's registry row (`api/audits/[id]/cancel`), not the path that was requested. */
  route: string;
  class: RouteClass | 'none';
  method: ReportedMethod;
  status: 403 | 404 | 415;
}

const METHODS = ['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'] as const;
export type ReportedMethod = (typeof METHODS)[number] | 'OTHER';

/** The request's method as telemetry records it: one of the HTTP methods, or OTHER for any token. */
export function reportedMethod(method: string): ReportedMethod {
  const m = method.toUpperCase();
  return (METHODS as readonly string[]).includes(m) ? (m as ReportedMethod) : 'OTHER';
}

/** The share of refusals sent. Counts stay proportional, so a spike is still a spike. */
export const REFUSAL_SAMPLE_RATE = 0.1;
/** At most this many sent per minute by one instance, so a flood cannot buy unbounded events. */
export const REFUSALS_PER_MINUTE = 30;

const POSTHOG_CAPTURE_URL = 'https://us.i.posthog.com/i/v0/e/';

export interface RefusalSinks {
  sentry: (refusal: Refusal) => void;
  posthog: (refusal: Refusal) => Promise<void>;
  random: () => number;
  rate: number;
  now: () => number;
}

/** Where refusals go in production; tests pass their own. */
export const DEFAULT_SINKS: RefusalSinks = {
  sentry: (r) => {
    Sentry.withScope((scope) => {
      // In the middleware the SDK puts the request (its URL, which can hold an audit id, and headers
      // with the visitor's referrer and location) on the scope, and a transaction name can carry the
      // path. This event says which route refused what, so all of that is dropped before it is sent.
      scope.addEventProcessor((event) => {
        delete event.request;
        delete event.user;
        delete event.transaction;
        delete event.breadcrumbs;
        if (event.sdkProcessingMetadata) delete event.sdkProcessingMetadata.normalizedRequest;
        return event;
      });
      // A trace of its own, so no span around the call becomes the event's parent or names the
      // envelope's trace header.
      Sentry.startNewTrace(() =>
        Sentry.captureMessage('security.refused', {
          level: 'warning',
          tags: {
            reason: r.reason,
            route: r.route,
            class: r.class,
            method: r.method,
            status: String(r.status),
          },
        }),
      );
    });
  },
  posthog: async (r) => {
    const apiKey = process.env.NEXT_PUBLIC_POSTHOG_KEY;
    if (!apiKey) return;
    await fetch(POSTHOG_CAPTURE_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        api_key: apiKey,
        event: 'security.refused',
        distinct_id: 'server:security',
        properties: { ...r, $process_person_profile: false },
      }),
    }).catch(() => undefined);
  },
  random: Math.random,
  rate: REFUSAL_SAMPLE_RATE,
  now: Date.now,
};

let windowMinute = -1;
let sentThisMinute = 0;

/** Takes one of this minute's sends, or returns false when the minute's allowance is spent. */
function takeSend(nowMs: number): boolean {
  const minute = Math.floor(nowMs / 60_000);
  if (minute !== windowMinute) {
    windowMinute = minute;
    sentThisMinute = 0;
  }
  if (sentThisMinute >= REFUSALS_PER_MINUTE) return false;
  sentThisMinute += 1;
  return true;
}

/**
 * Sends the refusal when it falls inside the sample and this instance's minute allowance is not
 * spent. Resolves once PostHog has answered (or failed, which is swallowed: telemetry never changes a
 * response), so a caller can hand it to `waitUntil`.
 */
export async function reportRefusal(
  refusal: Refusal,
  sinks: RefusalSinks = DEFAULT_SINKS,
): Promise<void> {
  if (sinks.random() >= sinks.rate || !takeSend(sinks.now())) return;
  sinks.sentry(refusal);
  await sinks.posthog(refusal);
}
