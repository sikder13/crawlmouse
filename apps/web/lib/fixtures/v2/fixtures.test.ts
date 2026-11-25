/**
 * The full contract test lives in packages/types/src/v2/contract.test.ts. This copy of its first check
 * sits next to the fixtures because the local turbo cache keys each package's tests on that package's
 * own files: an edit to a fixture alone would otherwise replay a cached pass for @crawlmouse/types.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { FixtureDatasetSchema } from '@crawlmouse/types/v2';

const DIR = new URL('./', import.meta.url);
const files = readdirSync(DIR).filter((f) => f.endsWith('.json'));
/** The engine's v2 fixtures and recordings, read here as raw JSON too. */
const ENGINE_DIR = new URL('../../../../../packages/engine/fixtures/v2/', import.meta.url);

function jsonUnder(dir: URL): URL[] {
  return readdirSync(dir).flatMap((name) => {
    const url = new URL(name, dir);
    if (statSync(url).isDirectory()) return jsonUnder(new URL(`${name}/`, dir));
    return name.endsWith('.json') ? [url] : [];
  });
}

interface RawFix {
  site_id?: string;
  number: unknown;
}

/** Each file's top-level `fixes`, read as JSON and not through the contract. */
const fixSets = [...files.map((f) => new URL(f, DIR)), ...jsonUnder(ENGINE_DIR)].flatMap((url) => {
  const data: unknown = JSON.parse(readFileSync(url, 'utf8'));
  const fixes = (data as { fixes?: unknown }).fixes;
  return Array.isArray(fixes) ? [{ file: url.pathname, fixes: fixes as RawFix[] }] : [];
});

describe('v2 fixtures', () => {
  it('holds the three contract fixtures and the built one', () => {
    expect(files.sort()).toEqual([
      'bad-site.json',
      'built-site.json',
      'challenged-site.json',
      'clean-site.json',
    ]);
  });

  it.each(files)('%s parses with FixtureDatasetSchema', (file) => {
    const result = FixtureDatasetSchema.safeParse(
      JSON.parse(readFileSync(new URL(file, DIR), 'utf8')),
    );
    expect(result.success, result.success ? '' : z.prettifyError(result.error)).toBe(true);
  });

  it('numbers every fix of every v2 fixture from 1, once per site (F-276)', () => {
    // The walk is not empty: the contract fixtures with fixes and the engine's recordings are in it.
    const read = fixSets.map((s) => s.file.split('/fixtures/v2/')[1]);
    expect(read).toEqual(expect.arrayContaining(['bad-site.json', 'build/expected.json']));
    for (const { file, fixes } of fixSets) {
      const bySite = new Map<string, unknown[]>();
      for (const f of fixes) {
        const site = f.site_id ?? '';
        bySite.set(site, [...(bySite.get(site) ?? []), f.number]);
      }
      for (const [site, numbers] of bySite) {
        const where = `${file} ${site}`;
        expect(
          numbers.filter((n) => !Number.isInteger(n) || (n as number) < 1),
          where,
        ).toEqual([]);
        expect(new Set(numbers).size, where).toBe(numbers.length);
      }
    }
  });

  it.each(files)(
    '%s numbers its fixes as the engine does: by first-seen check, then fingerprint (F-276)',
    (file) => {
      // packages/engine/src/v2/diff/diff.ts:82-110: a check's new fixes take the next numbers,
      // walked in fingerprint text order. So within a site, sorting by (the first-seen check's
      // queued_at, fingerprint) gives the numbers in increasing order.
      const d = JSON.parse(readFileSync(new URL(file, DIR), 'utf8')) as {
        checks: { id: string; queued_at: string }[];
        fixes: {
          site_id: string;
          number: number;
          fingerprint: string;
          first_seen_check_id: string;
        }[];
      };
      const queued = new Map(d.checks.map((c) => [c.id, c.queued_at]));
      const sites = [...new Set(d.fixes.map((f) => f.site_id))];
      for (const site of sites) {
        const inEngineOrder = d.fixes
          .filter((f) => f.site_id === site)
          .sort(
            (a, b) =>
              queued
                .get(a.first_seen_check_id)!
                .localeCompare(queued.get(b.first_seen_check_id)!) ||
              (a.fingerprint < b.fingerprint ? -1 : a.fingerprint > b.fingerprint ? 1 : 0),
          )
          .map((f) => f.number);
        expect(inEngineOrder, `${file} ${site}`).toEqual([...inEngineOrder].sort((a, b) => a - b));
      }
    },
  );
});
