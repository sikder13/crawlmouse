/**
 * CC-32 D4: a fix's effect is printed with a sign only through `formatPoints` (effect-headline.ts),
 * which gives no figure at or below zero. This guard reads every non-test source file under
 * lib/v2/view, line by line, and fails on a line that holds a plus sign in one of the spellings below
 * unless that exact line, in that file, is on the allowlist. It also fails when an allowlisted line is
 * no longer there. The self-test at the end runs the same check over a temporary tree and shows it
 * flags `+${` in the middle of a template and a second such line in an allowlisted file.
 *
 * What it reads: `+${` anywhere on a line, and a quoted plus sign ('+' or "+"). What it does not read:
 * a plus sign built another way (String.fromCharCode, a constant holding '+', a "+" inside a longer
 * literal such as "+ ").
 */
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';

const ROOT = new URL('.', import.meta.url).pathname;
const SPELLINGS = [/\+\$\{/, /'\+'/, /"\+"/];

type Line = { file: string; line: string };

/** Lines allowed to print a plus sign: file under lib/v2/view, the trimmed line, and why. */
const ALLOWED: (Line & { why: string })[] = [
  {
    file: 'effect-headline.ts',
    line: 'export const formatPoints = (n: number): string | null => (n > 0 ? `+${n}` : null);',
    why: 'the one printer of a fix effect’s sign',
  },
  {
    file: 'checks.ts',
    line: "return n === 0 ? 'no change' : n > 0 ? `+${n}` : `−${-n}`;",
    why: 'a score’s measured move between two checks, which can fall',
  },
  {
    file: 'alerts.ts',
    line: "return `${GRADE_SHORT[g.grade]} ${n >= 0 ? '+' : '−'}${Math.abs(n)}`;",
    why: 'a grade’s measured move on an alert, which can fall',
  },
  {
    file: 'segment/changes.ts',
    line: "diff: { sign: '+' | '−'; line: string }[];",
    why: 'a robots.txt diff line’s marker, not a figure',
  },
  {
    file: 'segment/changes.ts',
    line: "...(c.cause?.diff?.added ?? []).map((line) => ({ sign: '+' as const, line })),",
    why: 'a robots.txt diff line’s marker, not a figure',
  },
];

function sources(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const path = join(dir, e.name);
    if (e.isDirectory()) return sources(path);
    return /\.tsx?$/.test(e.name) && !/\.test\.tsx?$/.test(e.name) ? [path] : [];
  });
}

/** Every line of the tree under `root` that spells a plus sign, as file and trimmed text. */
function plusSigns(root: string): Line[] {
  return sources(root).flatMap((path) =>
    readFileSync(path, 'utf8')
      .split('\n')
      .filter((l) => SPELLINGS.some((s) => s.test(l)))
      .map((l) => ({ file: relative(root, path), line: l.trim() })),
  );
}

/** The lines under `root` that spell a plus sign and are not on `allowed`, and the allowlisted lines found other than once. */
function check(root: string, allowed: readonly Line[]) {
  const found = plusSigns(root);
  const on = (h: Line) => allowed.some((a) => a.file === h.file && a.line === h.line);
  return {
    unlisted: found.filter((h) => !on(h)),
    missing: allowed.filter(
      (a) => found.filter((h) => h.file === a.file && h.line === a.line).length !== 1,
    ),
  };
}

describe('a plus sign in lib/v2/view', () => {
  it('is printed only on an allowlisted line', () => {
    expect(check(ROOT, ALLOWED).unlisted).toEqual([]);
  });

  it('is still on each allowlisted line, once', () => {
    expect(check(ROOT, ALLOWED).missing).toEqual([]);
  });
});

describe('the guard itself, over a temporary tree', () => {
  const dir = mkdtempSync(join(tmpdir(), 'plus-sign-guard-'));
  afterAll(() => rmSync(dir, { recursive: true, force: true }));
  const allowed: Line[] = [{ file: 'checks.ts', line: 'return `+${n}`;' }];
  mkdirSync(join(dir, 'segment'));
  writeFileSync(join(dir, 'checks.ts'), 'return `+${n}`;\nconst extra = `+${m}`;\n');
  writeFileSync(
    join(dir, 'segment', 'fix.ts'),
    "const s = `AI +${h.points}`;\nconst t = '+' + n;\n",
  );
  writeFileSync(join(dir, 'segment', 'fix.test.ts'), 'const ok = `+${n}`;\n');

  it('flags `+${` mid-template, a quoted plus, and a second line in an allowlisted file, and reads no test file', () => {
    expect(check(dir, allowed).unlisted).toEqual([
      { file: 'checks.ts', line: 'const extra = `+${m}`;' },
      { file: 'segment/fix.ts', line: 'const s = `AI +${h.points}`;' },
      { file: 'segment/fix.ts', line: "const t = '+' + n;" },
    ]);
  });

  it('flags an allowlisted line that is gone', () => {
    expect(check(dir, [...allowed, { file: 'checks.ts', line: 'gone' }]).missing).toEqual([
      { file: 'checks.ts', line: 'gone' },
    ]);
  });
});
