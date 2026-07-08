import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

// SPEC 04 §4 (V8) — the client-ready report's PDF is the browser print path (no server-side PDF).
// This pins that the print stylesheet exists and does the load-bearing things: hide site chrome +
// interactive controls (`.no-print`), keep report sections whole across page breaks, and scope to the
// report container so it never affects other routes. FAILS LOUD (ENOENT) if globals.css is renamed.
const read = (rel: string) => readFileSync(resolve(__dirname, '..', rel), 'utf8');

describe('report print stylesheet (V8)', () => {
  it('globals.css defines an @media print block that hides .no-print and keeps sections whole', () => {
    const css = read('app/globals.css');
    expect(css).toMatch(/@media\s+print/);
    expect(css).toMatch(/\.no-print\s*\{[^}]*display\s*:\s*none/);
    expect(css).toContain('break-inside: avoid');
    expect(css).toContain('.report-print');
  });

  it('the report page marks site chrome + interactive controls no-print and the body report-print', () => {
    const page = read('app/r/[slug]/page.tsx');
    expect(page).toContain('report-print'); // the print container
    expect(page).toContain('no-print'); // Header/Footer/CTA/PrintButton excluded from the PDF
    expect(page).toContain('PrintButton'); // the Download PDF affordance
  });
});
