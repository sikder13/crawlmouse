import { describe, it, expect, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';

// Client components (useRouter/track) — static-render with stubs (node env, no jsdom).
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: () => {}, refresh: () => {} }) }));
vi.mock('@/lib/analytics', () => ({ track: () => {}, trackRaw: () => {} }));

import { OwnerPanel } from './OwnerPanel';
import { ReportOwnerIsland } from './ReportOwnerIsland';
import type { OwnershipProbe } from '@/lib/report-owner-probe';

const noop = () => {};
const render = (probe: OwnershipProbe | null, reportClaimed = false) =>
  renderToStaticMarkup(
    <OwnerPanel probe={probe} refetch={noop} reportClaimed={reportClaimed} slug="abc" domain="ex.com" />,
  );

// U1 — the panel renders EXACTLY what the probe (R2) + the public claimed flag say. A non-owner sees the
// claim entry ONLY on an unclaimed report; owner controls appear solely for a verified owner.
describe('OwnerPanel view states', () => {
  it('loading (null probe) on an unclaimed report → the claim entry, owner-agnostic', () => {
    const html = render(null, false);
    expect(html).toContain('Claim this report');
    expect(html).not.toContain('You own this report');
  });

  it('non-owner ({owned:false}) on an unclaimed report → the claim entry', () => {
    const html = render({ owned: false }, false);
    expect(html).toContain('Claim this report');
    expect(html).not.toContain('You own this report');
  });

  it('non-owner on a CLAIMED report → nothing (no claim CTA over someone else’s report)', () => {
    expect(render({ owned: false }, true)).toBe('');
    expect(render(null, true)).toBe(''); // pre-hydration on a claimed report is also empty
  });

  it('verified owner, report not yet claimed → finish claiming (not the claim CTA)', () => {
    const html = render({ owned: true, claimed: false, canWhiteLabel: true }, false);
    expect(html).toContain('Finish claiming');
    expect(html).not.toContain('Claim this report');
  });

  it('verified PRO owner of a claimed report → owner controls with the editable white-label form', () => {
    const html = render({ owned: true, claimed: true, canWhiteLabel: true, listed: true, indexable: true, whiteLabel: null }, true);
    expect(html).toContain('You own this report');
    expect(html).toContain('Your branding'); // WhiteLabelControls mounted
    expect(html).toContain('name="brandName"'); // editable (Pro)
    expect(html).not.toContain('Claim this report');
  });

  it('claimed report owned by a FREE user → owner controls with the LOCKED white-label upsell (U3)', () => {
    const html = render({ owned: true, claimed: true, canWhiteLabel: false, listed: true, indexable: true, whiteLabel: null }, true);
    expect(html).toContain('You own this report');
    expect(html).toMatch(/upgrade to pro/i);
    expect(html).not.toContain('name="brandName"'); // locked — no functional input for a free owner
    expect(html).not.toContain('Claim this report');
  });
});

// U10 / V-cache — the island's server-rendered (cached) HTML must be identical for everyone and carry no
// session data. Pre-hydration the probe is null → keyed only on public props (slug/domain/reportClaimed).
describe('ReportOwnerIsland SSR is owner-agnostic (U10)', () => {
  it('unclaimed report → the claim entry, no owner/session data in the static payload', () => {
    const html = renderToStaticMarkup(<ReportOwnerIsland slug="abc" domain="ex.com" reportClaimed={false} />);
    expect(html).toContain('Claim this report');
    expect(html).not.toContain('You own this report');
  });

  it('claimed report → empty static payload (owner controls hydrate client-side only)', () => {
    const html = renderToStaticMarkup(<ReportOwnerIsland slug="abc" domain="ex.com" reportClaimed />);
    expect(html).toBe('');
  });
});
