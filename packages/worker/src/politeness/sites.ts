import type { Clock } from '../clock.js';
import { SiteLimiter } from './limiter.js';

/**
 * Per-site state shared by every batch in the process: the limiter, and the rule that stops all
 * requests to a site after three 429 responses or four consecutive challenged pages. A stop lasts
 * STOP_COOLDOWN_MS; each batch that meets it records it as a finding.
 *
 * What counts as a challenged page is decided by the caller: in a crawl batch it is a page whose
 * fetch was a challenge; in an access batch it is a page whose browser control was challenged.
 */

export const STOP_AFTER_429S = 3;
export const STOP_AFTER_CHALLENGED_PAGES = 4;
export const STOP_COOLDOWN_MS = 10 * 60_000;
/** A site with nothing queued or running for this long is forgotten (and its limiter with it). */
export const SITE_IDLE_FORGET_MS = 60_000;

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

  constructor(private readonly clock: Clock) {}

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

  record429(key: string): void {
    const s = this.site(key);
    s.responses429++;
    if (s.responses429 >= STOP_AFTER_429S) this.stopSite(s, 'three_429_responses');
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
