import { describe, it, expect, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';

vi.mock('@/lib/analytics', () => ({ trackRaw: () => {}, track: () => {} }));

import { TrackedDetails } from './TrackedDetails';

describe('TrackedDetails', () => {
  it('renders a <details>/<summary> disclosure with the summary + children', () => {
    const html = renderToStaticMarkup(
      <TrackedDetails event="ai_finding_expanded" summary="How is this measured?">
        <p>Body copy.</p>
      </TrackedDetails>,
    );
    expect(html).toContain('<details');
    expect(html).toContain('<summary');
    expect(html).toContain('How is this measured?');
    expect(html).toContain('Body copy.');
    expect(html).toContain('cursor-pointer');
  });
});
