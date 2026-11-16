import { PGlite } from '@electric-sql/pglite';
import { cube } from '@electric-sql/pglite/contrib/cube';
import { earthdistance } from '@electric-sql/pglite/contrib/earthdistance';
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto';
import { describe, expect, it } from 'vitest';
import type { Db, Row } from './db';
import {
  alignExtensions,
  CREATE_ON_BRANCH,
  EXTENSIONS_SQL,
  formatAlignment,
  readExtensions,
} from './extensions';
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

/**
 * A branch on which pgcrypto, cube and earthdistance (which requires cube) are available; `installed`
 * says which are created. A fresh PGlite takes about a second alone and past 5s under a full suite's
 * load, so each test carries 120 s.
 */
async function branchWith(installed = ['pgcrypto', 'cube', 'earthdistance'], setup = '') {
  const pg = new PGlite({ extensions: { pgcrypto, cube, earthdistance } });
  for (const name of installed) await pg.exec(`create extension ${name}`);
  if (setup) await pg.exec(setup);
  return pgliteDb(pg);
}

const writes = (executed: string[]) => executed.filter((t) => !/^\s*select\b/i.test(t));

describe('alignExtensions', () => {
  it('drops on the branch exactly the extensions production lacks, a required one last', async () => {
    const prod = production(['pgcrypto', 'plpgsql']);
    const branch = await branchWith();
    const logged: string[] = [];
    const a = await alignExtensions(prod, branch, (l) => logged.push(l));
    expect(a).toEqual({
      dropped: ['earthdistance', 'cube'],
      created: [],
      refused: [],
      missing: [],
      equal: true,
    });
    expect(writes(branch.executed)).toEqual([
      'drop extension "earthdistance"',
      'drop extension "cube"',
    ]);
    expect(await readExtensions(branch)).toEqual(['pgcrypto', 'plpgsql']);
    expect(logged).toEqual([
      'dropped extension earthdistance (production does not have it)',
      'dropped extension cube (production does not have it)',
    ]);
    expect(formatAlignment(a)).toBe(
      'extensions equal to production after alignment: yes, differences: none; dropped on the branch: earthdistance, cube; created on the branch: none',
    );
  }, 120_000);

  it('keeps every extension production has', async () => {
    const branch = await branchWith();
    const a = await alignExtensions(
      production(['cube', 'earthdistance', 'pgcrypto', 'plpgsql']),
      branch,
      () => {},
    );
    expect(a).toEqual({ dropped: [], created: [], refused: [], missing: [], equal: true });
    expect(writes(branch.executed)).toEqual([]);
  }, 120_000);

  it('creates on the branch an allowlisted extension production has, and only that one', async () => {
    const branch = await branchWith(['pgcrypto']);
    const logged: string[] = [];
    const a = await alignExtensions(
      production(['cube', 'earthdistance', 'pgcrypto', 'plpgsql']),
      branch,
      (l) => logged.push(l),
      ['cube'],
    );
    expect(a).toEqual({
      dropped: [],
      created: ['cube'],
      refused: [],
      missing: ['earthdistance'],
      equal: false,
    });
    expect(writes(branch.executed)).toEqual(['create extension if not exists "cube"']);
    expect(await readExtensions(branch)).toEqual(['cube', 'pgcrypto', 'plpgsql']);
    expect(logged).toEqual([
      'created extension cube on the branch (production has it)',
      'production has extension earthdistance and the branch does not; not installed',
    ]);
  }, 120_000);

  it('the allowlist is pg_cron, and a branch that refuses it is logged and the step goes on', async () => {
    expect(CREATE_ON_BRANCH).toEqual(['pg_cron']);
    // PGlite has no pg_cron, so the create is refused, as a branch without it would refuse.
    const branch = await branchWith();
    const logged: string[] = [];
    const a = await alignExtensions(
      production(['cube', 'earthdistance', 'pg_cron', 'pgcrypto', 'plpgsql']),
      branch,
      (l) => logged.push(l),
    );
    expect(a.created).toEqual([]);
    expect(a.refused.map((r) => r.name)).toEqual(['pg_cron']);
    expect(a.missing).toEqual(['pg_cron']);
    expect(a.equal).toBe(false);
    expect(writes(branch.executed)).toEqual(['create extension if not exists "pg_cron"']);
    expect(logged[0]).toMatch(/^the branch refused to create extension pg_cron: /);
    expect(logged[1]).toBe(
      'production has extension pg_cron and the branch does not; not installed',
    );
    expect(formatAlignment(a)).toBe(
      'extensions equal to production after alignment: no, differences: missing on the branch: pg_cron; dropped on the branch: none; created on the branch: none; the branch refused to create: pg_cron',
    );
  }, 120_000);

  it('creates nothing that is not on the allowlist', async () => {
    const branch = await branchWith(['pgcrypto']);
    const a = await alignExtensions(
      production(['cube', 'pgcrypto', 'plpgsql']),
      branch,
      () => {},
      [],
    );
    expect(a).toEqual({ dropped: [], created: [], refused: [], missing: ['cube'], equal: false });
    expect(writes(branch.executed)).toEqual([]);
  }, 120_000);

  it('never writes to production: it sends production one query, the extension list', async () => {
    const prod = production(['cube', 'plpgsql']);
    await alignExtensions(prod, await branchWith(['pgcrypto']), () => {}, ['cube']);
    expect(prod.asked).toEqual([EXTENSIONS_SQL]);
  }, 120_000);

  it('fails, naming it and without CASCADE, when a table of ours depends on the extension', async () => {
    const branch = await branchWith(
      ['pgcrypto', 'cube', 'earthdistance'],
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
  }, 120_000);
});
