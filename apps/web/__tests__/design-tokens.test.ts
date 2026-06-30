import { describe, it, expect } from 'vitest';
import { BRAND } from '../lib/brand';
import tailwindConfig from '../tailwind.config';

// The Tailwind theme must be DERIVED from brand.ts (the single source of truth) — no drift.
// brand.ts holds the raw palette; tailwind.config imports it. The elevated system adds
// semantic color roles + a deliberate type scale. Existing class names
// (cream / ink / peach / sage / oat / warning, font-display/sans/mono) MUST be preserved
// so the non-owned surfaces (r/[slug], OG, embed, blog) keep rendering (U13).

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const theme = (tailwindConfig as any).theme?.extend ?? {};
const colors: Record<string, unknown> = theme.colors ?? {};
const fontSize: Record<string, unknown> = theme.fontSize ?? {};

const asDefault = (v: unknown): unknown =>
  v && typeof v === 'object' ? (v as Record<string, unknown>).DEFAULT : v;

describe('design tokens — brand.ts is the single source', () => {
  it('brand.ts exposes the documented palette', () => {
    const required = [
      'cream', 'ink', 'inkMuted', 'peach', 'peachLight', 'peachText', 'accentFill',
      'sage', 'sageLight', 'sageFill', 'oat', 'warning', 'warningFill', 'white',
    ] as const;
    for (const key of required) {
      expect(String((BRAND as Record<string, string>)[key]), `BRAND.${key}`).toMatch(/^#[0-9a-f]{3,8}$/i);
    }
  });

  it('preserves the existing brand class names (no rename — non-regression)', () => {
    expect(colors.cream).toBe(BRAND.cream);
    expect(colors.oat).toBe(BRAND.oat);
    expect(asDefault(colors.warning)).toBe(BRAND.warning);
    // ink/peach/sage may carry a DEFAULT, but text-ink / bg-peach / bg-sage must still resolve.
    expect(asDefault(colors.ink)).toBe(BRAND.ink);
    expect(asDefault(colors.peach)).toBe(BRAND.peach);
    expect(asDefault(colors.sage)).toBe(BRAND.sage);
  });

  it('adds the semantic color roles (so components never hardcode hex)', () => {
    expect(colors.surface).toBe(BRAND.cream);
    expect(colors['surface-raised']).toBe(BRAND.white);
    expect((colors.ink as Record<string, string>)?.muted).toBe(BRAND.inkMuted); // text-ink-muted
    expect(asDefault(colors.accent)).toBe(BRAND.peach);
    expect((colors.accent as Record<string, string>)?.text).toBe(BRAND.peachText); // text-accent-text (AA on cream)
    expect((colors.accent as Record<string, string>)?.fill).toBe(BRAND.accentFill); // bg-accent-fill (white text AA)
    expect((colors.sage as Record<string, string>)?.fill).toBe(BRAND.sageFill); // bg-sage-fill (white text AA)
    expect((colors.warning as Record<string, string>)?.fill).toBe(BRAND.warningFill); // bg-warning-fill (white text AA)
    expect(colors.positive).toBe(BRAND.sage);
    expect(colors.locked).toBe(BRAND.inkMuted);
  });

  it('every tailwind color value is sourced from brand.ts (no drift)', () => {
    const allowed = new Set<string>(Object.values(BRAND));
    const flat: string[] = [];
    for (const v of Object.values(colors)) {
      if (typeof v === 'string') flat.push(v);
      else if (v && typeof v === 'object') flat.push(...Object.values(v as Record<string, string>));
    }
    for (const hex of flat) expect(allowed, `${hex} must come from BRAND`).toContain(hex);
  });

  it('defines a deliberate type scale (display / h1 / h2 / h3 / body-lg / body / caption)', () => {
    for (const k of ['display', 'h1', 'h2', 'h3', 'body-lg', 'body', 'caption']) {
      expect(fontSize[k], `fontSize.${k}`).toBeDefined();
    }
  });
});
