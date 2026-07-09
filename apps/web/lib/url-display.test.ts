import { describe, it, expect } from 'vitest';
import { safeDecodeUrlForDisplay } from './url-display';
import {
  BENGALI_ENCODED_URL,
  BENGALI_DECODED_URL,
  BENGALI_ENCODED_SLUG,
  BENGALI_DECODED_SLUG,
} from './__fixtures__/spec041-fixtures';

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
});
