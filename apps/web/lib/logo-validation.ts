// SPEC 04 §5/§11 (V10) — white-label logo validation. Server-side and BYTE-AUTHORITATIVE (the client's
// declared Content-Type is never trusted): an allowlist of PNG / JPEG / WebP detected by MAGIC BYTES,
// then a structural HEADER DECODE that extracts the image dimensions. Extracting dimensions proves the
// byte stream really is that format — a file with spoofed magic bytes, an SVG (`<svg …>` — the XSS
// vector, explicitly excluded), or a truncated/garbage body fails the parse. A dimension bound then
// guards against a decompression-bomb header. This is deliberately NOT a full raster decode: there is
// no native image dependency in this serverless app (COGS / D2), and header/structure validation is the
// tight-v1 bar (§5). The uploader is a claim-verified, paying, identified owner, so the abuse surface is
// already narrow; this stops the type-confusion + active-content (SVG) risks that matter.

export const MAX_LOGO_BYTES = 200 * 1024; // 200 KB (§5)
export const MAX_LOGO_DIMENSION = 4096; // reject an absurd header (bomb guard); real logos are far smaller

export type LogoFormat = 'png' | 'jpeg' | 'webp';
export interface LogoOk {
  ok: true;
  format: LogoFormat;
  contentType: string;
  ext: string;
  width: number;
  height: number;
}
export interface LogoErr {
  ok: false;
  reason: 'empty' | 'too_large' | 'unsupported_type' | 'malformed' | 'bad_dimensions';
}
export type LogoResult = LogoOk | LogoErr;

const META: Record<LogoFormat, { contentType: string; ext: string }> = {
  png: { contentType: 'image/png', ext: 'png' },
  jpeg: { contentType: 'image/jpeg', ext: 'jpg' },
  webp: { contentType: 'image/webp', ext: 'webp' },
};

/** Detect the format by magic bytes ONLY (never the declared type). Anything else — SVG, GIF, BMP — is null. */
function detectFormat(b: Uint8Array): LogoFormat | null {
  if (b.length >= 8 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47 && b[4] === 0x0d && b[5] === 0x0a && b[6] === 0x1a && b[7] === 0x0a) return 'png';
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'jpeg';
  if (b.length >= 12 && b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 && b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50) return 'webp';
  return null;
}

// After a length guard the indexed bytes are known present; this reader returns a definite number so
// TS's noUncheckedIndexedAccess is satisfied without scattering non-null assertions through the parsers.
const at = (b: Uint8Array, i: number): number => b[i] ?? 0;

/** PNG: the first chunk after the 8-byte signature MUST be IHDR; width/height are big-endian uint32. */
function pngDims(b: Uint8Array): [number, number] | null {
  if (b.length < 24) return null;
  if (!(at(b, 12) === 0x49 && at(b, 13) === 0x48 && at(b, 14) === 0x44 && at(b, 15) === 0x52)) return null; // "IHDR"
  const w = ((at(b, 16) << 24) | (at(b, 17) << 16) | (at(b, 18) << 8) | at(b, 19)) >>> 0;
  const h = ((at(b, 20) << 24) | (at(b, 21) << 16) | (at(b, 22) << 8) | at(b, 23)) >>> 0;
  return [w, h];
}

/** JPEG: walk the marker segments from the SOI until a Start-Of-Frame carries the dimensions. */
function jpegDims(b: Uint8Array): [number, number] | null {
  let i = 2; // past SOI
  while (i + 1 < b.length) {
    if (at(b, i) !== 0xff) return null; // not aligned on a marker → malformed
    // Skip any 0xFF fill bytes between markers, then read the marker.
    while (at(b, i + 1) === 0xff && i + 1 < b.length) i++;
    const marker = at(b, i + 1);
    // Standalone markers (SOI/EOI/RSTn/TEM) have no length payload.
    if (marker === 0xd8 || marker === 0xd9 || (marker >= 0xd0 && marker <= 0xd7) || marker === 0x01) {
      i += 2;
      continue;
    }
    if (i + 3 >= b.length) return null;
    const len = (at(b, i + 2) << 8) | at(b, i + 3);
    if (len < 2) return null;
    // SOF0..SOF15 except DHT (C4), JPG (C8), DAC (CC) carry [precision, height, width].
    const isSOF = marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc;
    if (isSOF) {
      if (i + 8 >= b.length) return null;
      const h = (at(b, i + 5) << 8) | at(b, i + 6);
      const w = (at(b, i + 7) << 8) | at(b, i + 8);
      return [w, h];
    }
    i += 2 + len; // skip this segment
  }
  return null;
}

/** WebP: after RIFF/WEBP, read dimensions from the VP8X (extended) / VP8L (lossless) / VP8 (lossy) header. */
function webpDims(b: Uint8Array): [number, number] | null {
  if (b.length < 16) return null;
  const fourcc = String.fromCharCode(at(b, 12), at(b, 13), at(b, 14), at(b, 15));
  if (fourcc === 'VP8X') {
    if (b.length < 30) return null;
    const w = 1 + (at(b, 24) | (at(b, 25) << 8) | (at(b, 26) << 16));
    const h = 1 + (at(b, 27) | (at(b, 28) << 8) | (at(b, 29) << 16));
    return [w, h];
  }
  if (fourcc === 'VP8L') {
    if (b.length < 25 || at(b, 20) !== 0x2f) return null; // 0x2F = VP8L signature byte
    const bits = ((at(b, 21) | (at(b, 22) << 8) | (at(b, 23) << 16) | (at(b, 24) << 24)) >>> 0);
    const w = 1 + (bits & 0x3fff);
    const h = 1 + ((bits >>> 14) & 0x3fff);
    return [w, h];
  }
  if (fourcc === 'VP8 ') {
    if (b.length < 30) return null;
    if (!(at(b, 23) === 0x9d && at(b, 24) === 0x01 && at(b, 25) === 0x2a)) return null; // keyframe start code
    const w = (at(b, 26) | (at(b, 27) << 8)) & 0x3fff;
    const h = (at(b, 28) | (at(b, 29) << 8)) & 0x3fff;
    return [w, h];
  }
  return null;
}

/**
 * Validate an uploaded logo's raw bytes. Returns the detected format + our authoritative content-type +
 * a safe file extension + the decoded dimensions, or a typed rejection reason. The route uses the
 * RETURNED content-type/ext (never the client's) when storing.
 */
export function validateLogo(bytes: Uint8Array): LogoResult {
  if (!bytes || bytes.length === 0) return { ok: false, reason: 'empty' };
  if (bytes.length > MAX_LOGO_BYTES) return { ok: false, reason: 'too_large' };

  const format = detectFormat(bytes);
  if (!format) return { ok: false, reason: 'unsupported_type' };

  const dims = format === 'png' ? pngDims(bytes) : format === 'jpeg' ? jpegDims(bytes) : webpDims(bytes);
  if (!dims) return { ok: false, reason: 'malformed' };

  const [w, h] = dims;
  if (!Number.isInteger(w) || !Number.isInteger(h) || w <= 0 || h <= 0 || w > MAX_LOGO_DIMENSION || h > MAX_LOGO_DIMENSION) {
    return { ok: false, reason: 'bad_dimensions' };
  }

  return { ok: true, format, ...META[format], width: w, height: h };
}
