/**
 * Goal 1 rule 2 on the public pages: a feature named in `V2_HIDE_FEATURES` disappears from Pricing
 * and For agencies, and nothing else changes. With the variable unset both pages read as before.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { RISK_FEATURES } from '../../feature-switch';
import { CAPABILITIES } from './agencies';
import { agenciesView } from './agencies';
import { pricingView } from './pricing';

const NOW = new Date('2026-11-24T12:00:00Z');
const FLAGS = { billing: true, checksPublic: true } as Parameters<typeof pricingView>[3];

const pricingText = () => JSON.stringify(pricingView({ kind: 'signed_out' }, 'month', NOW, FLAGS));
const agenciesText = () => JSON.stringify(agenciesView({ billing: true, accountDoor: true }));

afterEach(() => vi.unstubAllEnvs());

describe('the switch on Pricing and For agencies', () => {
  it('unset, the pages still name competitors, 2,000 pages and client reports', () => {
    expect(pricingText()).toMatch(/competitor/i);
    expect(pricingText()).toContain('2,000 pages');
    expect(agenciesText()).toMatch(/client report/i);
  });

  it('competitors hidden: no competitor sentence on either page', () => {
    vi.stubEnv('V2_HIDE_FEATURES', 'competitors');
    expect(pricingText()).not.toMatch(/competitor/i);
    expect(agenciesText()).not.toMatch(/competitor/i);
  });

  it('pages_2000 hidden: paid plans say the free page limit, and 2,000 appears nowhere', () => {
    vi.stubEnv('V2_HIDE_FEATURES', 'pages_2000');
    expect(pricingText()).not.toContain('2,000');
    expect(agenciesText()).not.toContain('2,000');
    expect(pricingText()).toContain('Up to 500 pages per audit');
  });

  it('staging_deploys hidden: no staging or preview sentence', () => {
    vi.stubEnv('V2_HIDE_FEATURES', 'staging_deploys');
    expect(pricingText()).not.toMatch(/staging|preview URL/i);
  });

  it('every RISK capability names a feature the switch knows', () => {
    for (const [key, c] of Object.entries(CAPABILITIES))
      if (c.risk) expect(RISK_FEATURES, key).toContain(c.risk);
  });

  it('every name the switch knows hides something on these pages, or is said to be elsewhere', () => {
    const onThesePages = new Set(
      Object.values(CAPABILITIES).flatMap((c) => (c.risk ? [c.risk] : [])),
    );
    onThesePages.add('pages_2000');
    const elsewhere = RISK_FEATURES.filter((f) => !onThesePages.has(f));
    // Named on the result and home screens, not in these capability tables.
    expect(elsewhere.sort()).toEqual(['ai_letter', 'nojs', 'sentinel']);
  });
});
