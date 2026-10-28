import type { Clock } from '../clock.js';
import { CRAWL, type Identity } from '../identities.js';
import {
  MAX_ROBOTS_BYTES,
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
 * Before any page is requested, robots.txt is read origin by origin, in the order of the batch's URLs,
 * and reading stops at the first origin that blocks the site (unreachable, too large to evaluate,
 * refused by the SSRF guard, or a Crawl-delay above MAX_CRAWL_DELAY_S): then the whole batch fetches
 * no page. The owner's rule is per site, and a batch may hold both the www and the bare origin, or
 * both schemes. A redirect to another origin of the site reads that origin's robots.txt first; once a
 * batch has read MAX_ROBOTS_ORIGINS of them, a redirect to one more is recorded, not followed.
 *
 * Readings that state rules, that there are none, or that the file is too large to evaluate are
 * cached across batches for ROBOTS_TTL_MS, up to ROBOTS_CACHE_BYTES of them by readingSize. An
 * unreachable or refused reading is not cached, so the next batch asks again.
 *
 * Crawl-delay: honoured in full up to MAX_CRAWL_DELAY_S, by raising the site limiter's gap. From
 * SLOW_CRAWL_DELAY_S up the batch is marked partial, with its coverage, so a slow site is never
 * thinned silently.
 */

export const ROBOTS_TTL_MS = 10 * 60_000;
export const ROBOTS_CACHE_MAX = 2000;
export const ROBOTS_CACHE_BYTES = 16 * 1024 * 1024;
export const MAX_ROBOTS_ORIGINS = 8;
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
export type OriginBlock =
  | 'robots_unreachable'
  | 'robots_too_large'
  | 'site_refused'
  | 'crawl_delay_over_limit';

export function originBlock(rules: OriginRules): OriginBlock | null {
  if (rules.reading.state === 'unreachable') return 'robots_unreachable';
  if (rules.reading.state === 'too_large') return 'robots_too_large';
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

/**
 * About how many bytes a reading holds: its kept rules and its evidence excerpt, at two bytes a
 * character, with a fixed allowance per rule and per reading. A rule shared by groups counts per group.
 */
export function readingSize(reading: RobotsReading): number {
  let chars = reading.fetch.body.length;
  if (reading.state === 'rules') {
    for (const group of Object.values(reading.rules.rules)) {
      for (const rule of [...group.allow, ...group.disallow]) chars += rule.length + 16;
    }
  }
  return chars * 2 + 1024;
}

export class RobotsCache {
  private readonly entries = new Map<
    string,
    { at: number; reading: RobotsReading; size: number }
  >();
  private bytes = 0;

  constructor(private readonly clock: Clock) {}

  get(origin: string): RobotsReading | null {
    const hit = this.entries.get(origin);
    if (!hit) return null;
    if (this.clock.now() - hit.at < ROBOTS_TTL_MS) return hit.reading;
    this.forget(origin);
    return null;
  }

  set(origin: string, reading: RobotsReading): void {
    if (reading.state !== 'rules' && reading.state !== 'none' && reading.state !== 'too_large')
      return;
    this.forget(origin);
    const size = readingSize(reading);
    this.entries.set(origin, { at: this.clock.now(), reading, size });
    this.bytes += size;
    // Oldest first.
    while (this.entries.size > ROBOTS_CACHE_MAX || this.bytes > ROBOTS_CACHE_BYTES)
      this.forget(this.entries.keys().next().value!);
  }

  /** What the cache holds, by readingSize. */
  get size(): { entries: number; bytes: number } {
    return { entries: this.entries.size, bytes: this.bytes };
  }

  private forget(origin: string): void {
    const hit = this.entries.get(origin);
    if (!hit) return;
    this.bytes -= hit.size;
    this.entries.delete(origin);
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

  /**
   * For a redirect target: robots.txt of the target's origin must be readable and allow this identity,
   * and reading it must not take the batch past MAX_ROBOTS_ORIGINS.
   */
  gate(identity: Identity): (url: string) => Promise<RedirectGate> {
    return async (url) => {
      const origin = new URL(url).origin;
      if (!this.loads.has(origin) && this.loads.size >= MAX_ROBOTS_ORIGINS)
        return { stop: 'origin_limit' };
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
      const r = await politeFetch(this.ctx, `${origin}/robots.txt`, CRAWL, {
        offSite: 'follow',
        maxBytes: MAX_ROBOTS_BYTES,
      });
      if ('notRequested' in r) return r.notRequested;
      reading = readRobots(r.fetch);
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
