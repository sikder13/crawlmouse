import { describe, it, expect, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import type { FreeFix } from '@crawlmouse/types';

vi.mock('@/lib/analytics', () => ({ trackRaw: () => {}, track: () => {} }));

import { FreeFixCard } from './FreeFixCard';
import { freeFixture, xssFixture } from './__fixtures__/client-audit-v2';

describe('FreeFixCard', () => {
  it('renders the free cure end-to-end (target, links, packet, copy)', () => {
    const html = renderToStaticMarkup(<FreeFixCard freeFix={freeFixture.freeFix as FreeFix} />);
    expect(html).toContain('Free fix unlocked');
    expect(html).toContain('Pricing'); // target title
    expect(html).toContain('see our pricing'); // suggested anchor
    expect(html).toContain('Copy for ChatGPT / Claude'); // copy control
    expect(html).toContain('orphaned Pricing page'); // packet body excerpt
    expect(html).toContain('whitespace-pre-wrap'); // packet wraps (not a cramped scroll box)
  });

  it('escapes attacker-controlled crawled strings (U12)', () => {
    const html = renderToStaticMarkup(<FreeFixCard freeFix={xssFixture.freeFix as FreeFix} />);
    expect(html).not.toContain('<script>alert'); // never raw
    expect(html).toContain('&lt;script&gt;'); // escaped
    expect(html).not.toContain('dangerouslySetInnerHTML');
  });
});
