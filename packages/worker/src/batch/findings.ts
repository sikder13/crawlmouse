import type { TooLargeReason, UnreachableReason } from '../politeness/robots.js';
import type { SiteStop, StopReason } from '../politeness/sites.js';
import { bounded, CAPS } from '../rows/bounded.js';
import type { BudgetKind } from './budget.js';
import type { NotRequested } from './polite-fetch.js';
import { SLOW_CRAWL_DELAY_S, originBlock, type OriginRules } from './site-rules.js';

/** What a batch met that limited it, recorded once each, and the partial reasons that follow from them. */

export type Finding =
  | {
      kind: 'site_stopped';
      site: string;
      reason: StopReason;
      at: string;
      until: string;
      /** False when the stop came with the batch's last request, so it refused none of them. */
      requests_refused: boolean;
    }
  | { kind: 'budget_spent'; budget: BudgetKind }
  | { kind: 'robots_unreachable'; origin: string; why: UnreachableReason }
  | { kind: 'robots_too_large'; origin: string; why: TooLargeReason }
  | { kind: 'site_refused'; origin: string }
  | { kind: 'crawl_delay'; origin: string; declared_s: number; honoured: boolean }
  | { kind: 'result_size_limit'; limit_bytes: number }
  | { kind: 'reader_thread_crashed' };

export const PARTIAL_REASONS = [
  'budget_requests',
  'budget_bytes',
  'budget_seconds',
  'site_stopped',
  'robots_unreachable',
  'robots_too_large',
  'site_refused',
  'crawl_delay_over_limit',
  'crawl_delay_10s_or_more',
  'result_size',
  'reader_thread_crashed',
] as const;

export type PartialReason = (typeof PARTIAL_REASONS)[number];

export class Findings {
  private readonly items = new Map<string, Finding>();

  private add(key: string, f: Finding): void {
    if (!this.items.has(key)) this.items.set(key, f);
  }

  notRequested(n: NotRequested): void {
    if (n.reason === 'budget') {
      this.add(`budget:${n.budget}`, { kind: 'budget_spent', budget: n.budget });
    } else if (n.reason === 'reader_thread_crashed') {
      this.add('reader', { kind: 'reader_thread_crashed' });
    } else {
      this.items.set(`stop:${n.site}`, stopFinding(n.site, n.stop, true));
    }
  }

  /** A budget the batch spent, whether or not a later request met it. */
  budgetSpent(budget: BudgetKind): void {
    this.add(`budget:${budget}`, { kind: 'budget_spent', budget });
  }

  /** A stop the batch's own requests caused, recorded even when no later request met it. */
  stopped(site: string, stop: SiteStop): void {
    this.add(`stop:${site}`, stopFinding(site, stop, false));
  }

  origin(rules: OriginRules): void {
    const { origin, reading, crawlDelayS } = rules;
    if (reading.state === 'unreachable') {
      this.add(`robots:${origin}`, { kind: 'robots_unreachable', origin, why: reading.why });
    }
    if (reading.state === 'too_large') {
      this.add(`robots:${origin}`, { kind: 'robots_too_large', origin, why: reading.why });
    }
    if (reading.state === 'refused')
      this.add(`refused:${origin}`, { kind: 'site_refused', origin });
    if (crawlDelayS !== null && crawlDelayS >= SLOW_CRAWL_DELAY_S) {
      this.add(`delay:${origin}`, {
        kind: 'crawl_delay',
        origin,
        declared_s: crawlDelayS,
        honoured: originBlock(rules) !== 'crawl_delay_over_limit',
      });
    }
  }

  resultSizeLimit(limitBytes: number): void {
    this.add('result_size', { kind: 'result_size_limit', limit_bytes: limitBytes });
  }

  /** The findings as a result stores them: a site key or an origin bounded like every stored string. */
  list(): Finding[] {
    return [...this.items.values()].map((f) => {
      if ('site' in f) return { ...f, site: bounded(f.site, CAPS.site) };
      if ('origin' in f) return { ...f, origin: bounded(f.origin, CAPS.origin) };
      return f;
    });
  }

  partialReasons(): PartialReason[] {
    const reasons = new Set<PartialReason>();
    for (const f of this.items.values()) {
      if (f.kind === 'budget_spent') reasons.add(`budget_${f.budget}`);
      else if (f.kind === 'crawl_delay') {
        reasons.add(f.honoured ? 'crawl_delay_10s_or_more' : 'crawl_delay_over_limit');
      } else if (f.kind === 'result_size_limit') reasons.add('result_size');
      else if (f.kind === 'site_stopped') {
        if (f.requests_refused) reasons.add('site_stopped');
      } else reasons.add(f.kind);
    }
    return [...reasons];
  }
}

function stopFinding(site: string, stop: SiteStop, refused: boolean): Finding {
  return {
    kind: 'site_stopped',
    site,
    reason: stop.reason,
    at: new Date(stop.at).toISOString(),
    until: new Date(stop.until).toISOString(),
    requests_refused: refused,
  };
}
