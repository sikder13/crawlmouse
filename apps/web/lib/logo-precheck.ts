// SPEC 04.1 §3/U4 — a UX-only client pre-check to reject an obvious SVG / oversize file before an upload
// round trip. It is NEVER the gate: the server re-validates every byte (magic bytes + structural decode,
// NO SVG, ≤200KB) and is authoritative. Kept client-safe (no import of the server validator).
export const LOGO_MAX_BYTES = 200 * 1024; // mirrors logo-validation.MAX_LOGO_BYTES (server authoritative)
export const LOGO_ACCEPT = 'image/png,image/jpeg,image/webp'; // for <input accept="…">

const ACCEPTED = new Set(['image/png', 'image/jpeg', 'image/webp']);

export function logoClientPrecheck(file: { type: string; size: number }): { ok: boolean; reason?: 'type' | 'size' } {
  if (!ACCEPTED.has(file.type)) return { ok: false, reason: 'type' };
  if (file.size > LOGO_MAX_BYTES) return { ok: false, reason: 'size' };
  return { ok: true };
}
