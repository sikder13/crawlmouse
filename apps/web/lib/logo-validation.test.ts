import { describe, it, expect } from 'vitest';
import { validateLogo, MAX_LOGO_BYTES, MAX_LOGO_DIMENSION } from './logo-validation';

// SPEC 04 §5/§11 (V10) — white-label logo validation. Server-side, byte-authoritative: an allowlist of
// PNG/JPEG/WebP by MAGIC BYTES, then a structural HEADER DECODE that extracts dimensions (proving the
// bytes really are that format — spoofed magic, SVG/text, and truncated files are rejected) plus a
// dimension bound (decompression-bomb guard). NO SVG (the XSS vector). No full raster decode (no native
// image dep — COGS/D2); header/structure validation is the tight-v1 bar. Fixtures are hand-built minimal
// valid headers so the test proves the parser, not a library.

function u8(...arrs: (number[] | Uint8Array)[]): Uint8Array {
  const flat: number[] = [];
  for (const a of arrs) for (const b of a) flat.push(b as number);
  return Uint8Array.from(flat);
}
const be16 = (n: number) => [(n >>> 8) & 255, n & 255];
const be32 = (n: number) => [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255];
const le16 = (n: number) => [n & 255, (n >>> 8) & 255];
const le24 = (n: number) => [n & 255, (n >>> 8) & 255, (n >>> 16) & 255];
const le32 = (n: number) => [n & 255, (n >>> 8) & 255, (n >>> 16) & 255, (n >>> 24) & 255];
const ascii = (s: string) => [...s].map((c) => c.charCodeAt(0));

const PNG_SIG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
// signature + a well-formed IHDR chunk (len=13, "IHDR", width, height, 8-bit RGBA, no CRC check in v1).
const png = (w: number, h: number) => u8(PNG_SIG, [0, 0, 0, 13], ascii('IHDR'), be32(w), be32(h), [8, 6, 0, 0, 0], [0, 0, 0, 0]);
// SOI + a minimal SOF0 (baseline) segment carrying height/width + EOI.
const jpeg = (w: number, h: number) => u8([0xff, 0xd8], [0xff, 0xc0], be16(17), [8], be16(h), be16(w), [3, 1, 0x22, 0, 2, 0x11, 1, 3, 0x11, 1], [0xff, 0xd9]);
// A REAL-shaped JPEG: APP0 (JFIF) + DQT segments BEFORE SOF0, so the parser must walk/skip segments
// (every camera/tool JPEG looks like this). Guards the `i += 2 + len` segment-skip against regression.
const jpegMulti = (w: number, h: number) => u8(
  [0xff, 0xd8],
  [0xff, 0xe0], be16(16), ascii('JFIF'), [0], [1, 1], [0], be16(1), be16(1), [0, 0], // APP0 (14-byte payload)
  [0xff, 0xdb], be16(4), [0, 0], // DQT (minimal)
  [0xff, 0xc0], be16(17), [8], be16(h), be16(w), [3, 1, 0x22, 0, 2, 0x11, 1, 3, 0x11, 1], // SOF0
  [0xff, 0xd9],
);
// RIFF/WEBP container with the three real subtype headers.
const webpBody = (chunk: Uint8Array) => u8(ascii('RIFF'), le32(4 + chunk.length), ascii('WEBP'), chunk);
const webpVP8X = (w: number, h: number) => webpBody(u8(ascii('VP8X'), le32(10), [0], [0, 0, 0], le24(w - 1), le24(h - 1)));
const webpVP8L = (w: number, h: number) => webpBody(u8(ascii('VP8L'), le32(5), [0x2f], le32((((w - 1) & 0x3fff) | (((h - 1) & 0x3fff) << 14)) >>> 0)));
const webpVP8 = (w: number, h: number) => webpBody(u8(ascii('VP8 '), le32(10), [0, 0, 0], [0x9d, 0x01, 0x2a], le16(w & 0x3fff), le16(h & 0x3fff)));

