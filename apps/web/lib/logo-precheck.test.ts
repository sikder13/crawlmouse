import { describe, it, expect } from 'vitest';
import { logoClientPrecheck, LOGO_MAX_BYTES } from './logo-precheck';

// U4 — the client pre-check is a UX nicety only (reject the obvious SVG/oversize before an upload round
// trip). The SERVER byte-validation (magic bytes + decode, no SVG, ≤200KB) remains the authoritative gate.
describe('logoClientPrecheck', () => {
  it('accepts png/jpeg/webp within the size limit', () => {
    expect(logoClientPrecheck({ type: 'image/png', size: 1000 })).toEqual({ ok: true });
    expect(logoClientPrecheck({ type: 'image/jpeg', size: 1000 })).toEqual({ ok: true });
    expect(logoClientPrecheck({ type: 'image/webp', size: 1000 })).toEqual({ ok: true });
  });

  it('rejects SVG and other types for UX (the server also rejects — no SVG is load-bearing XSS defense)', () => {
    expect(logoClientPrecheck({ type: 'image/svg+xml', size: 100 })).toEqual({ ok: false, reason: 'type' });
    expect(logoClientPrecheck({ type: 'application/pdf', size: 100 })).toEqual({ ok: false, reason: 'type' });
  });

  it('rejects a file over the 200KB limit', () => {
    expect(logoClientPrecheck({ type: 'image/png', size: LOGO_MAX_BYTES + 1 })).toEqual({ ok: false, reason: 'size' });
  });
});
