import { describe, it, expect } from 'vitest';
import { buildReport } from './diff.js';
import type { BotAccess, DomainSnapshot, PanelGroup } from './types.js';

const AI = ['GPTBot', 'ClaudeBot'] as const;
const SEARCH = ['Googlebot'] as const;

interface SnapOpts {
  hash?: string;
  status?: number;
  signals?: string[];
  access?: Partial<Record<string, BotAccess>>;
  cfRay?: boolean;
  adsStatus?: number | null;
}

function snap(domain: string, group: PanelGroup, o: SnapOpts = {}): DomainSnapshot {
  const status = o.status ?? 200;
  const tokens = [...AI, ...SEARCH];
  return {
    domain,
    group,
    rank: 1000,
    fetchedAt: '2026-09-10T00:00:00.000Z',
    robots: {
      finalUrl: `https://${domain}/robots.txt`,
      status,
      body: status === 200 ? 'x' : null,
      sha256: status === 200 ? (o.hash ?? 'aaa') : null,
      bytes: 1,
      truncated: false,
      error: status === 200 ? null : 'boom',
    },
    access: status === 200
      ? tokens.map((t) => ({
          token: t,
          status: o.access?.[t] ?? ('allowed' as BotAccess),
          mentioned: true,
          matchedGroup: t.toLowerCase(),
        }))
      : [],
    contentSignals: o.signals ?? [],
    homepage: { status: 200, server: o.cfRay === false ? 'nginx' : 'cloudflare', cfRay: o.cfRay ?? true, error: null },
    adsTxt: { status: o.adsStatus === undefined ? 200 : o.adsStatus, error: null },
    groupMismatch: false,
  };
}

const report = (from: DomainSnapshot[], to: DomainSnapshot[]) =>
  buildReport({ from: '2026-09-10', to: '2026-09-16', fromSnaps: from, toSnaps: to, aiTokens: AI, searchTokens: SEARCH });

