import { PGlite } from '@electric-sql/pglite';
import { cube } from '@electric-sql/pglite/contrib/cube';
import { earthdistance } from '@electric-sql/pglite/contrib/earthdistance';
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto';
import { describe, expect, it } from 'vitest';
import type { Db, Row } from './db';
import { alignExtensions, EXTENSIONS_SQL, formatAlignment, readExtensions } from './extensions';
import { pgliteDb } from './test-support';

/**
 * Production as the dry run sees it: the read-only Management API, which answers queries and
 * refuses writes. `asked` records every text it was sent.
 */
function production(extensions: string[]): Db & { asked: string[] } {
  const asked: string[] = [];
  return {
    asked,
    async query<T extends Row>(text: string) {
      asked.push(text);
      if (text !== EXTENSIONS_SQL) throw new Error(`production was asked: ${text}`);
      return extensions.map((name) => ({ name })) as unknown as T[];
    },
    exec: async (text: string) => {
      asked.push(text);
      throw new Error('the read-only Management API connection cannot write');
    },
    transaction: async () => {
      throw new Error('the read-only Management API connection cannot write');
    },
    close: async () => {},
  };
}

/** A branch with plpgsql, pgcrypto, cube and earthdistance (which requires cube) installed. */
async function branchWithExtras(setup = '') {
  const pg = new PGlite({ extensions: { pgcrypto, cube, earthdistance } });
  await pg.exec(
    `create extension pgcrypto; create extension cube; create extension earthdistance;`,
  );
  if (setup) await pg.exec(setup);
  return pgliteDb(pg);
}

const drops = (executed: string[]) => executed.filter((t) => /^\s*drop\b/i.test(t));

describe('alignExtensions', () => {
  it('drops on the branch exactly the extensions production lacks, a required one last', async () => {
    const prod = production(['pgcrypto', 'plpgsql']);
    const branch = await branchWithExtras();
    const logged: string[] = [];
    const a = await alignExtensions(prod, branch, (l) => logged.push(l));
    expect(a).toEqual({ dropped: ['earthdistance', 'cube'], missing: [], equal: true });
    expect(drops(branch.executed)).toEqual([
      'drop extension "earthdistance"',
      'drop extension "cube"',
    ]);
    expect(await readExtensions(branch)).toEqual(['pgcrypto', 'plpgsql']);
    expect(logged).toEqual([
      'dropped extension earthdistance (production does not have it)',
      'dropped extension cube (production does not have it)',
    ]);
    expect(formatAlignment(a)).toBe(
      'extensions equal to production after alignment: yes, differences: none; dropped on the branch: earthdistance, cube',
    );
  });

  it('keeps every extension production has, pg_cron’s case', async () => {
    const branch = await branchWithExtras();
    const a = await alignExtensions(
      production(['cube', 'earthdistance', 'pgcrypto', 'plpgsql']),
      branch,
      () => {},
    );
    expect(a).toEqual({ dropped: [], missing: [], equal: true });
    expect(drops(branch.executed)).toEqual([]);
  });

  it('reports an extension production has and the branch lacks, and installs nothing', async () => {
    const branch = await branchWithExtras();
    const logged: string[] = [];
    const a = await alignExtensions(
      production(['cube', 'earthdistance', 'pg_cron', 'pgcrypto', 'plpgsql']),
      branch,
      (l) => logged.push(l),
    );
    expect(a).toEqual({ dropped: [], missing: ['pg_cron'], equal: false });
    expect(branch.executed.filter((t) => !/^\s*select\b/i.test(t))).toEqual([]);
    expect(logged).toEqual([
      'production has extension pg_cron and the branch does not; not installed',
    ]);
    expect(formatAlignment(a)).toBe(
      'extensions equal to production after alignment: no, differences: missing on the branch: pg_cron; dropped on the branch: none',
    );
  });

  it('never writes to production: it sends production one query, the extension list', async () => {
    const prod = production(['plpgsql']);
    await alignExtensions(prod, await branchWithExtras(), () => {});
    expect(prod.asked).toEqual([EXTENSIONS_SQL]);
  });

  it('fails, naming it and without CASCADE, when a table of ours depends on the extension', async () => {
    const branch = await branchWithExtras(
      `create table public.keys (k bytea default gen_random_bytes(4))`,
    );
    const failure = await alignExtensions(
      production(['cube', 'earthdistance', 'plpgsql']),
      branch,
      () => {},
    ).then(
      () => 'aligned',
      (e: Error) => e.message,
    );
    expect(failure).toMatch(/^could not drop extension pgcrypto on the branch: /);
    expect(branch.executed.some((t) => /cascade/i.test(t))).toBe(false);
    expect(await readExtensions(branch)).toContain('pgcrypto');
    const { rows } = await branch.pglite.query(
      `select to_regclass('public.keys') is not null as kept`,
    );
    expect(rows).toEqual([{ kept: true }]);
  });
});
