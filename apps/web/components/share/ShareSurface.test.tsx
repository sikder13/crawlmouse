import { describe, it, expect, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';

vi.mock('@/lib/analytics', () => ({ track: () => {}, trackRaw: () => {} }));

import { ShareSurface } from './ShareSurface';
import { estimateFixture, freeFixture } from '../audit/__fixtures__/client-audit-v2';

describe('ShareSurface', () => {
  it('is grade-forward, multi-channel, and challenge-framed for a low grade', () => {
    const html = renderToStaticMarkup(<ShareSurface audit={freeFixture} shareUrl="https://crawlmouse.com/r/abc" />);
    expect(html).toContain('👀'); // challenge copy (C/64 is below the proud threshold)
    expect(html).toContain('twitter.com/intent');
    expect(html).toContain('linkedin.com/sharing');
    expect(html).toContain('wa.me');
    expect(html).toContain('t.me/share');
    expect(html).toContain('facebook.com/sharer');
    expect(html).toContain('Copy link');
    expect(html).toContain('leaderboard');
  });

  it('is a proud flex at/above the threshold', () => {
    const html = renderToStaticMarkup(<ShareSurface audit={estimateFixture} shareUrl="https://crawlmouse.com/r/x" />);
    expect(html).toContain('💪'); // estimate fixture is B/84 ≥ 70
  });
});
