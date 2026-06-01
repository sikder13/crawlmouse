/**
 * Brand palette as raw hex, for the contexts that can't use Tailwind classes:
 * the OG image (satori inline styles) and the embed badge (a standalone iframe
 * document). These mirror the Tailwind theme tokens (cream/ink/peach/sage/oat);
 * keep the two in sync from this single source so a rebrand isn't a hex hunt.
 */
export const BRAND = {
  cream: '#fdfaf5',
  ink: '#1a1a18',
  inkMuted: '#5c5a52',
  peach: '#ff7849',
  sage: '#7a9b7e',
  oat: '#e8e2d4',
} as const;
