import { describe, it, expect, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';

vi.mock('@/lib/analytics', () => ({ track: () => {}, trackRaw: () => {} }));

import { WhiteLabelVisibilityPrompt } from './WhiteLabelVisibilityPrompt';

// U5 — the moment white-label turns ON, ask keep-private vs keep-public, defaulting to PRIVATE (the
// recommended, one-tap common case for a client deliverable). Never a silent flip; the owner can change
// it later from the visibility controls.
describe('WhiteLabelVisibilityPrompt', () => {
  it('offers both choices and marks Private as the recommended default', () => {
    const html = renderToStaticMarkup(<WhiteLabelVisibilityPrompt slug="abc" onResolved={() => {}} />);
    expect(html).toMatch(/private client deliverable/i);
    expect(html).toMatch(/keep it private/i);
    expect(html).toMatch(/keep it public/i);
    expect(html).toMatch(/recommended/i); // Private is the emphasized default
  });
});
