import { describe, it, expect, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';

vi.mock('@/lib/analytics', () => ({ track: () => {}, trackRaw: () => {} }));

import { VisibilityControls } from './VisibilityControls';

const noop = () => {};

// U5 — honest listed/indexable toggles for a claimed report; each reflects the current probe state.
// (The listed toggle fires leaderboard_opt_in / report_hidden via the injectable save helper, unit-tested
// separately; the interaction is exercised in the live smoke.)
describe('VisibilityControls', () => {
  it('renders honest labels and reflects the current state via aria-checked', () => {
    const html = renderToStaticMarkup(<VisibilityControls slug="abc" listed indexable={false} onWrite={noop} />);
    expect(html).toMatch(/listed on leaderboards/i);
    expect(html).toMatch(/indexable by google/i);
    expect(html).toContain('aria-checked="true"'); // listed = on
    expect(html).toContain('aria-checked="false"'); // indexable = off
    expect(html).toContain('role="switch"');
  });
});
