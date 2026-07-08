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
    expect(html).toContain('leaderboard');
  });

  it('proud copy at/above the threshold', () => {
    const html = renderToStaticMarkup(<ShareSurface grade="B" score={84} shareUrl="https://crawlmouse.com/r/x" />);
    expect(html).toContain('💪');
  });

  it('compact: the on-card impulse row — channels + copy, no leaderboard hook', () => {
    const html = renderToStaticMarkup(<ShareSurface grade="C" score={64} compact shareUrl="https://crawlmouse.com/r/x" />);
    expect(html).toContain('Share your grade:');
    expect(html).toContain('twitter.com/intent');
    expect(html).toContain('Copy link');
    expect(html).not.toContain('leaderboard');
  });

  // SPEC 04 §6 (V11) — the reveal context: mint first, and NEVER share the capability URL.
  it('reveal (auditId, no report URL yet): shows the one-step mint CTA and leaks no capability URL', () => {
    const html = renderToStaticMarkup(<ShareSurface grade="C" score={64} compact auditId="aud-123" />);
    expect(html).toContain('Share your grade'); // the mint CTA label
    expect(html).not.toContain('/audit/'); // the private capability URL is never rendered
    expect(html).not.toContain('twitter.com/intent'); // channel links appear only AFTER minting
  });

  it('report context: shared channel links carry the /r/ URL + a ?ref attribution param (never /audit/)', () => {
    const html = renderToStaticMarkup(<ShareSurface grade="B" score={84} shareUrl="https://crawlmouse.com/r/abc" />);
    expect(html).toContain('%2Fr%2Fabc'); // the /r/ public URL (encoded), not a capability URL
    expect(html).toContain('ref%3Dx'); // ?ref=x attribution (encoded inside the intent href)
    expect(html).not.toContain('/audit/');
  });
});
