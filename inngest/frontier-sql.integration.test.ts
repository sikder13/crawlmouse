import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import http from 'node:http';
import { readFileSync, rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import EmbeddedPostgres from 'embedded-postgres';
import type { Client } from 'pg';
import { runCrawl } from '@crawlmouse/engine';
import type { FrontierOutcome, FrontierRecord, FrontierStore } from '@crawlmouse/engine';

// ─────────────────────────────────────────────────────────────────────────────
// SPEC 5.1a §8 (Stage 6) — the frontier against a REAL PostgreSQL, running the REAL migrations.
//
// WHY A REAL SERVER AND NOT PGlite. PGlite is real Postgres and is the right tool for the text-safety
// oracle, but it is ONE BACKEND: pglite-socket's "concurrent connections" are a multiplexer over a
// single session (both clients report the same `pg_backend_pid`, and the second query then deadlocks
// behind the first's open transaction). `FOR UPDATE SKIP LOCKED` is only meaningful under contention,
// and `EXPLAIN` output is byte-identical with and without it — so on PGlite the claim could only have
// been "verified" by grepping the function body, which is prose-matching, not proof.
// `embedded-postgres` runs the real server as a user process (no docker, no root), pinned to the 17
// line because production is 17.6.
//
// WHAT THIS FILE CAN AND CANNOT REACH, stated because the boundary matters. It executes the SQL the
// worker executes. It does NOT execute the supabase-js hop — nothing local can — so the PostgREST
// adapter's call shape is pinned separately and only the live smoke on the deployed function proves
// it end to end. That is why the adapter is kept free of rules: every rule that could be wrong is in
// SQL, which this file runs for real.
// ─────────────────────────────────────────────────────────────────────────────

const HERE = path.dirname(fileURLToPath(import.meta.url));
const MIGRATIONS = path.join(HERE, '..', 'infra', 'supabase', 'migrations');
const AUDIT_A = '11111111-1111-1111-1111-111111111111';

let pg: EmbeddedPostgres;
let db: Client;
let server: http.Server;
let baseUrl: string;

const HUBS = ['article', 'listing', 'guide', 'tag'];
const LEAVES = 20;
const SITE_SIZE = 1 + HUBS.length + HUBS.length * LEAVES;

beforeAll(async () => {
  // A run killed mid-flight leaves a dirty cluster directory, and `initialise()` then fails — which
  // would SKIP this whole file rather than fail it. A skipped suite that reads as green is the
  // failure mode this file exists to prevent, so the directory is cleared first, unconditionally.
  const dataDir = path.join(HERE, '.pgdata-frontier-test');
  rmSync(dataDir, { recursive: true, force: true });
  pg = new EmbeddedPostgres({
    databaseDir: dataDir,
    user: 'postgres', password: 'test', port: 55450, persistent: false,
  });
  await pg.initialise();
  await pg.start();
  db = pg.getPgClient();
  await db.connect();
  // The Supabase roles the migrations reference, and the parent table created by earlier migrations.
  await db.query(`create role anon; create role authenticated; create role service_role;`);
  await db.query(`create table public.audits (id uuid primary key)`);
  await db.query(`grant usage on schema public to anon, authenticated, service_role`);
  for (const f of [
    '20260805000001_spec51a_stage5_frontier_checkpoint.sql',
    '20260806000001_spec51a_stage6_frontier_functions.sql',
    '20260806000002_spec51a_stage6_settle_frontier_batch.sql',
  ]) {
    await db.query(readFileSync(path.join(MIGRATIONS, f), 'utf8'));
  }
  await db.query(`insert into public.audits (id) values ($1)`, [AUDIT_A]);

  const page = (links: string[]) =>
    `<html><head><title>t</title></head><body>${links.map((h) => `<a href="${h}">go ${h}</a>`).join(' ')}</body></html>`;
  server = http.createServer((req, res) => {
    const p = req.url ?? '/';
    if (p === '/robots.txt' || p === '/sitemap.xml') { res.statusCode = 404; res.end(''); return; }
    const send = (h: string) => { res.setHeader('content-type', 'text/html'); res.end(h); };
    if (p === '/' || p === '') { send(page(HUBS.map((h) => `/${h}`))); return; }
    const hub = p.match(/^\/([a-z]+)$/);
    if (hub && HUBS.includes(hub[1]!)) { send(page(Array.from({ length: LEAVES }, (_, i) => `/${hub[1]}/p-${i}`))); return; }
    if (/^\/[a-z]+\/p-\d+$/.test(p)) { send(page(['/'])); return; }
    res.statusCode = 404; res.end('nf');
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  baseUrl = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
}, 180_000);

afterAll(async () => {
  await new Promise<void>((r) => server?.close(() => r()));
  await db?.end();
  await pg?.stop();
});

/**
 * A FrontierStore over node-postgres, calling THE SAME SQL FUNCTIONS the worker's PostgREST adapter
 * calls. Both adapters are thin by design; the semantics live in the migrations, so this exercises the
 * deployed rules even though it cannot exercise the deployed transport.
 */
function pgFrontierStore(client: Client, auditId: string, killOn?: { hook: string; after: number }): FrontierStore {
  const counts: Record<string, number> = {};
  const trip = (hook: string) => {
    counts[hook] = (counts[hook] ?? 0) + 1;
    if (killOn && killOn.hook === hook && counts[hook]! > killOn.after) throw new Error(`worker died at ${hook}`);
  };
  return {
    async upsertDiscovered(records: FrontierRecord[]) {
      if (!records.length) return;
      await client.query('select public.upsert_frontier_batch($1,$2,$3,$4,$5,$6,$7)', [
        auditId,
        records.map((r) => r.urlHash), records.map((r) => r.url), records.map((r) => r.templateKey),
        records.map((r) => r.sampleKey), records.map((r) => r.depth), records.map((r) => r.source),
      ]);
      trip('upsert');
    },
    async allDiscovered() {
      // NO ORDER BY, on purpose: Postgres guarantees none, and a resume that depends on read order
      // must fail rather than pass by luck.
      const { rows } = await client.query(
        `select url_hash, url, template_key, sample_key, depth, state, source
           from public.frontier where audit_id = $1`, [auditId]);
      return rows.map((r) => ({
        urlHash: r.url_hash, url: r.url, templateKey: r.template_key, sampleKey: r.sample_key,
        depth: r.depth, state: r.state, source: r.source,
      })) as FrontierRecord[];
    },
    async claim(urls: string[], limit: number) {
      if (!urls.length || limit <= 0) return [];
      const { rows } = await client.query(
        'select url_hash, url, template_key, sample_key, depth, state, source from public.claim_frontier($1,$2,$3)',
        [auditId, urls.map(hashOf), limit]);
      trip('claim');
      return rows.map((r) => ({
        urlHash: r.url_hash, url: r.url, templateKey: r.template_key, sampleKey: r.sample_key,
        depth: r.depth, state: r.state, source: r.source,
      })) as FrontierRecord[];
    },
    async settleBatch(outcomes: FrontierOutcome[]) {
      if (!outcomes.length) return;
      trip('settle');
      await client.query('select public.settle_frontier_batch($1,$2,$3)', [
        auditId, outcomes.map((o) => o.urlHash), outcomes.map((o) => o.state),
      ]);
    },
    async deleteAll() {
      await client.query('delete from public.frontier where audit_id = $1', [auditId]);
    },
  };
}

function hashOf(url: string): string {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  return require('node:crypto').createHash('sha256').update(url).digest('hex');
}

const crawlInput = (store: FrontierStore | undefined) => ({
  startUrls: [baseUrl], pageCap: 200, perHostConcurrency: 4, staggerMs: 0, pageTimeoutMs: 5000,
  allowPrivateIpsForTesting: true, deterministicFrontier: true, politeCrawl: true,
  maxCrawlMs: 60_000, frontierStore: store,
});

const rowCount = async () =>
  Number((await db.query(`select count(*)::int n from public.frontier where audit_id=$1`, [AUDIT_A])).rows[0].n);

describe('the crawl against a real Postgres frontier', () => {
  it('persists, claims, settles and DELETES at completion — through the real SQL functions', async () => {
    await db.query(`delete from public.frontier`);
    const out = await runCrawl(crawlInput(pgFrontierStore(db, AUDIT_A)));
    expect(out.pages.length).toBe(SITE_SIZE);
    expect(out.fingerprint!.discoveredCount).toBe(SITE_SIZE);
    expect(await rowCount()).toBe(0); // transient working state, gone on success
  }, 180_000);

  it('ACCEPTANCE: killed mid-flight and resumed => identical fingerprint digest', async () => {
    await db.query(`delete from public.frontier`);
    const straight = await runCrawl(crawlInput(pgFrontierStore(db, AUDIT_A)));

    await db.query(`delete from public.frontier`);
    await expect(runCrawl(crawlInput(pgFrontierStore(db, AUDIT_A, { hook: 'settle', after: 1 }))))
      .rejects.toThrow(/worker died/);
    // The delete never ran, so there is something to resume from.
    expect(await rowCount()).toBeGreaterThan(0);

    const resumed = await runCrawl(crawlInput(pgFrontierStore(db, AUDIT_A)));
    expect(resumed.fingerprint!.digest).toBe(straight.fingerprint!.digest);
    expect(await rowCount()).toBe(0);
  }, 180_000);
});

describe('claim_frontier under REAL contention', () => {
  it('gives two concurrent workers DISJOINT rows without either waiting', async () => {
    await db.query(`delete from public.frontier`);
    const hashes = Array.from({ length: 8 }, (_, i) => `c${i}`);
    for (const h of hashes) {
      await db.query(
        `insert into public.frontier (audit_id,url_hash,url,template_key,sample_key,depth,source)
         values ($1,$2,$3,'/t','k',1,'link')`, [AUDIT_A, h, `https://x.test/${h}`]);
    }
    const w1 = pg.getPgClient(); await w1.connect();
    const w2 = pg.getPgClient(); await w2.connect();
    try {
      // Two DISTINCT backends — the property PGlite cannot provide.
      const p1 = Number((await w1.query('select pg_backend_pid() p')).rows[0].p);
      const p2 = Number((await w2.query('select pg_backend_pid() p')).rows[0].p);
      expect(p1).not.toBe(p2);

      // w1 claims inside an open transaction and HOLDS the locks.
      await w1.query('begin');
      const a = await w1.query('select url_hash from public.claim_frontier($1,$2,$3)', [AUDIT_A, hashes, 3]);
      // w2 claims concurrently. SKIP LOCKED must hand it a disjoint set rather than block.
      //
      // A STATEMENT TIMEOUT, so that "it blocked" FAILS instead of HANGING. Without SKIP LOCKED this
      // claim waits on w1's uncommitted lock while the test awaits the claim, and w1's commit is on
      // the far side of that await — a deadlock between test and fixture that reads as a 400-second
      // timeout rather than a result. Two seconds converts it into an assertion.
      await w2.query("set statement_timeout = '2s'");
      const started = Date.now();
      const b = await w2.query('select url_hash from public.claim_frontier($1,$2,$3)', [AUDIT_A, hashes, 3]);
      const waited = Date.now() - started;
      await w2.query("set statement_timeout = 0");

      const setA = new Set(a.rows.map((r) => r.url_hash));
      expect(a.rows).toHaveLength(3);
      expect(b.rows).toHaveLength(3);
      expect(b.rows.filter((r) => setA.has(r.url_hash))).toEqual([]);
      // It SKIPPED rather than queued. A blocking claim would sit on w1's uncommitted lock.
      expect(waited).toBeLessThan(2_000);
      await w1.query('commit');
    } finally {
      await w1.end(); await w2.end();
    }
  }, 120_000);
});

describe('delete_orphan_frontier_rows', () => {
  it('deletes on AGE ALONE, and leaves anything inside the TTL', async () => {
    await db.query(`delete from public.frontier`);
    const mk = async (h: string, age: string) => db.query(
      `insert into public.frontier (audit_id,url_hash,url,template_key,sample_key,depth,source,updated_at)
       values ($1,$2,$3,'/t','k',1,'link', now() - $4::interval)`, [AUDIT_A, h, `https://x.test/${h}`, age]);
    await mk('old1', '25 hours');
    await mk('old2', '40 days');
    await mk('fresh1', '23 hours');   // just inside the TTL — must survive
    await mk('fresh2', '1 minute');

    const deleted = Number((await db.query('select public.delete_orphan_frontier_rows(500) n')).rows[0].n);
    expect(deleted).toBe(2);
    const left = (await db.query(`select url_hash from public.frontier order by url_hash`)).rows.map((r) => r.url_hash);
    expect(left).toEqual(['fresh1', 'fresh2']);
  }, 120_000);

  it('USES frontier_updated_at_idx — an unindexed sweep returns the same rows while full-scanning', async () => {
    // Asserting the ROWS cannot distinguish an index scan from a sequential one, and the sweep runs
    // daily against the largest table in the schema at exactly its largest. So assert the PLAN.
    await db.query(`delete from public.frontier`);
    await db.query(
      `insert into public.frontier (audit_id,url_hash,url,template_key,sample_key,depth,source,updated_at)
       select $1, 'b'||g, 'https://x.test/b'||g, '/t', 'k'||g, 1, 'link', now() - (g || ' minutes')::interval
         from generate_series(1, 20000) g`, [AUDIT_A]);
    await db.query('analyze public.frontier');
    const { rows } = await db.query(`explain (format json)
      select f.audit_id, f.url_hash from public.frontier f
       where f.updated_at < now() - interval '24 hours'
       order by f.updated_at limit 500`);
    const plan = JSON.stringify(rows[0]['QUERY PLAN']);
    expect(plan).toContain('frontier_updated_at_idx');
    expect(plan).not.toContain('Seq Scan');
    await db.query(`delete from public.frontier`);
  }, 120_000);
});

describe('upsert_frontier_batch — re-discovery must not un-settle a row', () => {
  it('lowers depth via least() and NEVER writes state', async () => {
    await db.query(`delete from public.frontier`);
    const up = (depth: number) => db.query('select public.upsert_frontier_batch($1,$2,$3,$4,$5,$6,$7)',
      [AUDIT_A, ['u1'], ['https://x.test/u1'], ['/t'], ['k'], [depth], ['link']]);
    await up(5);
    await db.query('select public.settle_frontier_batch($1,$2,$3)', [AUDIT_A, ['u1'], ['fetched']]);

    await up(2); // shallower re-discovery — the case a PostgREST upsert would get wrong
    let r = (await db.query(`select depth, state from public.frontier where url_hash='u1'`)).rows[0];
    expect(r.depth).toBe(2);
    expect(r.state).toBe('fetched'); // not reset to 'discovered'

    await up(9); // deeper re-discovery must not raise it
    r = (await db.query(`select depth, state from public.frontier where url_hash='u1'`)).rows[0];
    expect(r.depth).toBe(2);
    expect(r.state).toBe('fetched');
  }, 120_000);

  it('cannot reach another audit\'s rows, and tolerates a duplicate hash in one batch', async () => {
    const AUDIT_B = '22222222-2222-2222-2222-222222222222';
    await db.query(`insert into public.audits (id) values ($1) on conflict do nothing`, [AUDIT_B]);
    await db.query(`delete from public.frontier`);
    await db.query(
      `insert into public.frontier (audit_id,url_hash,url,template_key,sample_key,depth,source,state)
       values ($1,'u1','https://other/1','/t','k',4,'link','fetched')`, [AUDIT_B]);

    await db.query('select public.upsert_frontier_batch($1,$2,$3,$4,$5,$6,$7)',
      [AUDIT_A, ['u1'], ['https://x.test/u1'], ['/t'], ['k'], [1], ['link']]);
    const b = (await db.query(`select depth, state from public.frontier where audit_id=$1 and url_hash='u1'`, [AUDIT_B])).rows[0];
    expect(b.depth).toBe(4);
    expect(b.state).toBe('fetched');

    // ON CONFLICT DO UPDATE raises if one statement affects a row twice; the SQL dedupes first.
    await db.query('select public.upsert_frontier_batch($1,$2,$3,$4,$5,$6,$7)',
      [AUDIT_A, ['d1', 'd1'], ['https://x.test/d', 'https://x.test/d'], ['/t', '/t'], ['k', 'k'], [7, 3], ['link', 'link']]);
    const d = (await db.query(`select depth from public.frontier where audit_id=$1 and url_hash='d1'`, [AUDIT_A])).rows[0];
    expect(d.depth).toBe(3); // shallowest kept
  }, 120_000);
});

describe('settle_frontier_batch — the terminal-state whitelist', () => {
  it('refuses to UN-SETTLE a row, so a resume cannot be made to re-fetch a page already read', async () => {
    // Found by a SURVIVING MUTATION: removing `where u.state in (...)` from the function changed
    // nothing any test observed. The table's CHECK permits all five states, so without the whitelist a
    // caller could drive a `fetched` row back to `discovered` — and the next resume would put a page
    // it had already read back into the pool, which is a composition move.
    await db.query(`delete from public.frontier`);
    await db.query(
      `insert into public.frontier (audit_id,url_hash,url,template_key,sample_key,depth,source)
       values ($1,'w1','https://x.test/w1','/t','k',1,'link')`, [AUDIT_A]);
    await db.query('select public.settle_frontier_batch($1,$2,$3)', [AUDIT_A, ['w1'], ['fetched']]);

    for (const bad of ['discovered', 'claimed']) {
      const n = Number((await db.query('select public.settle_frontier_batch($1,$2,$3) n',
        [AUDIT_A, ['w1'], [bad]])).rows[0].n);
      expect(n).toBe(0);
      const state = (await db.query(`select state from public.frontier where url_hash='w1'`)).rows[0].state;
      expect(state).toBe('fetched');
    }

    // The three terminal verbs still work, so the guard is a whitelist and not a wall.
    for (const good of ['failed', 'skipped', 'fetched']) {
      const n = Number((await db.query('select public.settle_frontier_batch($1,$2,$3) n',
        [AUDIT_A, ['w1'], [good]])).rows[0].n);
      expect(n).toBe(1);
    }
  }, 120_000);
});

describe('the privilege posture, read from the catalog rather than the migration text', () => {
  it('grants EXECUTE to service_role ONLY, on all four functions', async () => {
    const { rows } = await db.query(`
      select p.proname, p.prosecdef as definer, p.proconfig is not null as path_pinned,
             has_function_privilege('anon', p.oid, 'EXECUTE') as anon,
             has_function_privilege('authenticated', p.oid, 'EXECUTE') as authed,
             has_function_privilege('service_role', p.oid, 'EXECUTE') as service
        from pg_proc p join pg_namespace n on n.oid = p.pronamespace
       where n.nspname = 'public'
         and p.proname in ('claim_frontier','delete_orphan_frontier_rows','settle_frontier_batch','upsert_frontier_batch')
       order by p.proname`);
    expect(rows).toHaveLength(4);
    for (const r of rows) {
      expect(r.definer).toBe(false);      // INVOKER — the caller already holds the privilege
      expect(r.path_pinned).toBe(true);   // search_path pinned
      expect(r.anon).toBe(false);         // PostgREST publishes these as RPC endpoints
      expect(r.authed).toBe(false);
      expect(r.service).toBe(true);
    }
  }, 120_000);
});
