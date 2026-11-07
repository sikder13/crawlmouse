import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { PGlite } from '@electric-sql/pglite';
import { beforeAll, describe, expect, it } from 'vitest';
import { listMigrations, rollbackPath } from './files';
import { compareFingerprints, readFingerprint, type Fingerprint } from './fingerprint';
import { grantSql, migratedDb, pgliteDb, withRollback } from './test-support';

interface Lines {
  acls: string[];
  default_acls: string[];
}
const EXPECTED = JSON.parse(
  readFileSync(join(__dirname, 'fixtures/20261106000002-expected-change.json'), 'utf8'),
) as { before: Lines; after: Lines; removed: Lines; added: { acls: string[] } };

const P2 = listMigrations().find((m) => m.name === 'v1_client_grant_hardening')!;
const P2_ROLLBACK = readFileSync(rollbackPath(P2), 'utf8');

const V1_TABLES = [
  'audits',
  'benchmark_cohorts',
  'domain_verifications',
  'email_events',
  'embed_badges',
  'findings',
  'fixes',
  'frontier',
  'frontier_politeness',
  'links',
  'pages',
  'public_reports',
  'rate_limits',
  'sessions',
  'stripe_events',
  'takedown_requests',
  'users',
  'waitlist',
];
const V1_FUNCTIONS = [
  'public.handle_new_user()',
  'public.increment_rate_limit(p_bucket_key text, p_window_start timestamp with time zone)',
];

const statements = (sql: string) =>
  sql
    .split('\n')
    .filter((l) => !l.trimStart().startsWith('--'))
    .join('\n')
    .split(';')
    .map((s) => s.replace(/\s+/g, ' ').trim())
    .filter(Boolean);

const KINDS: Record<string, string> = { tables: 'r', sequences: 'S', functions: 'f' };
const list = (s: string) => s.split(',').map((x) => x.trim());

/** The fingerprint lines a grant or revoke statement names, with which of the two it is. */
function linesOf(sql: string): { granted: string[]; revoked: string[] } {
  const granted: string[] = [];
  const revoked: string[] = [];
  for (const s of statements(sql)) {
    let m =
      /^alter default privileges for role postgres in schema public (grant|revoke) (.+) on (tables|sequences|functions) (?:to|from) (.+)$/.exec(
        s,
      );
    if (m) {
      for (const role of list(m[4]!))
        for (const p of list(m[2]!))
          (m[1] === 'grant' ? granted : revoked).push(
            `postgres in public on ${KINDS[m[3]!]}: ${role} ${p.toUpperCase()}`,
          );
      continue;
    }
    m = /^(grant|revoke) select \((.+)\) on table (\S+) (?:to|from) (.+)$/.exec(s);
    if (m) {
      for (const role of list(m[4]!))
        for (const c of list(m[2]!))
          (m[1] === 'grant' ? granted : revoked).push(`column ${m[3]}.${c} ${role} SELECT`);
      continue;
    }
    m = /^grant (.+) on table (\S+) to (.+)$/.exec(s);
    if (m) {
      for (const role of list(m[3]!))
        for (const p of list(m[1]!)) granted.push(`relation ${m[2]} ${role} ${p.toUpperCase()}`);
    }
  }
  return { granted: granted.sort(), revoked: revoked.sort() };
}

/** The lines that name anon or authenticated on the v1 objects, as the fixture selects them. */
function clientLines(fp: Fingerprint): Lines {
  const onV1 = (l: string) => {
    const m =
      /^relation public\.(\w+) (anon|authenticated) [A-Z]+$/.exec(l) ??
      /^column public\.(\w+)\.\w+ (anon|authenticated) [A-Z]+$/.exec(l);
    if (m) return V1_TABLES.includes(m[1]!);
    return (
      V1_FUNCTIONS.some((f) => l.startsWith(`function ${f} `)) &&
      / (anon|authenticated) [A-Z]+$/.test(l)
    );
  };
  return {
    acls: fp.get('acls')!.lines.filter(onV1).sort(),
    default_acls: fp
      .get('default_acls')!
      .lines.filter((l) => /^postgres in public on \w: (anon|authenticated) [A-Z]+$/.test(l))
      .sort(),
  };
}

const AUTHENTICATED_KEEPS = {
  users: ['id', 'pro_until', 'stripe_customer_id'],
  audits: [
    'id',
    'url',
    'grade',
    'score',
    'confidence',
    'completed_at',
    'previous_audit_id',
    'status',
    'expires_at',
  ],
  domain_verifications: ['id', 'domain', 'method', 'verification_token', 'verified_at', 'user_id'],
};

