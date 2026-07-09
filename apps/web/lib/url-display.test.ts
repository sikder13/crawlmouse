import { describe, it, expect } from 'vitest';
import { safeDecodeUrlForDisplay, decodeActionPacketBodyForDisplay } from './url-display';
import {
  BENGALI_ENCODED_URL,
  BENGALI_DECODED_URL,
  BENGALI_ENCODED_SLUG,
  BENGALI_DECODED_SLUG,
  NON_ASCII_URL_SAMPLES,
} from './__fixtures__/spec041-fixtures';

const PERCENT_ESCAPE = /%[0-9a-fA-F]{2}/;

// U9 — DISPLAY-ONLY decode. Percent-encoded (i18n) URLs render human-readable on the result cards +
// action-packet chips; malformed input falls back to raw and NEVER throws; stored/href/packet payload
// values are decoded elsewhere-never (this helper is only ever wrapped around display text).
describe('safeDecodeUrlForDisplay', () => {
  it('decodes a percent-encoded Bengali URL / slug for display', () => {
    expect(safeDecodeUrlForDisplay(BENGALI_ENCODED_URL)).toBe(BENGALI_DECODED_URL);
    expect(safeDecodeUrlForDisplay(BENGALI_ENCODED_SLUG)).toBe(BENGALI_DECODED_SLUG);
  });

  it('falls back to the raw string on a malformed percent sequence (never throws)', () => {
    expect(safeDecodeUrlForDisplay('%zz')).toBe('%zz');
    expect(safeDecodeUrlForDisplay('career-%e0%a6')).toBe('career-%e0%a6'); // truncated multibyte
  });

  it('passes plain ASCII through unchanged', () => {
    expect(safeDecodeUrlForDisplay('https://example.com/pricing')).toBe('https://example.com/pricing');
  });

  // SPEC 04.2 FIX 3 — the leak is non-ASCII-wide; prove decode is language-agnostic across scripts.
  it('decodes every non-ASCII script (Bengali, Arabic, Chinese, Cyrillic, accented-Latin)', () => {
    for (const s of NON_ASCII_URL_SAMPLES) {
      expect(safeDecodeUrlForDisplay(s.encodedUrl)).toBe(s.decodedUrl);
      expect(safeDecodeUrlForDisplay(s.encodedUrl)).not.toMatch(PERCENT_ESCAPE);
    }
  });

  it('never throws on malformed / truncated / lone-% input — falls back to the raw string', () => {
    expect(safeDecodeUrlForDisplay('%zz')).toBe('%zz'); // invalid hex
    expect(safeDecodeUrlForDisplay('50% off')).toBe('50% off'); // lone %
    expect(safeDecodeUrlForDisplay('caf%c3')).toBe('caf%c3'); // truncated mid-codepoint
  });

  it('leaves an ALREADY-decoded non-ASCII URL unchanged (no double-decode / mangle)', () => {
    for (const s of NON_ASCII_URL_SAMPLES) {
      expect(safeDecodeUrlForDisplay(s.decodedUrl)).toBe(s.decodedUrl);
    }
  });

  it('decodes an encoded path embedded in surrounding prose without touching the prose', () => {
    expect(safeDecodeUrlForDisplay('Fetched /caf%c3%a9 just now')).toBe('Fetched /café just now');
  });
});

// SPEC 04.2 FIX 3b — DISPLAY-ONLY decode of the multi-line action-packet body (the <pre> a human reads).
// Decodes each line independently so a prose line with a stray "%" (e.g. a "50% off" page title) can't
// throw and block URL-line decoding. NEVER used for the clipboard payload (that stays the raw packet.body).
describe('decodeActionPacketBodyForDisplay', () => {
  it('decodes URL lines while a prose line with a bare % is left intact', () => {
    const body = [
      '## Fix: add internal links to "50% off deals"', // prose line, bare % (would throw alone)
      `Target page: ${BENGALI_ENCODED_URL}`,
      `   URL: ${BENGALI_ENCODED_URL}`,
    ].join('\n');
    const out = decodeActionPacketBodyForDisplay(body);
    expect(out).toContain('## Fix: add internal links to "50% off deals"'); // prose untouched
    expect(out).toContain(BENGALI_DECODED_URL); // URL lines decoded for the reader
    expect(out).not.toContain(BENGALI_ENCODED_URL);
    expect(out).not.toMatch(/%e0%a6/i);
  });

  it('preserves line structure (no lines added or dropped)', () => {
    const body = 'a\nb\nc';
    expect(decodeActionPacketBodyForDisplay(body).split('\n')).toHaveLength(3);
  });

  it('decodes packet-body URL lines for every non-ASCII script (matrix)', () => {
    for (const s of NON_ASCII_URL_SAMPLES) {
      const out = decodeActionPacketBodyForDisplay(`Target page: ${s.encodedUrl}\n   URL: ${s.encodedUrl}`);
      expect(out).toContain(s.decodedUrl);
      expect(out).not.toMatch(PERCENT_ESCAPE);
    }
  });
});
