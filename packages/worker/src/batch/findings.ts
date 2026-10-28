import type { UnreachableReason } from '../politeness/robots.js';
import type { StopReason } from '../politeness/sites.js';
import type { BudgetKind } from './budget.js';
import type { NotRequested } from './polite-fetch.js';
import { SLOW_CRAWL_DELAY_S, originBlock, type OriginRules } from './site-rules.js';

/** What a batch met that limited it, recorded once each, and the partial reasons that follow from them. */

export type Finding =
  | { kind: 'site_stopped'; site: string; reason: StopReason; at: string; until: string }
  | { kind: 'budget_spent'; budget: BudgetKind }
  | { kind: 'robots_unreachable'; origin: string; why: UnreachableReason }
  | { kind: 'site_refused'; origin: string }
  | { kind: 'crawl_delay'; origin: string; declared_s: number; honoured: boolean }
  | { kind: 'result_size_limit'; limit_bytes: number };

export const PARTIAL_REASONS = [
  'budget_requests',
  'budget_bytes',
  'budget_seconds',
  'site_stopped',
  'robots_unreachable',
  'site_refused',
  'crawl_delay_over_limit',
  'crawl_delay_10s_or_more',
  'result_size',
] as const;

export type PartialReason = (typeof PARTIAL_REASONS)[number];

export class Findings {
  private readonly items = new Map<string, Finding>();

  private add(key: string, f: Finding): void {
    if (!this.items.has(key)) this.items.set(key, f);
  }

  notRequested(n: NotRequested): void {
    if (n.reason === 'budget')
      this.add(`budget:${n.budget}`, { kind: 'budget_spent', budget: n.budget });
    else {
      this.add(`stop:${n.site}`, {
        kind: 'site_stopped',
        site: n.site,
        reason: n.stop.reason,
        at: new Date(n.stop.at).toISOString(),
        until: new Date(n.stop.until).toISOString(),
      });
    }
  }

  origin(rules: OriginRules): void {
    const { origin, reading, crawlDelayS } = rules;
    if (reading.state === 'unreachable') {
      this.add(`robots:${origin}`, { kind: 'robots_unreachable', origin, why: reading.why });
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

  list(): Finding[] {
    return [...this.items.values()];
  }

  partialReasons(): PartialReason[] {
    const reasons = new Set<PartialReason>();
    for (const f of this.items.values()) {
      if (f.kind === 'budget_spent') reasons.add(`budget_${f.budget}`);
      else if (f.kind === 'crawl_delay') {
        reasons.add(f.honoured ? 'crawl_delay_10s_or_more' : 'crawl_delay_over_limit');
      } else if (f.kind === 'result_size_limit') reasons.add('result_size');
      else reasons.add(f.kind);
    }
    return [...reasons];
  }
}
