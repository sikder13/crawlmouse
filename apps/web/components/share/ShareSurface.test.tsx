import { describe, it, expect, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';

vi.mock('@/lib/analytics', () => ({ track: () => {}, trackRaw: () => {} }));

import { ShareSurface } from './ShareSurface';

describe('ShareSurface', () => {
  it('full: grade-forward, multi-channel, challenge-framed for a low grade', () => {
    const html = renderToStaticMarkup(<ShareSurface grade="C" score={64} shareUrl="https://crawlmouse.com/r/abc" />);
    expect(html).toContain('👀'); // challenge copy (below the proud threshold)
    expect(html).toContain('twitter.com/intent');
    expect(html).toContain('linkedin.com/sharing');
    expect(html).toContain('wa.me');
    expect(html).toContain('t.me/share');
    expect(html).toContain('facebook.com/sharer');
    expect(html).toContain('Copy link');
    expect(html).toContain('Get your free report'); // U7 — the section names the artifact
    expect(html).not.toContain('Verify your domain to mint'); // U7 — the false verify-to-mint line is gone
  });

  it('proud copy at/above the threshold', () => {
    const html = renderToStaticMarkup(<ShareSurface grade="B" score={84} shareUrl="https://crawlmouse.com/r/x" />);
    expect(html).toContain('💪');
  });

  it('compact: the on-card impulse row — channels + copy, no leaderboard hook', () => {
    const html = renderToStaticMarkup(<ShareSurface grade="C" score={64} compact shareUrl="https://crawlmouse.com/r/x" />);
    expect(html).toContain('Share it:');
    expect(html).toContain('twitter.com/intent');
    expect(html).toContain('Copy link');
    expect(html).not.toContain('leaderboard');
  });

  // SPEC 04 §6 (V11) — the reveal context: mint first, and NEVER share the capability URL.
  it('reveal (auditId, no report URL yet): shows the one-step mint CTA and leaks no capability URL', () => {
    const html = renderToStaticMarkup(<ShareSurface grade="C" score={64} compact auditId="aud-123" />);
    expect(html).toContain('Get your free report'); // U7 — the one-click mint CTA names the artifact
    expect(html).not.toContain('/audit/'); // the private capability URL is never rendered
    expect(html).not.toContain('twitter.com/intent'); // channel links appear only AFTER minting
  });

  // U7 — free users must be able to find, view, and download their report (not guess the share button).
  it('surfaces a "View your report" link to the /r/ page + a PDF mention once a report URL exists', () => {
    const html = renderToStaticMarkup(<ShareSurface grade="B" score={84} shareUrl="https://crawlmouse.com/r/abc" />);
    expect(html).toContain('View your report');
    expect(html).toContain('/r/abc');
    expect(html).toMatch(/PDF/i);
  });

  it('report context: shared channel links carry the /r/ URL + a ?ref attribution param (never /audit/)', () => {
    const html = renderToStaticMarkup(<ShareSurface grade="B" score={84} shareUrl="https://crawlmouse.com/r/abc" />);
    expect(html).toContain('%2Fr%2Fabc'); // the /r/ public URL (encoded), not a capability URL
    expect(html).toContain('ref%3Dx'); // ?ref=x attribution (encoded inside the intent href)
    expect(html).not.toContain('/audit/');
  });

  // SPEC 04.3 — the top grade card's POST-MINT compact state must keep the CTA's promise: the user's
  // click on "Get your free report" landed HERE, so this spot must still yield the report path. It renders
  // a PRIMARY "View your report →" link to /r/<slug> alongside the (now-secondary) share row — consistent
  // with the lower card's "View your report" copy. Pre-mint (the mint CTA) is unchanged.
  it('compact POST-MINT: a primary "View your report" link to the /r/ page sits alongside the share row', () => {
    const html = renderToStaticMarkup(<ShareSurface grade="C" score={64} compact shareUrl="https://crawlmouse.com/r/postmint" />);
    expect(html).toContain('View your report'); // the report affordance, at the exact spot the user clicked
    expect(html).toContain('/r/postmint'); // → the public report page, never the capability URL
    expect(html).toContain('Share it:'); // the share row stays (secondary)
    expect(html).not.toContain('/audit/'); // never the private capability URL
  });

  it('compact PRE-MINT is unchanged: the mint CTA, no report link yet', () => {
    const html = renderToStaticMarkup(<ShareSurface grade="C" score={64} compact auditId="aud-123" />);
    expect(html).toContain('Get your free report'); // the 04.2 FIX 4 pre-mint CTA
    expect(html).not.toContain('View your report'); // no report exists before minting
    expect(html).not.toContain('/r/'); // no report URL pre-mint
  });
});
