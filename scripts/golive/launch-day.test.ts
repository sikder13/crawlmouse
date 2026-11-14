/**
 * docs/ops/launch-day.md lists the Sentry signals the 24-hour watch reads. The list is pinned here
 * to `sentrySignals` (signals.ts, the TypeScript parser over the source; the page prints its
 * command): a `signal` tag set from a literal is listed by its name, one set from a value by its
 * file. A tag added, removed or renamed in the code fails this until the page says the same.
 */
import { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { FAILURE_REASONS } from '../../inngest/check-events';
import { REPO_ROOT } from './env-scan';
import {
  CHECK_FAILURE_FLOOR,
  CHECK_FAILURE_LINE,
  COUNTED_REASONS,
  REASON_COUNTED,
  checkFailureSql,
  withCheckFailure,
} from './launch-day';
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

describe('docs/ops/launch-day.md, the check-failure line', () => {
  it('holds the render of launch-day.ts between its markers', () => {
    const page = readFileSync(PAGE, 'utf8');
    expect(withCheckFailure(page)).toBe(page);
  });

  it("marks each of the pipeline's failure reasons, and only those", () => {
    expect(Object.keys(REASON_COUNTED).sort()).toEqual([...FAILURE_REASONS].sort());
    // A site's own second check and the owner's pause are not counted; every other reason is.
    expect(FAILURE_REASONS.filter((r) => !COUNTED_REASONS.includes(r))).toEqual([
      'paused',
      'site_busy',
    ]);
    expect(CHECK_FAILURE_FLOOR).toBe(20);
    expect(CHECK_FAILURE_LINE).toBe(20);
  });

  describe('the query, on Postgres', () => {
    let db: PGlite;
    beforeAll(async () => {
      db = new PGlite();
      // The columns the query reads, with the constraint that sets finished_at for an ended check.
      await db.exec(`
        create table public.checks (
          id serial primary key,
          status text not null,
          failure_reason text,
          finished_at timestamptz
        );`);
    }, 60_000);
    afterAll(async () => {
      await db?.close();
    });

    /** The query's answer over `rows` ended `ago` minutes back (a reason marks a failed check). */
    async function run(rows: { reason?: string; ago?: number }[]) {
      await db.exec('truncate public.checks');
      for (const r of rows)
        await db.query(
          `insert into public.checks (status, failure_reason, finished_at)
           values ($1, $2, now() - make_interval(mins => $3))`,
          [r.reason === undefined ? 'finished' : 'failed', r.reason ?? null, r.ago ?? 5],
        );
      const { rows: out } = await db.query<{
        failed_ours: number;
        failed_any: number;
        ended: number;
        failed_pct: string | null;
        abort: boolean;
      }>(checkFailureSql());
      return out[0]!;
    }
    const of = (n: number, row: { reason?: string; ago?: number } = {}) =>
      Array.from({ length: n }, () => ({ ...row }));

    it('crosses the line over 20% of at least 20 ended checks', async () => {
      // 5 of 20 failed: 25%.
      expect(await run([...of(15), ...of(5, { reason: 'internal' })])).toMatchObject({
        failed_ours: 5,
        ended: 20,
        abort: true,
      });
      // 4 of 20: exactly 20%, not over it.
      expect((await run([...of(16), ...of(4, { reason: 'internal' })])).abort).toBe(false);
    });

    it('does not read the rate below the floor', async () => {
      // 19 ended, every one failed.
      expect(await run(of(19, { reason: 'internal' }))).toMatchObject({ ended: 19, abort: false });
      expect(await run([])).toMatchObject({ ended: 0, abort: false, failed_pct: null });
    });

    it("counts only the reasons marked ours, and only the hour's checks", async () => {
      const answer = await run([
        ...of(14),
        ...of(6, { reason: 'site_busy' }),
        ...of(6, { reason: 'paused' }),
        ...of(9, { reason: 'internal', ago: 90 }),
      ]);
      expect(answer).toMatchObject({ failed_ours: 0, failed_any: 12, ended: 26, abort: false });
      for (const reason of COUNTED_REASONS)
        expect((await run([...of(15), ...of(5, { reason })])).abort, reason).toBe(true);
    });
  });
});
