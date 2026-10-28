/**
 * CC-11 — where the v2 contract reuses something the engine owns, pin it here, on the engine side of
 * the dependency (packages/types cannot import the engine).
 */
import { readFileSync, readdirSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { FixtureDatasetSchema, GradeLetterSchema, type FixtureDataset } from '@crawlmouse/types/v2';
import { scoreToLetter } from '../grade.js';
import { CRAWLER_REGISTRY_V2 } from './crawler-registry.js';

const DIR = new URL('../../../../apps/web/lib/fixtures/v2/', import.meta.url);
const fixtures: [string, FixtureDataset][] = readdirSync(DIR)
  .filter((f) => f.endsWith('.json'))
  .map((f) => [f, FixtureDatasetSchema.parse(JSON.parse(readFileSync(new URL(f, DIR), 'utf8')))]);

describe('GradeLetter is the engine letter scale', () => {
  it('every score from 0 to 100, in hundredths, maps into GradeLetter, and every letter is reached', () => {
    const reached = new Set<string>();
    for (let i = 0; i <= 10_000; i++) reached.add(scoreToLetter(i / 100));
    expect([...reached].sort()).toEqual([...GradeLetterSchema.options].sort());
  });
});

describe.each(fixtures)('%s agrees with the engine', (_file, data) => {
  const registry = new Map(CRAWLER_REGISTRY_V2.map((e) => [e.token, e]));

  it('every Technical SEO letter is the engine letter for its score', () => {
    const grades = [
      ...data.checks.map((c) => c.technical_seo),
      ...data.checks.flatMap((c) => c.competitors.map((x) => x.technical_seo)),
    ];
    for (const g of grades)
      if (g && g.score !== null) expect(g.grade, `${g.score}`).toBe(scoreToLetter(g.score));
  });

  it('every crawler a fixture names is in the registry, with the registry group and scoring', () => {
    for (const c of data.checks) {
      for (const r of c.crawlers) {
        const entry = registry.get(r.ua);
        expect(entry, r.ua).toBeDefined();
        expect([r.group, r.scored]).toEqual([entry!.group, entry!.scored]);
      }
    }
    const named = [
      ...data.access_tests.map((t) => t.ua),
      ...data.changes.map((c) => c.ua),
      ...data.fixes.flatMap((f) => [...f.crawler_uas, f.packet?.verify.ua ?? null]),
    ].filter((ua): ua is string => ua !== null);
    expect(named.filter((ua) => !registry.has(ua))).toEqual([]);
  });

  it('every check lists each tracked crawler once', () => {
    for (const c of data.checks.filter((x) => x.crawlers.length > 0)) {
      expect(c.crawlers.map((r) => r.ua).sort(), c.id).toEqual([...registry.keys()].sort());
    }
  });
});
