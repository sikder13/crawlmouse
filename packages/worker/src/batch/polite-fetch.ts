import {
  MAX_BODY_BYTES,
  type FetchOutcome,
  type Fetcher,
  type Hop,
  type RedirectStop,
} from '../fetch/fetcher.js';
import type { Identity } from '../identities.js';
import { MAX_URL_LENGTH } from '../rows/bounded.js';
import { siteKeyOf } from '../politeness/site-key.js';
import type { SiteStop, Sites } from '../politeness/sites.js';
import type { Budget, BudgetKind } from './budget.js';

/**
 * A request as the batch makes it: paced by the site's limiter, taken from the batch budget, refused
 * while the site is stopped, and with redirects followed one paced request at a time. Every hop is a
 * request in its own right, so a redirect chain cannot exceed the site's rate.
 */

export const MAX_REDIRECTS = 5;
const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);

export interface FetchContext {
  sites: Sites;
  fetcher: Fetcher;
  budget: Budget;
  /** Aborted once a budget is spent, so the batch's queued requests are dropped without a start. */
  abort: AbortController;
}

export type NotRequested =
  | { reason: 'budget'; budget: BudgetKind }
  | { reason: 'site_stopped'; site: string; stop: SiteStop };

/**
 * A request's outcome. `cut` is set when a redirect chain was stopped by the batch or a site stop
 * before its target could be checked: the response received is kept, and the reason goes alongside.
 */
export type Requested =
  | { fetch: FetchOutcome; cut?: NotRequested }
  | { notRequested: NotRequested };

/** Whether a redirect target may be requested, and if not, why. */
export type RedirectGate =
  | { allowed: true }
  | { stop: 'robots_disallowed' | 'robots_unreadable' | 'origin_limit' }
  | { notRequested: NotRequested };

export interface RequestPolicy {
  /** `stop`: a redirect to another registrable domain is recorded, not requested. */
  offSite: 'stop' | 'follow';
  /** robots.txt's say on a redirect target. Omitted: every target may be requested. */
  gate?: (url: string) => Promise<RedirectGate>;
  /** The decoded body cap for each request, when it is below MAX_BODY_BYTES. */
  maxBytes?: number;
}

function locationOf(f: FetchOutcome): string | null {
  if (f.status === null || !REDIRECT_STATUSES.has(f.status)) return null;
  const v = f.headers.location;
  return (Array.isArray(v) ? v[0] : v) ?? null;
}

async function oneRequest(
  ctx: FetchContext,
  url: string,
  identity: Identity,
  ceiling: number,
): Promise<FetchOutcome | NotRequested> {
  const site = siteKeyOf(url);
  const before = refusal(ctx, site);
  if (before) return before;
  const scheduled = await ctx.sites.limiter(site).schedule(async () => {
    const atStart = refusal(ctx, site);
    if (atStart) return atStart;
    const spent = ctx.budget.take();
    if (spent) {
      ctx.abort.abort();
      return { reason: 'budget', budget: spent } satisfies NotRequested;
    }
    const limits = ctx.budget.requestLimits();
    const f = await ctx.fetcher(url, identity, {
      ...limits,
      maxBytes: Math.min(limits.maxBytes, ceiling),
    });
    ctx.budget.addBytes(f.bytes);
    // Cut off by what the batch had left, rather than by the request's own ceiling.
    if (f.error === 'too_large' && limits.maxBytes < ceiling) {
      ctx.budget.cutByBytes();
      ctx.abort.abort();
    }
    if (f.status === 429) ctx.sites.record429(site);
    return f;
  }, ctx.abort.signal);
  if (scheduled.ran) return scheduled.value;
  return { reason: 'budget', budget: ctx.budget.exhausted! };
}

function refusal(ctx: FetchContext, site: string): NotRequested | null {
  const stop = ctx.sites.stopOf(site);
  if (stop) return { reason: 'site_stopped', site, stop };
  const spent = ctx.budget.exhausted;
  return spent ? { reason: 'budget', budget: spent } : null;
}

export async function politeFetch(
  ctx: FetchContext,
  url: string,
  identity: Identity,
  policy: RequestPolicy,
): Promise<Requested> {
  const hops: Hop[] = [];
  let current = url;
  // The redirect response that led to `current`, once there is one.
  let previous: FetchOutcome | null = null;
  for (;;) {
    const r = await oneRequest(ctx, current, identity, policy.maxBytes ?? MAX_BODY_BYTES);
    if ('reason' in r) {
      if (!previous) return { notRequested: r };
      // A hop already answered: keep its response, and say why the chain went no further.
      const fetch = {
        ...previous,
        url,
        hops,
        finalUrl: current,
        redirectStop: 'batch_stopped' as const,
      };
      return { fetch, cut: r };
    }
    const location = locationOf(r);
    let next: string | null = null;
    try {
      next = location === null ? null : new URL(location, current).toString();
    } catch {
      next = null; // an unparseable Location ends the chain at the redirect response
    }
    if (next === null) return { fetch: { ...r, url, hops } };
    if (next.length > MAX_URL_LENGTH) {
      // Neither requested nor kept: the hop records an empty Location, and there is no final URL.
      hops.push({ from: current, status: r.status!, location: '' });
      return { fetch: { ...r, url, hops, finalUrl: null, redirectStop: 'url_too_long' } };
    }

    hops.push({ from: current, status: r.status!, location: next });
    let stop: RedirectStop | null = null;
    if (hops.length > MAX_REDIRECTS) stop = 'too_many';
    else if (!/^https?:$/.test(new URL(next).protocol)) stop = 'not_web';
    // The JWT names a site on its default port; a redirect may not move the chain to another one.
    else if (new URL(next).port !== new URL(url).port) stop = 'other_port';
    else if (policy.offSite === 'stop' && siteKeyOf(next) !== siteKeyOf(url)) stop = 'off_site';
    else if (policy.gate) {
      const gate = await policy.gate(next);
      if ('notRequested' in gate) {
        const fetch = { ...r, url, hops, finalUrl: next, redirectStop: 'batch_stopped' as const };
        return { fetch, cut: gate.notRequested };
      }
      if ('stop' in gate) stop = gate.stop;
    }
    if (stop) return { fetch: { ...r, url, hops, finalUrl: next, redirectStop: stop } };
    previous = r;
    current = next;
  }
}