describe('P2, 20261106000002_v1_client_grant_hardening: the expected change', () => {
  it('is production before, minus the lines the app does not use, plus the column grants it does', () => {
    const after = Object.entries(AUTHENTICATED_KEEPS)
      .flatMap(([t, cols]) => cols.map((c) => `column public.${t}.${c} authenticated SELECT`))
      .sort();
    expect(EXPECTED.after).toEqual({ acls: after, default_acls: [] });
    expect(EXPECTED.removed.acls).toEqual(EXPECTED.before.acls.filter((l) => !after.includes(l)));
    expect(EXPECTED.removed.default_acls).toEqual(EXPECTED.before.default_acls);
    expect(EXPECTED.added.acls).toEqual(after.filter((l) => !EXPECTED.before.acls.includes(l)));
    // anon keeps nothing on the v1 objects.
    expect(EXPECTED.after.acls.filter((l) => / anon /.test(l))).toEqual([]);
  });

  it('P2 revokes every client privilege on the v1 objects and grants back exactly the kept columns', () => {
    const ss = statements(P2.sql);
    for (const kind of ['tables', 'sequences', 'functions'])
      expect(ss).toContain(
        `alter default privileges for role postgres in schema public revoke all on ${kind} from anon, authenticated`,
      );
    expect(ss).toContain(
      `revoke all on table ${V1_TABLES.map((t) => `public.${t}`).join(', ')} from anon, authenticated`,
    );
    expect(ss).toContain(
      `revoke all on function ${V1_FUNCTIONS.join(', ')} from anon, authenticated`,
    );
    expect(linesOf(P2.sql).granted).toEqual(EXPECTED.after.acls);
  });

  it('its rollback grants back exactly the removed lines and revokes exactly the added ones', () => {
    const { granted, revoked } = linesOf(P2_ROLLBACK);
    expect(granted).toEqual([...EXPECTED.removed.acls, ...EXPECTED.removed.default_acls].sort());
    expect(revoked).toEqual(EXPECTED.added.acls);
  });

  it('names service_role nowhere', () => {
    for (const sql of [P2.sql, P2_ROLLBACK])
      expect(statements(sql).join(';')).not.toContain('service_role');
  });
});

