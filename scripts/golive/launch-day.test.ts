/**
 * docs/ops/launch-day.md lists the Sentry signals the 24-hour watch reads. The list is pinned here
 * to `sentrySignals` (signals.ts, the TypeScript parser over the source; the page prints its
 * command): a `signal` tag set from a literal is listed by its name, one set from a value by its
 * file. A tag added, removed or renamed in the code fails this until the page says the same.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { REPO_ROOT } from './env-scan';
import { sentrySignals, signalsInSource, type Signals } from './signals';

const PAGE = join(REPO_ROOT, 'docs/ops/launch-day.md');
const START = '<!-- launch-day:signals:start -->';
const END = '<!-- launch-day:signals:end -->';
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
  const code = sentrySignals();

  it('finds tags in the code at all (the reading is live)', () => {
    expect(code.literal.length).toBeGreaterThan(0);
    expect(code.fromValue.length).toBeGreaterThan(0);
  });

  it('prints the command that lists them', () => {
    expect(readFileSync(PAGE, 'utf8')).toContain(
      'pnpm --filter @crawlmouse/scripts exec tsx golive/signals.ts',
    );
  });

  it('lists the literal names and the value-setting files the code holds, and no others', () => {
    expect(signalsOnPage(readFileSync(PAGE, 'utf8'))).toEqual(code);
  });

  it('reads a tag in any quote and any formatting, and a shorthand or computed one as from a value', () => {
    const into: Signals = { literal: [], fromValue: [] };
    const files: Record<string, string> = {
      'a.ts': "Sentry.captureMessage('x', { tags: { signal: 'one-two' } });",
      'b.ts': 'report({ tags: { level: 1, signal: "three" } });',
      // Wrapped over several lines, as Prettier leaves a long call: a line-based reading misses it.
      'wrapped.ts': [
        'Sentry.captureException(error, {',
        '  level: "error",',
        '  tags: {',
        '    route: "/api/x",',
        '    signal:',
        "      'wrapped-name',",
        '  },',
        '});',
      ].join('\n'),
      'quoted.ts': "x({ 'tags': { 'signal': `four` } });",
      'spread.tsx': "x({ tags: { ...base, signal: ('five' as const) } });",
      'c.ts': 'x({ tags: { signal } });',
      'd.ts': 'x({ tags: { signal: `billing-${reason}` } });',
      'e.ts': 'x({ tags: {\n signal: message } });',
      // Not a tags object: a signal elsewhere is not a Sentry tag.
      'f.ts': 'fetch(url, { signal: controller.signal, tags: { other: "x" } });',
      'g.ts': 'init({ request: { signal: controller.signal }, extra: { signal: "not-a-tag" } });',
    };
    for (const [file, text] of Object.entries(files)) signalsInSource(file, text, into);
    expect({ literal: into.literal.sort(), fromValue: into.fromValue.sort() }).toEqual({
      literal: ['five', 'four', 'one-two', 'three', 'wrapped-name'],
      fromValue: ['c.ts', 'd.ts', 'e.ts'],
    });
  });
});
