import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { compareFingerprints, readFingerprint, type ExpectedChange } from './fingerprint';
import { migratedDb, pgliteDb } from './test-support';

// 20261108000002_v2_definer_search_path.sql changes the functions section of the fingerprint and
// nothing else, by exactly the 20 lines its fixture lists. The fixture was read from production and
// its 'added' md5s predicted there by text replacement; applying the migration on PGlite, which
// renders these definitions as production does, yields the same lines.

const MIGRATION = '20261108000002_v2_definer_search_path.sql';
const fixture = JSON.parse(
  readFileSync(join(__dirname, 'fixtures/20261108000002-expected-change.json'), 'utf8'),
) as ExpectedChange;

const signature = (line: string) => line.slice(0, line.indexOf(' kind='));
const md5 = (line: string) => line.slice(line.lastIndexOf('definition=') + 'definition='.length);

describe('the expected change of 20261108000002', () => {
  const removed = fixture.removed!.functions!;
  const added = fixture.added!.functions!;

  it('lists 20 functions, each removed and added once, in the functions section only', () => {
    expect(Object.keys(fixture.removed!)).toEqual(['functions']);
    expect(Object.keys(fixture.added!)).toEqual(['functions']);
    expect(removed).toHaveLength(20);
    expect(added.map(signature)).toEqual(removed.map(signature));
    expect(new Set(removed.map(signature)).size).toBe(20);
  });

  it('changes only the definition of each line', () => {
    for (const [i, line] of removed.entries()) {
      expect(added[i]!.replace(md5(added[i]!), ''), signature(line)).toBe(
        line.replace(md5(line), ''),
      );
      expect(md5(added[i]!), signature(line)).not.toBe(md5(line));
    }
  });

  it('applied on PGlite, it changes the functions section only, by exactly those lines', async () => {
    const before = await migratedDb((f) => f < MIGRATION);
    // Migrations after this one are left out, so the compare is this file's change alone.
    const after = await migratedDb((f) => f <= MIGRATION);
    const differences = compareFingerprints(
      await readFingerprint(pgliteDb(before)),
      await readFingerprint(pgliteDb(after)),
    );
    expect(differences.map((d) => d.section)).toEqual(['functions']);
    const [functions] = differences;
    // Exact lines, md5 included: the migration as it runs produces what was predicted from production.
    expect([...functions!.added].sort()).toEqual([...added].sort());
    expect([...functions!.removed].sort()).toEqual([...removed].sort());
  }, 300_000);
});
