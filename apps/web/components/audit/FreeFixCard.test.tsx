import { describe, it, expect, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import type { FreeFix } from '@crawlmouse/types';

vi.mock('@/lib/analytics', () => ({ trackRaw: () => {}, track: () => {} }));

import { FreeFixCard } from './FreeFixCard';
import { actionPacketClipboardText } from './result-logic';
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

  // SPEC 04.2 FIX 3b — the packet <pre> body a human READS is now decoded for display too (04.1 rendered
  // it raw, which leaked "%e0…"); the clipboard payload the MACHINE pastes stays the exact, valid,
  // percent-encoded body. Display ≠ copy is intentional (readable on screen, valid on paste).
  it('decodes the target URL AND the packet <pre> body for display; copy payload stays raw + valid (FIX 3b)', () => {
    const base = freeFixture.freeFix as FreeFix;
    const bengali: FreeFix = {
      ...base,
      diagnosis: { ...base.diagnosis, targetTitle: null, targetUrl: BENGALI_ENCODED_URL },
      prescription: {
        ...base.prescription,
        actionPacket: { ...base.prescription.actionPacket, body: `Target page: ${BENGALI_ENCODED_URL}` },
      },
    };
    const html = renderToStaticMarkup(<FreeFixCard freeFix={bengali} />);
    // Every human-facing surface (target chip + <pre> body) shows the decoded, professional URL…
    expect(html).toContain(BENGALI_DECODED_URL);
    // …and NO raw percent-encoding leaks into the rendered page.
    expect(html).not.toContain(BENGALI_ENCODED_URL);
    expect(html).not.toMatch(/%e0%a6/i);
    // The machine/pasteable clipboard payload is untouched — the exact, valid, percent-encoded body.
    expect(actionPacketClipboardText(bengali.prescription.actionPacket)).toBe(bengali.prescription.actionPacket.body);
    expect(actionPacketClipboardText(bengali.prescription.actionPacket)).toContain(BENGALI_ENCODED_URL);
  });
});
