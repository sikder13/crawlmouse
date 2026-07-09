import { describe, it, expect, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import type { FreeFix } from '@crawlmouse/types';

vi.mock('@/lib/analytics', () => ({ trackRaw: () => {}, track: () => {} }));

import { FreeFixCard } from './FreeFixCard';
import { freeFixture, xssFixture } from './__fixtures__/client-audit-v2';
import { BENGALI_ENCODED_URL, BENGALI_DECODED_URL } from '@/lib/__fixtures__/spec041-fixtures';

describe('FreeFixCard', () => {
  it('renders the free cure end-to-end (target, links, packet, copy)', () => {
    const html = renderToStaticMarkup(<FreeFixCard freeFix={freeFixture.freeFix as FreeFix} />);
    expect(html).toContain('Free fix unlocked');
    expect(html).toContain('Pricing'); // target title
    expect(html).toContain('see our pricing'); // suggested anchor
    expect(html).toContain('Copy for ChatGPT / Claude'); // copy control
    expect(html).toContain('orphaned Pricing page'); // packet body excerpt
    expect(html).toContain('whitespace-pre-wrap'); // packet wraps (not a cramped scroll box)
    expect(html).toContain('any AI assistant'); // worldwide / bring-your-own framing (§6)
  });

  it('escapes attacker-controlled crawled strings (U12)', () => {
    const html = renderToStaticMarkup(<FreeFixCard freeFix={xssFixture.freeFix as FreeFix} />);
    expect(html).not.toContain('<script>alert'); // never raw
    expect(html).toContain('&lt;script&gt;'); // escaped
    expect(html).not.toContain('dangerouslySetInnerHTML');
  });

  it('decodes a percent-encoded (Bengali) target URL for display, leaving the packet payload raw (U9)', () => {
    const base = freeFixture.freeFix as FreeFix;
    const bengali: FreeFix = {
      ...base,
      diagnosis: { ...base.diagnosis, targetTitle: null, targetUrl: BENGALI_ENCODED_URL },
      prescription: {
        ...base.prescription,
        actionPacket: { ...base.prescription.actionPacket, body: `Add an internal link to ${BENGALI_ENCODED_URL}` },
      },
    };
    const html = renderToStaticMarkup(<FreeFixCard freeFix={bengali} />);
    expect(html).toContain(BENGALI_DECODED_URL); // display decoded (the only source of the decoded form)
    expect(html).toContain(BENGALI_ENCODED_URL); // the action-packet machine/pasteable payload stays raw + valid
  });
});
