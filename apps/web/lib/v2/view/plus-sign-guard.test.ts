/**
 * CC-32 D4: a fix's effect is printed with a sign only through `formatPoints` (effect-headline.ts),
 * which gives no figure at or below zero. This guard reads every source file under lib/v2/view and
 * fails on a plus sign written in any of the spellings below outside the allowlist, so a printer that
 * builds "+${…}" itself cannot come back. Each allowlisted line is named with its reason, and the guard
 * fails when an allowlisted line is no longer there, so the list cannot go stale.
 *
 * What it reads: a template literal opening with `+${`, and a quoted plus sign ('+' or "+"). What it
 * does not read: a plus sign built another way (String.fromCharCode, a constant holding '+', a "+"
 * inside a longer literal such as "+ "); those are not how this tree prints signs today.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = new URL('.', import.meta.url).pathname;
const SPELLINGS = [/`\+\$\{/, /'\+'/, /"\+"/];

/** Lines allowed to print a plus sign: file under lib/v2/view, the trimmed line, and why. */
const ALLOWED: { file: string; line: string; why: string }[] = [
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

/** Every line of the view tree that spells a plus sign, as file and trimmed text. */
function plusSigns(root: string): { file: string; line: string }[] {
  return sources(root).flatMap((path) =>
    readFileSync(path, 'utf8')
      .split('\n')
      .filter((l) => SPELLINGS.some((s) => s.test(l)))
      .map((l) => ({ file: relative(root, path), line: l.trim() })),
  );
}

describe('a plus sign in lib/v2/view', () => {
  const found = plusSigns(ROOT);
  const allowed = (h: { file: string; line: string }) =>
    ALLOWED.some((a) => a.file === h.file && a.line === h.line);

  it('is printed only where the allowlist says, with its reason', () => {
    expect(found.filter((h) => !allowed(h))).toEqual([]);
  });

  it('is still at each allowlisted line, once', () => {
    for (const a of ALLOWED) {
      expect(
        found.filter((h) => h.file === a.file && h.line === a.line),
        `${a.file}: ${a.line}`,
      ).toHaveLength(1);
    }
  });

  it('reads each spelling it names', () => {
    const hits = ['`+${n}`', "'+' + n", '"+" + n'].map((l) => SPELLINGS.some((s) => s.test(l)));
    expect(hits).toEqual([true, true, true]);
  });
});