describe('validateLogo', () => {
  it('accepts a valid PNG and reports format/ext/contentType/dimensions', () => {
    expect(validateLogo(png(320, 100))).toEqual({ ok: true, format: 'png', contentType: 'image/png', ext: 'png', width: 320, height: 100 });
  });

  it('accepts a valid JPEG', () => {
    expect(validateLogo(jpeg(200, 80))).toMatchObject({ ok: true, format: 'jpeg', contentType: 'image/jpeg', ext: 'jpg', width: 200, height: 80 });
  });

  it('accepts a multi-segment JPEG (APP0 + DQT before SOF0) — exercises the marker segment-walk', () => {
    expect(validateLogo(jpegMulti(640, 200))).toMatchObject({ ok: true, format: 'jpeg', width: 640, height: 200 });
  });

  it('accepts WebP VP8X / VP8L / VP8 and decodes each subtype dimension', () => {
    expect(validateLogo(webpVP8X(640, 480))).toMatchObject({ ok: true, format: 'webp', contentType: 'image/webp', ext: 'webp', width: 640, height: 480 });
    expect(validateLogo(webpVP8L(300, 150))).toMatchObject({ ok: true, format: 'webp', width: 300, height: 150 });
    expect(validateLogo(webpVP8(128, 64))).toMatchObject({ ok: true, format: 'webp', width: 128, height: 64 });
  });

  it('REJECTS a RIFF/WEBP container with an unknown subtype fourcc (structural decode fails)', () => {
    expect(validateLogo(webpBody(u8(ascii('VP9 '), le32(10), new Uint8Array(10))))).toMatchObject({ ok: false, reason: 'malformed' });
  });

  it('REJECTS SVG (the XSS vector) — even <?xml-prefixed and bare <svg', () => {
    expect(validateLogo(u8(ascii('<?xml version="1.0"?><svg xmlns="http://www.w3.org/2000/svg"></svg>')))).toMatchObject({ ok: false, reason: 'unsupported_type' });
    expect(validateLogo(u8(ascii('<svg onload=alert(1)></svg>')))).toMatchObject({ ok: false, reason: 'unsupported_type' });
  });

  it('REJECTS other non-allowlisted types (GIF, BMP, plain text)', () => {
    expect(validateLogo(u8(ascii('GIF89a'), [1, 0, 1, 0])).ok).toBe(false);
    expect(validateLogo(u8([0x42, 0x4d, 0, 0, 0, 0, 0, 0])).ok).toBe(false);
    expect(validateLogo(u8(ascii('hello world, definitely not an image at all'))).ok).toBe(false);
  });

  it('REJECTS spoofed magic bytes (PNG signature, but no IHDR chunk)', () => {
    expect(validateLogo(u8(PNG_SIG, ascii('NOThereIHDRabsent....'))).ok).toBe(false);
  });

  it('REJECTS an oversize file (> 200 KB) even with a valid header', () => {
    const big = u8(png(10, 10), new Uint8Array(MAX_LOGO_BYTES));
    expect(validateLogo(big)).toMatchObject({ ok: false, reason: 'too_large' });
  });

  it('REJECTS empty / header-only input', () => {
    expect(validateLogo(new Uint8Array(0))).toMatchObject({ ok: false, reason: 'empty' });
    expect(validateLogo(Uint8Array.from(PNG_SIG)).ok).toBe(false); // signature only → malformed
  });

  it('REJECTS zero dimensions and dimensions over the bomb-guard max', () => {
    expect(validateLogo(png(0, 100))).toMatchObject({ ok: false, reason: 'bad_dimensions' });
    expect(validateLogo(png(MAX_LOGO_DIMENSION + 1, 10))).toMatchObject({ ok: false, reason: 'bad_dimensions' });
    expect(validateLogo(webpVP8X(MAX_LOGO_DIMENSION + 1, 10))).toMatchObject({ ok: false, reason: 'bad_dimensions' });
  });
});
