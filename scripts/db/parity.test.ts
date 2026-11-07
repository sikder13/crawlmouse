import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { PGlite } from '@electric-sql/pglite';
import { beforeAll, describe, expect, it } from 'vitest';
import { listMigrations, rollbackPath } from './files';
import { compareFingerprints, readFingerprint, type Fingerprint } from './fingerprint';
import { migratedDb, pgliteDb, withRollback } from './test-support';

const FIXTURE = JSON.parse(
  readFileSync(join(__dirname, 'fixtures/2026-11-06-settled-branch-vs-production.json'), 'utf8'),
) as { only_on_production: Record<'acls' | 'default_acls' | 'buckets', string[]> };
const MEASURED = FIXTURE.only_on_production;

const P1 = listMigrations().find((m) => m.name === 'service_role_parity')!;
const P1_ROLLBACK = readFileSync(rollbackPath(P1), 'utf8');
const executable = (sql: string) =>
  sql
    .split('\n')
    .filter((l) => !l.trimStart().startsWith('--'))
    .join('\n');

/** The fingerprint lines a P1 statement stands for, read from its text. */
function linesOf(sql: string): string[] {
  const kinds: Record<string, string> = { tables: 'r', sequences: 'S', functions: 'f' };
  const out: string[] = [];
  for (const raw of executable(sql).split(';')) {
    const s = raw.replace(/\s+/g, ' ').trim();
    let m =
      /^alter default privileges for role postgres in schema public grant (.+) on (tables|sequences|functions) to (\w+)$/.exec(
        s,
      );
    if (m) {
      for (const p of m[1]!.split(', '))
        out.push(`postgres in public on ${kinds[m[2]!]}: ${m[3]} ${p.toUpperCase()}`);
      continue;
    }
    m = /^grant (.+) on table (\S+) to (\w+)$/.exec(s);
    if (m) {
      for (const p of m[1]!.split(', ')) out.push(`relation ${m[2]} ${m[3]} ${p.toUpperCase()}`);
      continue;
    }
    m = /^grant (\w+) on function (.+\)) to (\w+)$/.exec(s);
    if (m) out.push(`function ${m[2]} ${m[3]} ${m[1]!.toUpperCase()}`);
  }
  return out.sort();
}

const serviceRole = (lines: string[]) =>
  lines.filter((l) => / service_role [A-Z]+$/.test(l)).sort();

describe('P1, 20261106000001_service_role_parity: the service_role lines a branch lacks', () => {
  it('grants exactly the measured service_role grants and default privileges, and no others', () => {
    expect(serviceRole(MEASURED.acls)).toHaveLength(74);
    expect(serviceRole(MEASURED.default_acls)).toHaveLength(8);
    expect(linesOf(P1.sql)).toEqual(
      [...serviceRole(MEASURED.acls), ...serviceRole(MEASURED.default_acls)].sort(),
    );
  });

  it('names no client role: the anon and authenticated lines are not written down', () => {
    expect(executable(P1.sql)).not.toMatch(/\b(anon|authenticated|public\s*;)/i);
  });

  describe('on a database migrated like production', () => {
    let pg: PGlite;
    let asBranch: Fingerprint;
    // A branch: the same objects without the service_role lines and without the bucket.
    const BRANCH = `
      ${serviceRole(MEASURED.acls)
        .map((l) => /^(relation|function) (.+) service_role (\w+)$/.exec(l)!)
        .map(([, kind, obj, priv]) =>
          kind === 'relation'
            ? `revoke ${priv} on table ${obj} from service_role;`
            : `revoke ${priv} on function ${obj} from service_role;`,
        )
        .join('\n')}
      alter default privileges for role postgres in schema public
        revoke delete, insert, select, update on tables from service_role;
      alter default privileges for role postgres in schema public
        revoke select, update, usage on sequences from service_role;
      alter default privileges for role postgres in schema public
        revoke execute on functions from service_role;
      delete from storage.buckets where id = 'report-logos';`;

    beforeAll(async () => {
      pg = await migratedDb((f) => f < P1.file);
      await pg.exec(`set session storage.allow_delete_query = 'true'`);
      await pg.exec(BRANCH);
      asBranch = await readFingerprint(pgliteDb(pg));
    }, 300_000);

    it('adds the measured lines to a branch, and nothing else', async () => {
      const after = await withRollback(pg, async (tx) => {
        await tx.exec(P1.sql);
        return readFingerprint(tx);
      });
      const differences = compareFingerprints(asBranch, after);
      expect(differences.map((d) => d.section)).toEqual(['acls', 'buckets', 'default_acls']);
      for (const d of differences) expect(d.removed).toEqual([]);
      const added = Object.fromEntries(differences.map((d) => [d.section, [...d.added].sort()]));
      expect(added).toEqual({
        acls: serviceRole(MEASURED.acls),
        buckets: MEASURED.buckets,
        default_acls: serviceRole(MEASURED.default_acls),
      });
    }, 300_000);

    it('changes nothing where it has already run, as on production', async () => {
      const [once, twice] = await withRollback(pg, async (tx) => {
        await tx.exec(P1.sql);
        const first = await readFingerprint(tx);
        await tx.exec(P1.sql);
        return [first, await readFingerprint(tx)] as const;
      });
      expect(compareFingerprints(once, twice)).toEqual([]);
    }, 300_000);

    it('keeps a bucket that exists, with its settings and objects', async () => {
      const rows = await withRollback(pg, async (tx) => {
        await tx.exec(`insert into storage.buckets (id, name, public, file_size_limit)
                       values ('report-logos', 'report-logos', false, 1)`);
        await tx.exec(
          `insert into storage.objects (bucket_id, name) values ('report-logos', 'a.png')`,
        );
        await tx.exec(P1.sql);
        return tx.query(`select b.public, b.file_size_limit, count(o.*)::int as objects
                         from storage.buckets b left join storage.objects o on o.bucket_id = b.id
                         where b.id = 'report-logos' group by 1, 2`);
      });
      expect(rows).toEqual([{ public: false, file_size_limit: 1, objects: 1 }]);
    }, 300_000);

    it('its rollback changes nothing', async () => {
      const [applied, reverted] = await withRollback(pg, async (tx) => {
        await tx.exec(P1.sql);
        const before = await readFingerprint(tx);
        await tx.exec(P1_ROLLBACK);
        return [before, await readFingerprint(tx)] as const;
      });
      expect(compareFingerprints(applied, reverted)).toEqual([]);
    }, 300_000);
  });
});
