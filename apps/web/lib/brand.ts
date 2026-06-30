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
  // Accent (orange)
  peach: '#ff7849', // brand accent — wordmark, borders, grade ring, focus rings, graph accents
  peachLight: '#ffd7c2', // soft accent tint
  peachText: '#d8603a', // AA accent for large/emphasis TEXT on cream (peach as text fails AA)
  accentFill: '#c84e1e', // darkened orange FILL for solid buttons + peach badges — WHITE text clears AA (4.60:1)
  // Positive (sage)
  sage: '#7a9b7e', // positive / passing accent (non-text uses)
  sageLight: '#c9d6c5', // soft positive tint
  sageFill: '#5a7a5e', // darkened sage FILL for solid badges — WHITE text clears AA (4.79:1)
  // Status
  warning: '#ff5630', // warning accent (non-text: invalid border/ring)
  warningFill: '#cf421e', // darkened warning FILL for destructive button + warning badge — WHITE text AA (4.72:1)
} as const;
