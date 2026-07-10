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

  it('SPEC 04.3 — a truncated-mid-escape multibyte renders "…", never the raw %xx (never throws)', () => {
    expect(safeDecodeUrlForDisplay('career-%e0%a6')).toBe('career-…'); // 2 of a 3-byte seq → ellipsis
    expect(safeDecodeUrlForDisplay('%zz')).toBe('%zz'); // '%' + non-hex → literal, unchanged
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

  it('SPEC 04.3 — never throws; literal "%" stays literal, truncated escape / dangling half-codepoint → "…"', () => {
    expect(safeDecodeUrlForDisplay('%zz')).toBe('%zz'); // '%' + non-hex → literal
    expect(safeDecodeUrlForDisplay('50% off')).toBe('50% off'); // lone % (protected)
    expect(safeDecodeUrlForDisplay('caf%c3')).toBe('caf…'); // truncated mid-codepoint → ellipsis
    expect(safeDecodeUrlForDisplay('/wiki/%D0%A1%D1')).toBe('/wiki/С…'); // complete escape, dangling lead byte → ellipsis
    expect(safeDecodeUrlForDisplay('/wiki/%D0%A1%')).toBe('/wiki/С…'); // trailing bare '%' → ellipsis
  });

  it('leaves an ALREADY-decoded non-ASCII URL unchanged (no double-decode / mangle)', () => {
    for (const s of NON_ASCII_URL_SAMPLES) {
      expect(safeDecodeUrlForDisplay(s.decodedUrl)).toBe(s.decodedUrl);
    }
  });

  it('decodes an encoded path embedded in surrounding prose without touching the prose', () => {
    expect(safeDecodeUrlForDisplay('Fetched /caf%c3%a9 just now')).toBe('Fetched /café just now');
  });

  // SPEC 04.3 — the CLASS made extinct. Truncation mid-%XX (the feed's label cap + the engine's anchorText
  // cap) makes decodeURIComponent THROW → the whole string fell back RAW. Property: for a dense mixed-script
  // URL, EVERY truncation point i must (a) never throw, (b) never leave a raw %XX visible, (c) never end in a
  // bare U+FFFD. This FAILS against the old all-or-nothing helper (any mid-escape prefix → raw → contains %XX).
  it('property: no truncation of a mixed-script URL leaks a raw %xx, throws, or ends in U+FFFD', () => {
    const decoded = 'Судан مرحبا 价格 café "Новая Голландия" Ængård';
    const enc = encodeURIComponent(decoded); // Cyrillic + Arabic + CJK + accented + quotes + spaces → dense %XX
    for (let i = 1; i <= enc.length; i++) {
      const prefix = enc.slice(0, i);
      let out = '';
      expect(() => {
        out = safeDecodeUrlForDisplay(prefix);
      }).not.toThrow();
      expect(out).not.toMatch(/%[0-9A-Fa-f]{2}/); // (b) no raw escape survives
      expect(out.endsWith('�')).toBe(false); // (c) no bare replacement char at the end
    }
  });

  // SPEC 04.3 — the four exact cases from the owner's prod screenshots, pinned as regression fixtures.
  it('pins the prod truncation cases: mid-escape → decoded prefix + "…"; complete → decodes; literal % untouched', () => {
    expect(safeDecodeUrlForDisplay(encodeURIComponent('Wiki "Новая Голлан') + '%D0%B')).toBe('Wiki "Новая Голлан…');
    expect(safeDecodeUrlForDisplay('/wiki/' + encodeURIComponent('Проект:Избранн') + '%D1%8')).toBe('/wiki/Проект:Избранн…');
    expect(safeDecodeUrlForDisplay('/wiki/%D0%A1%D1%83%D0%B4%D0%B0%D0%BD')).toBe('/wiki/Судан');
    expect(safeDecodeUrlForDisplay('50% off all plans')).toBe('50% off all plans');
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
