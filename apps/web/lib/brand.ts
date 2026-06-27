/**
 * Crawlmouse brand palette — the SINGLE SOURCE OF TRUTH for color.
 *
 * `tailwind.config.ts` imports BRAND and derives every theme color from it, and the
 * contexts that can't use Tailwind classes (the OG image's satori inline styles and the
 * embed-badge standalone iframe document) import the raw hex directly. Keep all color
 * here so a palette change is one edit, never a hex hunt.
 *
 * Semantic roles and the rest of the token system are documented in docs/design-system.md.
 * Elevate the brand (cream/orange) — do not rebrand (SPEC 00 D6).
 */
export const BRAND = {
  // Surfaces
  cream: '#fdfaf5', // app background / base surface
  white: '#ffffff', // raised surface (cards, inputs)
  oat: '#e8e2d4', // hairline borders / muted fills
  // Ink (text)
  ink: '#1a1a18', // primary text
  inkMuted: '#5c5a52', // secondary text (text-ink-muted)
  // Accent (peach)
  peach: '#ff7849', // accent fills, badges, primary buttons
  peachLight: '#ffd7c2', // soft accent tint
  peachText: '#d8603a', // AA-safe accent for TEXT on cream (peach #ff7849 fails WCAG AA as body text)
  // Positive (sage)
  sage: '#7a9b7e', // positive / passing
  sageLight: '#c9d6c5', // soft positive tint
  // Status
  warning: '#ff5630',
} as const;
