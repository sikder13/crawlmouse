import { readFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { ONCE_SPECS, owner, parsePart } from '../../../../tests/visual/part';

// The visual harness splits its preview routes across CI jobs (tests/visual/part.ts, CC-31 Q51):
// each job's `next dev` compiles only its share. These hold the split to "every path in exactly one
// share, a route's moments together, shares within one route of each other".

// The route a path compiles, written here rather than imported, so the tests do not agree with a
// wrong routeOf in part.ts.
const route = (path: string) => path.split('?')[0]!;

const VISUAL = resolve(fileURLToPath(new URL('.', import.meta.url)), '../../../../tests/visual');

describe('VISUAL_PART', () => {
  it('reads k/n, and unset or empty as every route', () => {
    expect(parsePart(undefined)).toEqual({ k: 1, n: 1 });
    expect(parsePart('')).toEqual({ k: 1, n: 1 });
    expect(parsePart('2/2')).toEqual({ k: 2, n: 2 });
    expect(parsePart(' 1/3 ')).toEqual({ k: 1, n: 3 });
  });

  it.each(['0/2', '3/2', '1', '1/0', 'a/b', '1/2/3', '-1/2'])('refuses %s', (v) => {
    expect(() => parsePart(v)).toThrow(/VISUAL_PART/);
  });
});

describe('the owner of a path', () => {
  // Routes with query moments, as the registry writes them: '/v2-preview/r3?at=5'.
  const paths = fc
    .uniqueArray(fc.integer({ min: 0, max: 400 }), { minLength: 1, maxLength: 60 })
    .chain((ids) =>
      fc.tuple(
        fc.constant(ids),
        fc.array(fc.tuple(fc.constantFrom(...ids), fc.integer({ min: 0, max: 9 })), {
          maxLength: 40,
        }),
      ),
    )
    .map(([ids, moments]) => [
      ...ids.map((i) => `/v2-preview/r${i}`),
      ...moments.map(([i, m]) => `/v2-preview/r${i}?at=${m}`),
    ]);

  it('puts every path in exactly one share, a route and its moments in the same one', () => {
    fc.assert(
      fc.property(paths, fc.integer({ min: 1, max: 6 }), (list, n) => {
        const owners = Array.from({ length: n }, (_, i) => owner(list, { k: i + 1, n }));
        const shareOf = new Map<string, number>();
        for (const path of list) {
          const shares = owners.flatMap((owns, i) => (owns(path) ? [i] : []));
          expect(shares).toHaveLength(1);
          const r = route(path);
          if (shareOf.has(r)) expect(shares[0]).toBe(shareOf.get(r));
          shareOf.set(r, shares[0]!);
        }
      }),
      { numRuns: 300 },
    );
  });

  it('gives the shares numbers of routes within one of each other', () => {
    fc.assert(
      fc.property(paths, fc.integer({ min: 1, max: 6 }), (list, n) => {
        const routes = [...new Set(list.map(route))];
        const sizes = Array.from(
          { length: n },
          (_, i) => routes.filter(owner(list, { k: i + 1, n })).length,
        );
        expect(Math.max(...sizes) - Math.min(...sizes)).toBeLessThanOrEqual(1);
      }),
      { numRuns: 300 },
    );
  });

  // Computed by hand: routes a, b, c dealt to two shares in order give a and c to the first. Were
  // '/b?x=1' and '/b' two routes, the deal would be a, b to the first and b?x=1, c to the second.
  it('deals the routes in order: a, c to the first of two, b and its moment to the second', () => {
    const list = ['/a', '/b?x=1', '/b', '/c'];
    const first = owner(list, { k: 1, n: 2 });
    const second = owner(list, { k: 2, n: 2 });
    expect(list.filter(first)).toEqual(['/a', '/c']);
    expect(list.filter(second)).toEqual(['/b?x=1', '/b']);
  });

  it('gives a route it was not told about to the first share only', () => {
    expect(owner(['/a', '/b'], { k: 1, n: 2 })('/elsewhere?at=1')).toBe(true);
    expect(owner(['/a', '/b'], { k: 2, n: 2 })('/elsewhere?at=1')).toBe(false);
  });

  it('owns every path when there is one share', () => {
    const owns = owner(['/a', '/b'], parsePart(undefined));
    expect(['/a', '/b?q', '/z'].every(owns)).toBe(true);
  });
});

describe('the specs that run in the first share only', () => {
  const specs = readdirSync(VISUAL).filter((f) => f.endsWith('.spec.ts'));

  it('name spec files that exist', () => {
    for (const f of ONCE_SPECS) expect(specs).toContain(f);
  });

  // A spec here is skipped in every share but the first, so one that looped over the previews
  // would check only the first share's. This reads the identifiers the split filters.
  it.each([...ONCE_SPECS])('%s does not read the split preview lists', (f) => {
    const source = readFileSync(join(VISUAL, f), 'utf8');
    expect(source).not.toMatch(/\b(PREVIEWS|MAIL_PREVIEWS|ownsPath)\b/);
  });
});
