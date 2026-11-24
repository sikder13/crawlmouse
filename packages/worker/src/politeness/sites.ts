import type { Clock } from '../clock.js';
import { SiteLimiter } from './limiter.js';
import { retryAfterMs } from '../fetch/retry-after.js';
import { politenessKeyOf } from './site-key.js';

/**
 * Per-site state shared by every batch in the process: the limiter, how a 429 slows it, and the rule
 * that stops all requests to a site after STOP_AFTER_429S answers of 429 in a row or four consecutive
 * challenged pages. A stop lasts STOP_COOLDOWN_MS; each batch that meets it records it as a finding.
 *
 * A 429 is a request to slow down, not a refusal (inbox 048). The site's next request waits for its
 * Retry-After, or for a back-off that doubles with each 429 in a row when it sends none, at most
 * MAX_WAIT_MS either way. The gap between requests then doubles, up to MAX_BACKOFF_GAP_MS, and stays
 * raised. Any other answer ends the run of 429s; the gap does not come back down.
 *
 * What counts as a challenged page is decided by the caller: in a crawl batch it is a page whose
 * fetch was a challenge; in an access batch it is a page whose browser control was challenged.
 */

/** 429 answers in a row, each waited out and each at a slower pace, before the site is stopped. */
export const STOP_AFTER_429S = 6;
/** The wait after a 429 that sends no Retry-After; it doubles with each 429 in a row. */
export const BACKOFF_FIRST_MS = 2_000;
/** The longest a 429 makes the site wait, whatever its Retry-After asks. */
export const MAX_WAIT_MS = 60_000;
/** The slowest pace a run of 429s brings a site to: one request start in this long. */
export const MAX_BACKOFF_GAP_MS = 8_000;
/** How many more times a page that answered 429 is asked for, after its wait. */
export const RETRIES_ON_429 = 2;
export const STOP_AFTER_CHALLENGED_PAGES = 4;
export const STOP_COOLDOWN_MS = 10 * 60_000;
/** A site with nothing queued or running for this long is forgotten (and its limiter with it). */
export const SITE_IDLE_FORGET_MS = 60_000;

/** `three_429_responses` is the contract's name from when three were enough; it is STOP_AFTER_429S now. */
export type StopReason = 'three_429_responses' | 'four_consecutive_challenged_pages';

export interface SiteStop {
  reason: StopReason;
  at: number;
  until: number;
}

class Site {
  readonly limiter: SiteLimiter;
  responses429 = 0;
  challengedRun = 0;
  stop: SiteStop | null = null;

  constructor(clock: Clock) {
    this.limiter = new SiteLimiter(clock);
  }
}

export class Sites {
  private readonly sites = new Map<string, Site>();

  constructor(
    private readonly clock: Clock,
    /** LAB_HOST_POLITENESS: each lab host is a site of its own (politenessKeyOf). */
    private readonly perLabHost: boolean = false,
  ) {}

  /** The key this process's limiter and stop rules hold a URL's site under. */
  keyOf(url: string | URL): string {
    return politenessKeyOf(url, this.perLabHost);
  }

  private site(key: string): Site {
    let s = this.sites.get(key);
    if (!s) {
      s = new Site(this.clock);
      this.sites.set(key, s);
    }
    return s;
  }

  limiter(key: string): SiteLimiter {
    return this.site(key).limiter;
  }

  /** The stop in force for this site, or null. An expired stop is cleared with its counters. */
  stopOf(key: string): SiteStop | null {
    const s = this.sites.get(key);
    if (!s?.stop) return null;
    if (this.clock.now() < s.stop.until) return s.stop;
    s.stop = null;
    s.responses429 = 0;
    s.challengedRun = 0;
    return null;
  }

  /**
   * A 429 to a request that counts: waits the site out for its Retry-After (`retryAfter`, the header
   * as sent; undefined when there was none), slows it, and stops it after STOP_AFTER_429S in a row.
   */
  record429(key: string, retryAfter?: string): void {
    const s = this.site(key);
    s.responses429++;
    const backoff = BACKOFF_FIRST_MS * 2 ** (s.responses429 - 1);
    const asked = retryAfterMs(retryAfter, this.clock.now());
    const wait = Math.min(MAX_WAIT_MS, Math.max(0, asked ?? backoff));
    s.limiter.pauseUntil(this.clock.now() + wait);
    s.limiter.raiseGapMs(Math.min(MAX_BACKOFF_GAP_MS, s.limiter.gapMs() * 2));
    if (s.responses429 >= STOP_AFTER_429S) this.stopSite(s, 'three_429_responses');
  }

  /** Any answer but a 429 to a request that counts ends the site's run of 429s. */
  recordAnswer(key: string): void {
    const s = this.sites.get(key);
    if (s) s.responses429 = 0;
  }

  /** One page's outcome for the consecutive-challenge rule; a page that was not challenged resets it. */
  recordPage(key: string, challenged: boolean): void {
    const s = this.site(key);
    s.challengedRun = challenged ? s.challengedRun + 1 : 0;
    if (s.challengedRun >= STOP_AFTER_CHALLENGED_PAGES) {
      this.stopSite(s, 'four_consecutive_challenged_pages');
    }
  }

  private stopSite(s: Site, reason: StopReason): void {
    if (s.stop && this.clock.now() < s.stop.until) return;
    const at = this.clock.now();
    s.stop = { reason, at, until: at + STOP_COOLDOWN_MS };
  }

  /**
   * Forgets sites that are not stopped and have been idle for at least max(SITE_IDLE_FORGET_MS, gap).
   * Pacing survives this: a site is only forgotten once its next start would be allowed anyway.
   */
  sweep(): void {
    for (const [key, s] of this.sites) {
      const idleMs = Math.max(SITE_IDLE_FORGET_MS, s.limiter.gapMs());
      if (!this.stopOf(key) && s.limiter.idleFor(idleMs)) this.sites.delete(key);
    }
  }

  /** Requests started per site, for the sites currently held. */
  requestsPerSite(): Record<string, number> {
    return Object.fromEntries([...this.sites].map(([key, s]) => [key, s.limiter.started]));
  }
}
