/**
 * docs/ops/launch-day.md lists the Sentry signals the 24-hour watch reads. The list is pinned here
 * to the same `git grep` the page prints: a `signal` tag set from a literal is listed by its name, one
 * set from a value by its file. A tag added, removed or renamed in the code fails this until the page
 * says the same.
 */
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { REPO_ROOT } from './env-scan';

const PAGE = join(REPO_ROOT, 'docs/ops/launch-day.md');
const START = '<!-- launch-day:signals:start -->';
const END = '<!-- launch-day:signals:end -->';
/** The page's command, argument for argument. */
const GREP = [
  'grep',
  '-nE',
  'tags: \\{[^}]*signal',
  '--',
  'apps/web',
  'inngest',
  'packages',
  ':!*.test.ts',
  ':!*.test.tsx',
];

/** The signals the code sets: literal names, and the files that set one from a value. */
function signalsInCode(grepOutput: string): { literal: string[]; fromValue: string[] } {
  const literal = new Set<string>();
  const fromValue = new Set<string>();
  for (const line of grepOutput.split('\n').filter(Boolean)) {
    const file = line.slice(0, line.indexOf(':'));
    const tag = /tags: \{[^}]*\bsignal\b\s*(:\s*(['"`])([^'"`$]*)\2)?/.exec(line);
    if (tag === null) throw new Error(`a grep line with no signal tag: ${line}`);
    if (tag[3] !== undefined) literal.add(tag[3]);
    else fromValue.add(file);
  }
  return { literal: [...literal].sort(), fromValue: [...fromValue].sort() };
}

/** The page's list: the backticked first word of each bullet, under each of the two headings. */
function signalsOnPage(page: string): { literal: string[]; fromValue: string[] } {
  const start = page.indexOf(START);
  const end = page.indexOf(END);
  if (start < 0 || end < start) throw new Error('the signal markers are missing');
  const block = page.slice(start, end);
  const split = block.indexOf('Set from a value');
  if (split < 0) throw new Error('the "Set from a value" heading is missing');
  const bullets = (s: string) => [...s.matchAll(/^- `([^`]+)`/gm)].map((m) => m[1]!).sort();
  return { literal: bullets(block.slice(0, split)), fromValue: bullets(block.slice(split)) };
}

describe('docs/ops/launch-day.md, the Sentry signals', () => {
  const code = signalsInCode(execFileSync('git', GREP, { cwd: REPO_ROOT, encoding: 'utf8' }));

  it('finds tags in the code at all (the grep is live)', () => {
    expect(code.literal.length).toBeGreaterThan(0);
    expect(code.fromValue.length).toBeGreaterThan(0);
  });

  it('prints the command this test runs', () => {
    const shown = [
      'git',
      ...GREP.map((a, i) => (i === 2 ? `"${a}"` : a.startsWith(':') ? `'${a}'` : a)),
    ].join(' ');
    expect(readFileSync(PAGE, 'utf8')).toContain(shown);
  });

  it('lists the literal names and the value-setting files the grep finds, and no others', () => {
    expect(signalsOnPage(readFileSync(PAGE, 'utf8'))).toEqual(code);
  });

  it('reads a literal in any quote, and a shorthand or computed tag as set from a value', () => {
    const out = [
      "a.ts:1:  tags: { signal: 'one-two' },",
      'b.ts:2:  tags: { level: 1, signal: "three" },',
      'c.ts:3:  tags: { signal },',
      'd.ts:4:  tags: { signal: `billing-${x}` },',
      'e.ts:5:  tags: { signal: message },',
    ].join('\n');
    expect(signalsInCode(out)).toEqual({
      literal: ['one-two', 'three'],
      fromValue: ['c.ts', 'd.ts', 'e.ts'],
    });
  });
});
