import { describe, it, expect, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import type { ClientAuditV2 } from '@/lib/audit-stream-projection';

vi.mock('@/lib/analytics', () => ({ track: () => {}, trackRaw: () => {} }));

import { ResultView } from './ResultView';
import {
  errorFixture,
  estimateFixture,
  freeFixture,
  xssFixture,
} from './__fixtures__/client-audit-v2';

const render = (audit: ClientAuditV2) =>
  renderToStaticMarkup(<ResultView audit={audit} shareUrl="https://crawlmouse.com/r/x" />);

describe('ResultView — the conversion arc', () => {
  it('U1: free — reveal → gap → free fix → locked wall → share', () => {
    const html = render(freeFixture);
    expect(html).toContain('Your grade is C'); // reveal (live-region)
    expect(html).toContain('you could be a'); // gap
    expect(html).toContain('Free fix unlocked'); // the one free cure
    expect(html).toContain('cures locked'); // the wall
    expect(html).toContain('Share your grade'); // share moment
  });

  it('U2: gated cure data never leaks in the free view', () => {
    const html = render(freeFixture);
    expect(html).not.toContain('since last run'); // monitoring is null → absent
    const packets = (html.match(/Action packet/g) ?? []).length;
    expect(packets).toBe(1); // only the FREE fix's packet; locked cures carry none
  });

  it('U4/U5: estimate — estimate form + the JS-rendered AI-crawler disclosure', () => {
    const html = render(estimateFixture);
    expect(html).toContain('Estimate');
    expect(html).toContain('based on 70 of ~500 pages');
    // Distinctive to the js_rendered disclosure (NOT the FreeFixCard paste line, which also says ChatGPT).
    expect(html).toContain('see exactly what Crawlmouse sees');
  });

  it('U10: a failed audit renders the classified error, not the arc', () => {
    const html = render(errorFixture);
    expect(html).toContain('Try another audit');
    expect(html).not.toContain('Free fix unlocked');
  });

  it('U12: attacker-controlled strings render escaped', () => {
    const html = render(xssFixture);
    expect(html).not.toContain('<script>alert');
    expect(html).toContain('&lt;script&gt;');
  });

  it('U8: STAY beat shows for a signed-out viewer, hidden for a signed-in one', () => {
    // The contract field audit.viewerSignedIn drives it: freeFixture is signed-out (false) → STAY shows.
    expect(render(freeFixture)).toContain('Keep an eye on this grade');
    // A signed-in viewer (viewerSignedIn: true) → hidden.
    const signedIn = { ...freeFixture, viewerSignedIn: true };
    expect(
      renderToStaticMarkup(<ResultView audit={signedIn} shareUrl="https://crawlmouse.com/r/x" />),
    ).not.toContain('Keep an eye on this grade');
  });
});
