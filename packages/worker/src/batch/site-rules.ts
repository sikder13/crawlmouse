import type { Clock } from '../clock.js';
import { CRAWL, type Identity } from '../identities.js';
import {
  crawlDelaySeconds,
  oursAllow,
  readRobots,
  tokenAllows,
  type RobotsReading,
} from '../politeness/robots.js';
import { siteKeyOf } from '../politeness/site-key.js';
import {
  politeFetch,
  type FetchContext,
  type NotRequested,
  type RedirectGate,
} from './polite-fetch.js';

/**
 * robots.txt per origin for one batch, and what it allows.
 *
 * Before any page is requested, robots.txt is read for every origin the batch's URLs are on. If any
 * of them blocks the site (unreachable, refused by the SSRF guard, or a Crawl-delay above
 * MAX_CRAWL_DELAY_S), the whole batch fetches no page: the owner's rule is per site, and a batch may
 * hold both the www and the bare origin, or both schemes.
 *
 * Readings that state rules, or that there are none, are cached across batches for ROBOTS_TTL_MS. An
 * unreachable or refused reading is not cached, so the next batch asks again.
 *
 * Crawl-delay: honoured in full up to MAX_CRAWL_DELAY_S, by raising the site limiter's gap. From
 * SLOW_CRAWL_DELAY_S up the batch is marked partial, with its coverage, so a slow site is never
 * thinned silently.
 */

export const ROBOTS_TTL_MS = 10 * 60_000;
export const ROBOTS_CACHE_MAX = 2000;
export const MAX_CRAWL_DELAY_S = 30;
export const SLOW_CRAWL_DELAY_S = 10;

export interface OriginRules {
  origin: string;
  reading: RobotsReading;
  fromCache: boolean;
  /** The largest delay that applies to the identities this batch sends; null when none is declared. */
  crawlDelayS: number | null;
}

/** Why a site cannot be fetched at all, if it cannot. */
export type OriginBlock = 'robots_unreachable' | 'site_refused' | 'crawl_delay_over_limit';

export function originBlock(rules: OriginRules): OriginBlock | null {
  if (rules.reading.state === 'unreachable') return 'robots_unreachable';
  if (rules.reading.state === 'refused') return 'site_refused';
  if (rules.crawlDelayS !== null && rules.crawlDelayS > MAX_CRAWL_DELAY_S) {
    return 'crawl_delay_over_limit';
  }
  return null;
}

/** The origin whose robots.txt keeps the batch from fetching any page, and why. */
export interface SiteBlock {
  block: OriginBlock;
  rules: OriginRules;
}

export function pathOf(url: string): string {
  const u = new URL(url);
  return u.pathname + u.search;
}

/** Whether robots.txt lets this identity request this URL: our groups always, and its own if it has one. */
export function robotsAllows(rules: OriginRules, identity: Identity, url: string): boolean {
  const parsed = rules.reading.state === 'rules' ? rules.reading.rules : null;
  const path = pathOf(url);
  if (!oursAllow(parsed, path)) return false;
  return identity.robotsToken === null || tokenAllows(parsed, identity.robotsToken, path);
}

export class RobotsCache {
  private readonly entries = new Map<string, { at: number; reading: RobotsReading }>();

  constructor(private readonly clock: Clock) {}

  get(origin: string): RobotsReading | null {
    const hit = this.entries.get(origin);
    if (!hit) return null;
    if (this.clock.now() - hit.at < ROBOTS_TTL_MS) return hit.reading;
    this.entries.delete(origin);
    return null;
  }

  set(origin: string, reading: RobotsReading): void {
    if (reading.state !== 'rules' && reading.state !== 'none') return;
    this.entries.delete(origin);
    this.entries.set(origin, { at: this.clock.now(), reading });
    while (this.entries.size > ROBOTS_CACHE_MAX)
      this.entries.delete(this.entries.keys().next().value!);
  }
}

export class BatchRobots {
  private readonly loads = new Map<string, Promise<OriginRules | NotRequested>>();

  constructor(
    private readonly ctx: FetchContext,
    private readonly cache: RobotsCache,
    /** Crawler tokens whose own Crawl-delay applies to this batch's requests. */
    private readonly tokens: readonly string[],
  ) {}

  /** Every origin this batch has read, in the order first asked. */
  async all(): Promise<Array<OriginRules | NotRequested>> {
    return Promise.all(this.loads.values());
  }

  forUrl(url: string): Promise<OriginRules | NotRequested> {
    const origin = new URL(url).origin;
    let load = this.loads.get(origin);
    if (!load) {
      load = this.load(origin);
      this.loads.set(origin, load);
    }
    return load;
  }

  /**
   * Reads robots.txt for every origin of these URLs, in order. Returns the first origin that blocks
   * the site, or why a read could not be made (a spent budget, a stopped site); null when pages may
   * be requested.
   */
  async preload(urls: readonly string[]): Promise<SiteBlock | NotRequested | null> {
    for (const url of urls) {
      const rules = await this.forUrl(url);
      if ('reason' in rules) return rules;
      const block = originBlock(rules);
      if (block) return { block, rules };
    }
    return null;
  }

  /** For a redirect target: robots.txt of the target's origin must be readable and allow this identity. */
  gate(identity: Identity): (url: string) => Promise<RedirectGate> {
    return async (url) => {
      const rules = await this.forUrl(url);
      if ('reason' in rules) return { notRequested: rules };
      if (originBlock(rules)) return { stop: 'robots_unreadable' };
      return robotsAllows(rules, identity, url) ? { allowed: true } : { stop: 'robots_disallowed' };
    };
  }

  private async load(origin: string): Promise<OriginRules | NotRequested> {
    let reading = this.cache.get(origin);
    const fromCache = reading !== null;
    if (!reading) {
      const r = await politeFetch(this.ctx, `${origin}/robots.txt`, CRAWL, { offSite: 'follow' });
      if ('notRequested' in r) return r.notRequested;
      // Only the start of the body is kept as evidence; the rules are already parsed from all of it.
      reading = readRobots(r.fetch);
      reading = {
        ...reading,
        fetch: { ...reading.fetch, body: reading.fetch.body.slice(0, 4096) },
      };
      this.cache.set(origin, reading);
    }
    const crawlDelayS =
      reading.state === 'rules' ? crawlDelaySeconds(reading.rules, this.tokens) : null;
    if (crawlDelayS !== null && crawlDelayS <= MAX_CRAWL_DELAY_S) {
      this.ctx.sites.limiter(siteKeyOf(origin)).raiseGapMs(crawlDelayS * 1000);
    }
    return { origin, reading, fromCache, crawlDelayS };
  }
}
