import { describe, it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { CureWall } from './CureWall';
import { freeFixture, proOwnerFixture } from './__fixtures__/client-audit-v2';

describe('CureWall', () => {
  it('free: locked cures + count + Pro upgrade; no cure content leaks (U2)', () => {
    const html = renderToStaticMarkup(<CureWall audit={freeFixture} />);
    expect(html).toContain('5 more fixes'); // 6 ledger − 1 free fix
    expect(html).toContain('The Internal Linking Guide'); // a locked target (diagnosis)
    expect(html).toContain('Unlock Pro'); // the wall's CTA
    expect(html).not.toContain('Open your dashboard');
    // cure content must never appear behind the wall
    expect(html).not.toContain('Copy for ChatGPT');
    expect(html).not.toContain('with anchor');
  });

  it('pro-owner: points to the dashboard workspace, no locked wall', () => {
    const html = renderToStaticMarkup(<CureWall audit={proOwnerFixture} />);
    expect(html).toContain('Open your dashboard');
    expect(html).not.toContain('cures locked');
    expect(html).not.toContain('Unlock Pro');
  });
});
