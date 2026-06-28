import { readFileSync, readdirSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { describe, it, expect } from 'vitest';

// A link that LOOKS like a button must render as a single <a>/<Link> (styled via buttonClasses), not
// an <a>/<Link> wrapping a <Button>: nested interactive content is two tab stops with ambiguous
// activation (WCAG 4.1.2). This guard scans the SPEC 03-owned UI (components/** + the app pages) and
// fails if the anti-pattern reappears. app/not-found.tsx is intentionally excluded — it is outside
// SPEC 03's file ownership and keeps its pre-existing markup.
const ROOTS = [resolve(__dirname), resolve(__dirname, '..', 'app')];
const EXCLUDE = new Set([resolve(__dirname, '..', 'app', 'not-found.tsx')]);

function tsxFiles(dir: string): string[] {
  const out: string[] = [];
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) {
      if (e.name === 'node_modules' || e.name === '.next') continue;
      out.push(...tsxFiles(p));
    } else if (e.name.endsWith('.tsx') && !e.name.endsWith('.test.tsx') && !EXCLUDE.has(p)) {
      out.push(p);
    }
  }
  return out;
}

// <a ...> or <Link ...> immediately followed by <Button (whitespace collapsed first).
const NESTED = /<(?:a|Link)\b[^>]*>\s*<Button[\s/>]/;

describe('no nested interactive (link wrapping a button) — a11y', () => {
  const files = ROOTS.flatMap(tsxFiles);

  it('scans a non-trivial set of owned UI files', () => {
    expect(files.length).toBeGreaterThan(20);
  });

  it('no <a>/<Link> wraps a <Button> in owned UI', () => {
    const offenders = files.filter((f) => NESTED.test(readFileSync(f, 'utf8').replace(/\s+/g, ' ')));
    expect(offenders, `nested interactive in: ${offenders.join(', ')}`).toEqual([]);
  });
});