describe('P2 on a database migrated like production', () => {
  let pg: PGlite;
  let beforeP2: Fingerprint;
  const USER = '00000000-0000-4000-8000-000000000001';

  beforeAll(async () => {
    pg = await migratedDb((f) => f < P2.file);
    // Production's client lines before P2, so P2 and its rollback start where production does.
    await pg.exec(
      `revoke all on table ${V1_TABLES.map((t) => `public.${t}`).join(', ')} from anon, authenticated;
       alter default privileges for role postgres in schema public revoke all on tables from anon, authenticated;
       alter default privileges for role postgres in schema public revoke all on sequences from anon, authenticated;
       alter default privileges for role postgres in schema public revoke all on functions from anon, authenticated;`,
    );
    await pg.exec(grantSql([...EXPECTED.before.acls, ...EXPECTED.before.default_acls]));
    beforeP2 = await readFingerprint(pgliteDb(pg));
    await pg.exec(`
      insert into auth.users (id, email) values ('${USER}', 'owner@example.test') on conflict do nothing;
      insert into public.users (id, email) values ('${USER}', 'owner@example.test') on conflict do nothing;
      insert into public.audits (id, url, user_id, status)
        values ('00000000-0000-4000-8000-0000000000a1', 'https://example.test', '${USER}', 'completed');
      insert into public.domain_verifications (id, user_id, domain, method, verification_token)
        values ('00000000-0000-4000-8000-0000000000d1', '${USER}', 'example.test', 'dns_txt', 'tok');`);
  }, 300_000);

  it("starts from production's client lines", () => {
    expect(clientLines(beforeP2)).toEqual(EXPECTED.before);
  });

  it('leaves exactly the kept column grants, and changes no line outside them', async () => {
    const after = await withRollback(pg, async (tx) => {
      await tx.exec(P2.sql);
      return readFingerprint(tx);
    });
    expect(clientLines(after)).toEqual(EXPECTED.after);
    const differences = compareFingerprints(beforeP2, after);
    expect(differences.map((d) => d.section)).toEqual(['acls', 'default_acls']);
    const added = differences.flatMap((d) => d.added).sort();
    const removed = differences.flatMap((d) => d.removed).sort();
    expect(added).toEqual(EXPECTED.added.acls);
    expect(removed).toEqual([...EXPECTED.removed.acls, ...EXPECTED.removed.default_acls].sort());
  }, 300_000);

  it('changes nothing when run again, and its rollback returns production before', async () => {
    const [once, twice, reverted] = await withRollback(pg, async (tx) => {
      await tx.exec(P2.sql);
      const a = await readFingerprint(tx);
      await tx.exec(P2.sql);
      const b = await readFingerprint(tx);
      await tx.exec(P2_ROLLBACK);
      return [a, b, await readFingerprint(tx)] as const;
    });
    expect(compareFingerprints(once, twice)).toEqual([]);
    expect(compareFingerprints(beforeP2, reverted)).toEqual([]);
  }, 300_000);

  /** Runs `sql` as a client role after P2, in a transaction that is always rolled back. */
  async function asClient(role: 'anon' | 'authenticated', sql: string, params: unknown[] = []) {
    const done = new Error('rolled back');
    let result: { rows?: unknown[]; error?: string } = {};
    try {
      await pg.transaction(async (tx) => {
        await tx.exec(P2.sql);
        await tx.exec(`set local role ${role}`);
        if (role === 'authenticated')
          await tx.query(`select set_config('request.jwt.claim.sub', $1, true)`, [USER]);
        result = { rows: (await tx.query(sql, params)).rows };
        throw done;
      });
    } catch (err) {
      if (err !== done) result = { error: (err as Error).message };
    }
    return result;
  }

  it.each([
    [
      'the dashboard list (lib/dashboard.ts:143)',
      `select id, url, grade, score, confidence, completed_at, previous_audit_id from public.audits
       where status = 'completed' and (expires_at is null or expires_at > now())
       order by completed_at desc limit 200`,
    ],
    ['the Pro check (lib/pro.ts:9)', `select pro_until from public.users where id = '${USER}'`],
    [
      'the Stripe customer lookup (app/api/billing/checkout/route.ts:21)',
      `select stripe_customer_id from public.users where id = '${USER}'`,
    ],
    [
      'the verify page (app/verify/[id]/page.tsx:33)',
      `select id, domain, method, verification_token, verified_at from public.domain_verifications
       where id = '00000000-0000-4000-8000-0000000000d1' and user_id = '${USER}'`,
    ],
  ])(
    'a signed-in user can still run %s',
    async (_label, sql) => {
      const r = await asClient('authenticated', sql);
      expect(r.error).toBeUndefined();
      expect(r.rows).toHaveLength(1);
    },
    300_000,
  );

  it.each([
    ['authenticated', 'select page_count from public.audits'],
    ['authenticated', 'select email from public.users'],
    ['authenticated', 'select url from public.pages'],
    ['authenticated', 'select slug from public.public_reports'],
    ['authenticated', `update public.audits set status = 'failed'`],
    ['authenticated', 'delete from public.users'],
    [
      'authenticated',
      `insert into public.embed_badges (user_id, domain) values ('${USER}', 'example.test')`,
    ],
    ['authenticated', `update public.embed_badges set domain = 'x'`],
    ['anon', 'select id from public.audits'],
    ['anon', 'select slug from public.public_reports'],
    ['anon', 'truncate public.audits'],
    ['anon', `insert into public.users (email) values ('x@example.test')`],
    // The tRPC procedures, left without grants by the owner's ruling: their exact queries
    // (apps/web/lib/audits.ts:24 for listMine, apps/web/lib/trpc/router.ts:18 for getById).
    [
      'authenticated',
      `select id, url, grade, score, status, started_at, completed_at from public.audits
       where (expires_at is null or expires_at > now()) order by started_at desc limit 50`,
    ],
    [
      'authenticated',
      `select id, url, status, grade, score, page_count, link_count, cms_detected, started_at, completed_at
       from public.audits where id = '00000000-0000-4000-8000-0000000000a1'`,
    ],
    [
      'anon',
      `select id, url, status, grade, score, page_count, link_count, cms_detected, started_at, completed_at
       from public.audits where id = '00000000-0000-4000-8000-0000000000a1'`,
    ],
  ])(
    '%s is refused: %s',
    async (role, sql) => {
      const r = await asClient(role as 'anon' | 'authenticated', sql);
      expect(r.error).toMatch(/permission denied/);
    },
    300_000,
  );
});
