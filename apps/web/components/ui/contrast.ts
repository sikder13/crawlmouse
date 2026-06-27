// WCAG 2.x relative luminance + contrast ratio. Pure and palette-agnostic — callers pass
// hex pairs. Used to verify the design tokens meet AA (SPEC 03 §9) and as a regression
// guard on the palette: if a token drifts below its required ratio, the test fails.

function channel(value: number): number {
  const s = value / 255;
  return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
}

export function relativeLuminance(hex: string): number {
  const hex6 = /^#?([0-9a-f]{6})$/i.exec(hex.trim())?.[1];
  if (!hex6) throw new Error(`Invalid 6-digit hex color: ${hex}`);
  const int = parseInt(hex6, 16);
  const r = (int >> 16) & 0xff;
  const g = (int >> 8) & 0xff;
  const b = int & 0xff;
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

export function contrastRatio(a: string, b: string): number {
  const la = relativeLuminance(a);
  const lb = relativeLuminance(b);
  const [hi, lo] = la >= lb ? [la, lb] : [lb, la];
  return (hi + 0.05) / (lo + 0.05);
}

/** WCAG AA thresholds. */
export const AA_NORMAL = 4.5; // body text (< 18.66px bold / < 24px)
export const AA_LARGE = 3.0; // large text + UI components / graphical objects

export function meetsAA(foreground: string, background: string, large = false): boolean {
  return contrastRatio(foreground, background) >= (large ? AA_LARGE : AA_NORMAL);
}
