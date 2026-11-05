/**
 * Regression on rows the worker produced: the staging smoke's one access batch (observed), the five
 * discriminator sites' recorded shapes and three edge-default shapes run through the worker, and the
 * NPR batch derived from the smoke (see each file's `provenance`).
 */
import type { Verdict } from '@crawlmouse/types/v2';
import { describe, expect, it } from 'vitest';
import { fixtureInput, TESTABLE } from '../../../fixtures/v2/access/builders.js';
import { detectAccess } from './index.js';
import type { AccessResult } from './types.js';

const verdicts = (r: AccessResult) => Object.fromEntries(r.crawlers.map((c) => [c.ua, c.verdict]));
const detection = (r: AccessResult, type: string, crawler: string) =>
  r.detections.find((d) => d.type === type && d.crawler === crawler)!;
const edge = (r: AccessResult, crawler: string) =>
  detection(r, 'edge_rule_blocks_crawler', crawler);
const robots = (r: AccessResult, crawler: string) =>
  detection(r, 'robots_txt_blocks_crawler', crawler);
const all = (v: Verdict) => Object.fromEntries(TESTABLE.map((t) => [t, v]));

describe('info.cern.ch, observed on staging (a clean site)', () => {
  const r = detectAccess(fixtureInput('cern-staging-smoke.json'));

  it('every crawler is allowed, the search engines from robots.txt, the rest from their requests', () => {
    expect(verdicts(r)).toEqual({ Googlebot: 'allowed', Bingbot: 'allowed', ...all('allowed') });
    expect(r.crawlers.find((c) => c.ua === 'Googlebot')).toMatchObject({
      evidence_class: 'declared',
      status: null,
      pages_measured: 2,
    });
    expect(r.crawlers.find((c) => c.ua === 'GPTBot')).toMatchObject({
      evidence_class: 'simulated',
      status: 200,
      pages_measured: 2,
      confidence: 'likely',
    });
  });

  it('nothing fires, and every detector decides', () => {
    expect(r.detections.filter((d) => d.state !== 'not_detected')).toEqual([]);
    expect(r.detections).toHaveLength(TESTABLE.length * 2 + 2);
    expect(r.access_withheld).toBe(false);
  });
});

describe('nike.com shape: the canary is refused, but Claude-SearchBot is served, so four refusals are user-agent rules', () => {
  const r = detectAccess(fixtureInput('nike-com-shape.json'));
  const refused = ['OAI-SearchBot', 'ChatGPT-User', 'PerplexityBot', 'GPTBot'];

  it('the site verdicts are the worker’s, unchanged', () => {
    expect(verdicts(r)).toMatchObject({
      ...Object.fromEntries(refused.map((t) => [t, 'blocked_by_ua_rule'])),
      'Claude-SearchBot': 'allowed',
      ClaudeBot: 'allowed',
    });
  });

  it.each(refused)('%s: blocked at the edge on every page, while robots.txt allows it', (t) => {
    expect(edge(r, t)).toMatchObject({
      state: 'detected',
      measured: 1,
      opens_fix: true,
      confidence: 'likely',
    });
    expect(edge(r, t).evidence.access_test_ids).toHaveLength(20);
    expect(robots(r, t).state).toBe('not_detected');
  });

  it('four scored crawlers are measured, so the access score is given', () => {
    expect(r.scored_measured).toBe(4);
    expect(r.access_withheld).toBe(false);
  });
});

describe('en.wikipedia.org shape', () => {
  const r = detectAccess(fixtureInput('en-wikipedia-org-shape.json'));
  it('ClaudeBot alone is refused, and the other five served from the same address make it a rule', () => {
    expect(verdicts(r)).toMatchObject({ ...all('allowed'), ClaudeBot: 'blocked_by_ua_rule' });
    expect(edge(r, 'ClaudeBot')).toMatchObject({ state: 'detected', measured: 1 });
    expect(edge(r, 'GPTBot')).toMatchObject({ state: 'not_detected', measured: 0 });
  });
});

describe('css-tricks.com shape: the canary is served, so each refusal is a user-agent rule', () => {
  const r = detectAccess(fixtureInput('css-tricks-com-shape.json'));
  it.each(TESTABLE)('%s: blocked at the edge on every page, while robots.txt allows it', (t) => {
    expect(r.crawlers.find((c) => c.ua === t)).toMatchObject({
      verdict: 'blocked_by_ua_rule',
      status: 403,
      confidence: 'likely',
      pages_measured: 20,
    });
    expect(edge(r, t)).toMatchObject({
      state: 'detected',
      measured: 1,
      opens_fix: true,
      confidence: 'likely',
    });
    expect(robots(r, t)).toMatchObject({ state: 'not_detected', measured: 0 });
  });
  it('fewer than two scored crawlers are not the case here: four blocked are four measured', () => {
    expect(r.access_withheld).toBe(false);
  });
});

