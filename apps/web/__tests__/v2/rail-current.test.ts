/**
 * D-41: in light the rail's current entry was marked by weight alone, its fill (--v2-s2) being the
 * rail's own colour (--v2-railbg). It now carries a bar in the text colour; this reads the light
 * tokens and the rail's stylesheet as written and holds the bar to 3:1 against the rail.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const WEB = join(__dirname, '..', '..');
const tokens = readFileSync(join(WEB, 'styles/v2/tokens.css'), 'utf8');
const css = readFileSync(join(WEB, 'components/v2/AccountShell.module.css'), 'utf8');

/** A light token's hex value: its first declaration, in the :root block before any theme block. */
function light(name: string): string {
  const m = new RegExp(`--${name}:\\s*(#[0-9a-f]{6})`, 'i').exec(tokens);
  if (!m) throw new Error(`no --${name}`);
  return m[1]!;
}

/** WCAG 2 contrast ratio of two hex colours. */
function contrast(a: string, b: string): number {
  const lum = (hex: string) => {
    const [r, g, bl] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
    const lin = (c: number) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
    return 0.2126 * lin(r!) + 0.7152 * lin(g!) + 0.0722 * lin(bl!);
  };
  const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p);
  return (x! + 0.05) / (y! + 0.05);
}

describe('the rail’s current entry in light (D-41)', () => {
  it('needs more than its fill: the fill is the rail’s own colour', () => {
    expect(light('v2-s2')).toBe(light('v2-railbg'));
  });

  it('carries a bar in the text colour, at 3:1 or more against the rail', () => {
    expect(css).toMatch(/\.current\s*\{\s*box-shadow:\s*inset 3px 0 0 var\(--v2-fg\);\s*\}/);
    expect(contrast(light('v2-fg'), light('v2-railbg'))).toBeGreaterThanOrEqual(3);
  });

  it('leaves dark’s filled row without the bar, under both dark selectors', () => {
    expect(css).toMatch(
      /:root:not\(\[data-theme='light'\]\) \.current\s*\{\s*box-shadow:\s*none;\s*\}/,
    );
    expect(css).toMatch(/:root\[data-theme='dark'\] \.current\s*\{\s*box-shadow:\s*none;\s*\}/);
  });
});