describe('diff aggregation', () => {
  it('counts a changed robots hash, with the denominator it was taken over', () => {
    const r = report(
      [snap('a.com', 'cf_ads', { hash: 'h1' }), snap('b.com', 'cf_ads', { hash: 'h1' })],
      [snap('a.com', 'cf_ads', { hash: 'h2' }), snap('b.com', 'cf_ads', { hash: 'h1' })],
    );
    expect(r.groups.cf_ads.robotsHashChanged).toEqual({ count: 1, of: 2, pct: 50 });
  });

  it('excludes a domain missing from the second run rather than counting it as unchanged', () => {
    const r = report([snap('a.com', 'cf_ads'), snap('gone.com', 'cf_ads')], [snap('a.com', 'cf_ads')]);
    expect(r.groups.cf_ads.domains).toBe(2);
    expect(r.groups.cf_ads.comparable).toBe(1);
  });

  it('separates an unreadable robots.txt from an unchanged one', () => {
    const r = report([snap('a.com', 'cf_ads')], [snap('a.com', 'cf_ads', { status: 503 })]);
    expect(r.groups.cf_ads.bothReadable).toBe(0);
    expect(r.groups.cf_ads.robotsHashChanged).toEqual({ count: 0, of: 0, pct: null });
    expect(r.groups.cf_ads.robotsAvailabilityChanged).toEqual({ count: 1, of: 1, pct: 100 });
  });

  it('counts per-token movement in both directions, and only for the token that moved', () => {
    const r = report(
      [snap('a.com', 'cf_ads'), snap('b.com', 'cf_ads', { access: { GPTBot: 'disallowed_root' } })],
      [
        snap('a.com', 'cf_ads', { access: { GPTBot: 'disallowed_root' } }),
        snap('b.com', 'cf_ads', { access: { GPTBot: 'allowed' } }),
      ],
    );
    expect(r.groups.cf_ads.aiTokens.GPTBot).toEqual({ toBlocked: 1, toUnblocked: 1, statusChanged: 2, of: 2 });
    expect(r.groups.cf_ads.aiTokens.ClaudeBot).toEqual({ toBlocked: 0, toUnblocked: 0, statusChanged: 0, of: 2 });
  });

  it('a move to partially_disallowed is a status change but not a block', () => {
    const r = report(
      [snap('a.com', 'cf_ads')],
      [snap('a.com', 'cf_ads', { access: { GPTBot: 'partially_disallowed' } })],
    );
    expect(r.groups.cf_ads.aiTokens.GPTBot).toEqual({ toBlocked: 0, toUnblocked: 0, statusChanged: 1, of: 1 });
    expect(r.groups.cf_ads.anyAiTokenNewlyBlocked.count).toBe(0);
  });

  it('counts a site once in anyAiTokenNewlyBlocked however many tokens moved', () => {
    const r = report(
      [snap('a.com', 'cf_ads')],
      [snap('a.com', 'cf_ads', { access: { GPTBot: 'disallowed_root', ClaudeBot: 'disallowed_root' } })],
    );
    expect(r.groups.cf_ads.aiTokens.GPTBot?.toBlocked).toBe(1);
    expect(r.groups.cf_ads.aiTokens.ClaudeBot?.toBlocked).toBe(1);
    expect(r.groups.cf_ads.anyAiTokenNewlyBlocked).toEqual({ count: 1, of: 1, pct: 100 });
  });

  it('tracks the multi-purpose crawlers separately from the AI tokens', () => {
    const r = report(
      [snap('a.com', 'cf_ads')],
      [snap('a.com', 'cf_ads', { access: { Googlebot: 'disallowed_root' } })],
    );
    expect(r.groups.cf_ads.searchTokens.Googlebot?.toBlocked).toBe(1);
    expect(r.groups.cf_ads.anyAiTokenNewlyBlocked.count).toBe(0);
  });

  it('counts gaining and losing Content Signals in the right direction', () => {
    const r = report(
      [snap('a.com', 'cf_ads'), snap('b.com', 'cf_ads', { signals: ['# Content-Signal: ai-train=no'] })],
      [snap('a.com', 'cf_ads', { signals: ['# Content-Signal: ai-train=no'] }), snap('b.com', 'cf_ads')],
    );
    expect(r.groups.cf_ads.gainedContentSignals.count).toBe(1);
    expect(r.groups.cf_ads.lostContentSignals.count).toBe(1);
  });

  it('notices a site that stopped being Cloudflare-fronted or stopped serving ads.txt', () => {
    const r = report(
      [snap('a.com', 'cf_ads'), snap('b.com', 'cf_ads')],
      [snap('a.com', 'cf_ads', { cfRay: false }), snap('b.com', 'cf_ads', { adsStatus: 404 })],
    );
    expect(r.groups.cf_ads.groupSignalsChanged).toEqual({ count: 2, of: 2, pct: 100 });
  });

  it('keeps the groups apart and totals them together', () => {
    const r = report(
      [snap('a.com', 'cf_ads', { hash: 'h1' }), snap('b.com', 'ads_no_cf', { hash: 'h1' })],
      [snap('a.com', 'cf_ads', { hash: 'h2' }), snap('b.com', 'ads_no_cf', { hash: 'h2' })],
    );
    expect(r.groups.cf_ads.robotsHashChanged.count).toBe(1);
    expect(r.groups.ads_no_cf.robotsHashChanged.count).toBe(1);
    expect(r.groups.cf_no_ads.robotsHashChanged).toEqual({ count: 0, of: 0, pct: null });
    expect(r.totals.robotsHashChanged).toEqual({ count: 2, of: 2, pct: 100 });
  });

  // The publication rule, enforced rather than remembered.
  it('emits no per-domain listing unless examples are explicitly asked for', () => {
    const from = [snap('a.com', 'cf_ads', { hash: 'h1' })];
    const to = [snap('a.com', 'cf_ads', { hash: 'h2' })];
    expect(report(from, to).examples).toEqual([]);
    const withExamples = buildReport({
      from: 'x', to: 'y', fromSnaps: from, toSnaps: to, aiTokens: AI, searchTokens: SEARCH, exampleLimit: 5,
    });
    expect(withExamples.examples).toEqual(['a.com']);
    expect(JSON.stringify(report(from, to))).not.toContain('a.com');
  });
});

// --limit is a hard cap on the panel size. Independently computed: 400/100/100 scaled by 15/600 is
// 10/2.5/2.5, which rounds to 10/3/3 = 16 — one over. The largest stratum absorbs the overshoot.
describe('panel size cap', () => {
  it('never builds a panel larger than --limit, and keeps every stratum non-empty', async () => {
    const { scaledTargets } = await import('./build-panel-targets.js');
    for (const limit of [3, 6, 15, 30, 61, 599]) {
      const t = scaledTargets(limit);
      const total = t.cf_ads + t.cf_no_ads + t.ads_no_cf;
      expect(total, `--limit ${limit}`).toBeLessThanOrEqual(limit);
      expect(Math.min(t.cf_ads, t.cf_no_ads, t.ads_no_cf), `--limit ${limit}`).toBeGreaterThanOrEqual(1);
    }
    expect(scaledTargets(15)).toEqual({ cf_ads: 9, cf_no_ads: 3, ads_no_cf: 3 });
    expect(scaledTargets(undefined)).toEqual({ cf_ads: 400, cf_no_ads: 100, ads_no_cf: 100 });
  });
});