describe('neilpatel.com shape: challenged on 17 of 20 pages, served on 3', () => {
  const r = detectAccess(fixtureInput('neilpatel-com-shape.json'));
  it.each(TESTABLE)('%s: challenged, with the extent, and never a block', (t) => {
    const row = r.crawlers.find((c) => c.ua === t)!;
    expect(row).toMatchObject({
      verdict: 'challenged_ua',
      cause: 'automation_challenge',
      counts: { challenged_ua: 17, allowed: 3 },
    });
    expect(row.supporting.pages).toHaveLength(17);
    expect(edge(r, t)).toMatchObject({
      state: 'indeterminate',
      reason: 'challenge_real_crawler_may_pass',
      measured: 0,
    });
  });
});

describe('cnn.com shape: robots.txt disallows the six', () => {
  const r = detectAccess(fixtureInput('cnn-com-shape.json'));
  it.each(TESTABLE)('%s: a respected block, and the edge is not tested', (t) => {
    expect(r.crawlers.find((c) => c.ua === t)).toMatchObject({
      verdict: 'disallowed_by_robots',
      evidence_class: 'declared',
      status: null,
      intent: 'respected',
    });
    expect(robots(r, t)).toMatchObject({
      state: 'detected',
      measured: 1,
      intent: 'respected',
      opens_fix: false,
      recommendation_class: 'documented_requirement',
    });
    expect(edge(r, t)).toMatchObject({ state: 'indeterminate', reason: 'robots_disallows' });
  });
});

describe('the edge default: robots.txt and the control allow, the edge refuses', () => {
  const r = detectAccess(fixtureInput('edge-default-ua-rule.json'));

  it.each(['GPTBot', 'ClaudeBot'])('%s: the firewall rule is named with its response', (t) => {
    expect(edge(r, t)).toMatchObject({
      state: 'detected',
      measured: 1,
      evidence: {
        causes: ['cloudflare_1020'],
        signatures: ['cf-ray', 'server: cloudflare'],
      },
    });
    expect(robots(r, t)).toMatchObject({ state: 'not_detected', measured: 0 });
  });

  it('ChatGPT-User: challenged, the challenge header quoted, not called a block', () => {
    expect(edge(r, 'ChatGPT-User')).toMatchObject({
      state: 'indeterminate',
      reason: 'challenge_real_crawler_may_pass',
      evidence: {
        causes: ['automation_challenge'],
        signatures: ['cf-mitigated: challenge', 'cf-ray', 'server: cloudflare'],
      },
    });
  });

  it('robots.txt is never blamed for an edge refusal', () => {
    for (const d of r.detections.filter((x) => x.type === 'edge_rule_blocks_crawler'))
      expect(d.evidence.causes).not.toContain('robots_txt_disallow');
    // The fixture has no crawled pages, so only the crawlers requested as have robots.txt readings.
    const requested = r.detections.filter(
      (d) => d.type === 'robots_txt_blocks_crawler' && TESTABLE.includes(d.crawler),
    );
    expect(requested.map((d) => d.state)).toEqual(TESTABLE.map(() => 'not_detected'));
  });
});

describe('the edge default when three crawlers and the canary are refused, and three served', () => {
  const r = detectAccess(fixtureInput('edge-default-witnessed.json'));
  it.each(['GPTBot', 'ClaudeBot', 'ChatGPT-User'])('%s: a user-agent rule, edge named', (t) => {
    expect(edge(r, t)).toMatchObject({
      state: 'detected',
      measured: 1,
      evidence: { causes: [], signatures: ['server: cloudflare'] },
    });
  });
});

describe('the edge default when every crawler and the canary are refused', () => {
  const r = detectAccess(fixtureInput('edge-default-unverified.json'));
  it.each(TESTABLE)('%s: unverified, edge named', (t) => {
    expect(edge(r, t)).toMatchObject({
      state: 'indeterminate',
      reason: 'refusal_unverified',
      evidence: { causes: [], signatures: ['server: cloudflare'] },
    });
  });
});

describe('www.npr.org, DERIVED: robots.txt timed out, so nothing was requested', () => {
  const r = detectAccess(fixtureInput('npr-robots-unreachable.json'));
  it('every crawler is not measured, and nothing is claimed about it', () => {
    expect(verdicts(r)).toMatchObject(all('not_measured'));
    for (const t of TESTABLE) {
      expect(edge(r, t)).toMatchObject({ state: 'indeterminate', reason: 'not_measured' });
      expect(robots(r, t)).toMatchObject({ state: 'indeterminate', reason: 'robots_not_read' });
    }
  });
  it('no scored crawler was measured, so the access score is withheld', () => {
    expect(r.scored_measured).toBe(0);
    expect(r.access_withheld).toBe(true);
  });
});
