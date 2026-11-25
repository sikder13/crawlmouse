/**
 * Row 16 (F-157): two literal rules over the app's source (lib/v2 and app/, tests excluded):
 * - no `pageCap:` is written as DEFAULT_PAGE_CAP or as a number;
 * - DEFAULT_PAGE_CAP is named only where it is defined, where the rule reads it, and where the
 *   pipeline's spec prints it.
 * They catch a sender that names the default; they cannot see one that reads its cap some other way.
 * The control for that is the store: `accountClock` is a required method of every store
 * `requestCheck` runs on (pipeline/store.ts), so a new store without it does not compile.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';

const WEB = join(__dirname, '..', '..');
const ROOTS = ['lib/v2', 'app'];
const ALLOWED = [
  'lib/v2/pipeline/limits.ts',
  'lib/v2/pipeline/page-cap.ts',
  'lib/v2/pipeline/spec.ts',
];

/** A `pageCap:` given DEFAULT_PAGE_CAP or a number, in any spacing, across lines included. */
const HAND_SET_CAP = /\bpageCap\s*:\s*(?:DEFAULT_PAGE_CAP\b|\d)/;
const NAMES_DEFAULT = /\bDEFAULT_PAGE_CAP\b/;

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) return name === 'node_modules' ? [] : sources(full);
    return /\.(ts|tsx)$/.test(name) && !/\.test\.(ts|tsx)$/.test(name) ? [full] : [];
  });
}
const files = ROOTS.flatMap((r) => sources(join(WEB, r))).map((f) => ({
  path: relative(WEB, f),
  text: readFileSync(f, 'utf8'),
}));

describe('the page cap guard', () => {
  it('reads the source it guards', () => {
    expect(files.length).toBeGreaterThan(300);
    expect(files.some((f) => f.path === 'lib/v2/pipeline/request.ts')).toBe(true);
  });

  it.each([
    ['pageCap: DEFAULT_PAGE_CAP,', true],
    ['pageCap:DEFAULT_PAGE_CAP', true],
    ['pageCap :\n        DEFAULT_PAGE_CAP,', true],
    ['pageCap: 500,', true],
    ['pageCap: 2000', true],
    ['pageCap: pageCapFor(site.account ?? null, new Date(now)),', false],
    ['pageCap,', false],
    ['const pageCap = await capOf(accountId);', false],
  ])('the matcher reads %j as hand-set: %s', (text, hand) => {
    expect(HAND_SET_CAP.test(text)).toBe(hand);
  });

  it('finds no check whose page cap is set by hand', () => {
    expect(files.filter((f) => HAND_SET_CAP.test(f.text)).map((f) => f.path)).toEqual([]);
  });

  it('finds DEFAULT_PAGE_CAP only where it is defined, read by the rule, and printed', () => {
    expect(
      files
        .filter((f) => NAMES_DEFAULT.test(f.text))
        .map((f) => f.path)
        .sort(),
    ).toEqual(ALLOWED);
  });
});
