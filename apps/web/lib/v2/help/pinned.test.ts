/**
 * The help articles' copies of the engine's, the worker's and the verdicts' values are those values:
 * each is read from its own source file, so a change there turns this red until the copy follows.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { VERDICTS } from '../../../components/v2/verdicts';
import * as WEIGHTS from '../../../../../packages/engine/src/v2/grade/weights';
import * as WORKER from '../../../../../packages/worker/src/identities';
import * as FACTS from './pinned';

describe('the help articles’ pinned facts', () => {
  it('are the grade formulas’ weights', () => {
    expect(FACTS.AI_WEIGHTS).toEqual(WEIGHTS.AI_WEIGHTS);
    expect(FACTS.SEO_WEIGHTS).toEqual(WEIGHTS.SEO_WEIGHTS);
  });

  it('name the declarations that score, and only those', () => {
    const scoring = Object.entries(WEIGHTS.SIGNAL_POINTS)
      .filter(([, points]) => points > 0)
      .map(([key]) => key);
    expect([...FACTS.SCORED_SIGNALS].sort()).toEqual(scoring.sort());
  });

  it('are the worker’s user agent, its tag and its robots.txt groups', () => {
    expect(FACTS.CRAWL_USER_AGENT).toBe(WORKER.CRAWL_USER_AGENT);
    expect(FACTS.CRAWLER_TAG).toBe(WORKER.TAG);
    expect(FACTS.OUR_ROBOTS_TOKENS).toEqual(WORKER.OUR_ROBOTS_TOKENS);
    // The tag is what a crawler's request carries after its own user agent.
    for (const c of WORKER.CRAWLERS) expect(c.userAgent.endsWith(` ${WORKER.TAG}`)).toBe(true);
    expect(WORKER.CONTROL.userAgent).not.toContain('Crawlmouse');
  });

  it('name the header each crawler request, and the canary, carries besides the tag', () => {
    const names = (headers: ReadonlyArray<readonly [string, string]>) => headers.map(([n]) => n);
    expect(WORKER.CRAWLERS.length).toBeGreaterThan(3);
    for (const c of [...WORKER.CRAWLERS, WORKER.CANARY]) {
      expect(names(c.headers)).toContain(FACTS.FROM_HEADER);
    }
    expect(names(WORKER.CONTROL.headers)).not.toContain(FACTS.FROM_HEADER);
  });

  it('are the re-check cap’s window, as request_capped_check counts it', () => {
    const dir = join(__dirname, '../../../../../infra/supabase/migrations');
    const defining = readdirSync(dir).filter((f) =>
      readFileSync(join(dir, f), 'utf8').includes(
        'create or replace function public.request_capped_check',
      ),
    );
    expect(defining).toEqual(['20261112000001_v2_026b_sites_fixes.sql']);
    const sql = readFileSync(join(dir, defining[0]!), 'utf8');
    const start = sql.indexOf('create or replace function public.request_capped_check');
    const body = sql.slice(start, sql.indexOf('$$;', start));
    expect(start).toBeGreaterThan(-1);
    const windows = [...body.matchAll(/interval '(\d+) hours'/g)].map((m) => Number(m[1]));
    expect(windows).toHaveLength(3);
    expect(new Set(windows)).toEqual(new Set([FACTS.RECHECK_WINDOW_HOURS]));
  });

  it('are the labels the result gives the verdicts', () => {
    for (const [verdict, label] of Object.entries(FACTS.VERDICT_LABELS))
      expect(label).toBe(VERDICTS[verdict as keyof typeof VERDICTS].label);
  });
});
