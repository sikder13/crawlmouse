import * as Sentry from '@sentry/nextjs';
import type { RouteClass } from './route-policy';

/**
 * `security.refused`: one sampled event per refusal, to Sentry and PostHog, so a spike of refusals
 * (a flood, a probe, a broken client) shows up without a new vendor. It names the route by its
 * registry row, never the requested path, which can hold an audit id or a report slug; it carries no
 * IP, user id or header value. Edge-safe.
 */
export interface Refusal {
  reason: 'cross_site' | 'rate_limited';
  /** The route's registry row (`audits/[id]/cancel`), not the path that was requested. */
  route: string;
  class: RouteClass;
  method: string;
  status: 403 | 429;
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
    Sentry.captureMessage('security.refused', {
      level: 'warning',
      tags: {
        reason: r.reason,
        route: r.route,
        class: r.class,
        method: r.method,
        status: String(r.status),
      },
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
