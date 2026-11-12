import type { PGlite } from '@electric-sql/pglite';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { fixture } from '../../apps/web/lib/v2/fixtures';
import { buildPublicSnapshot } from '../../apps/web/lib/v2/reports/build-snapshot';
import { FIRST_AUDIT } from '../../apps/web/lib/v2/view/segment/test-helpers';
import { openTarget, PRODUCTION_REF } from './target';
import { summarise, sweep } from './report-slug-sweep';
import { migratedDb, pgliteDb } from './test-support';

/**
 * The every-slug sweep on PGlite with every migration applied, seeded with each kind of row the
 * sweep meets: a v1 report with its snapshot, a legacy one with none, a hidden one, a taken-down
 * one, a live v2 one, and a v2 one whose snapshot the screen cannot draw.
 */
let db: PGlite;
beforeAll(async () => {
  db = await migratedDb();
  await seed(db);
}, 300_000);
afterAll(async () => {
  await db?.close();
});
beforeEach(() => vi.stubEnv('V2_CHECKS_PUBLIC', '1'));
afterEach(() => vi.unstubAllEnvs());

const v2 = buildPublicSnapshot(
  fixture('bad-site'),
  FIRST_AUDIT['bad-site'],
  '2026-11-12T18:00:00.000Z',
);

/** A completed v1 audit, so the insert trigger copies its grade onto the report. */
async function audit(tx: PGlite): Promise<string> {
  const { rows } = await tx.query<{ id: string }>(
    `insert into public.audits (url, status, grade, score) values ('https://ex.com', 'completed', 'B', 79)
     returning id`,
  );
  return rows[0]!.id;
}

async function seed(tx: PGlite): Promise<void> {
  const report = (slug: string, auditId: string | null, snapshot: unknown, extra = '') =>
    tx.query(
      `insert into public.public_reports (slug, audit_id, domain, report_snapshot${extra ? ', hidden_at' : ''})
       values ($1, $2, 'ex.com', $3::jsonb${extra ? ', now()' : ''})`,
      [slug, auditId, snapshot === null ? null : JSON.stringify(snapshot)],
    );
  await report('a-v1', await audit(tx), { version: 1, domain: 'ex.com', grade: 'B' });
  await report('b-legacy', await audit(tx), null);
  await report('c-hidden', await audit(tx), { version: 1 }, 'hidden');
  await report('d-down', await audit(tx), { version: 1 });
  await tx.query(
    `update public.public_reports set takedown_requested_at = now() where slug = 'd-down'`,
  );
  await report('e-v2', null, v2);
  const broken = {
    ...v2,
    crawlers: v2.crawlers.map((c, i) => (i ? c : { ...c, verdict: 'invited' })),
  };
  await report('f-v2-broken', null, broken);
}

describe('report-slug-sweep', () => {
  it('sweeps every row by slug: v1, gone and v2 pass; a snapshot the page cannot draw fails', async () => {
    const results = await sweep(pgliteDb(db));
    expect(results.map((r) => [r.slug, r.outcome])).toEqual([
      ['a-v1', 'v1'],
      ['b-legacy', 'v1'],
      ['c-hidden', 'gone'],
      ['d-down', 'gone'],
      ['e-v2', 'v2'],
      ['f-v2-broken', 'error'],
    ]);
    const { text, failed } = summarise(results);
    expect(failed).toBe(true);
    expect(text).toContain('FAIL  f-v2-broken  error:');
    expect(text).toContain(
      "6 slugs: 1 v2, 2 v1 (to v1's page, not rendered here), 2 gone (404 by design), 1 failed",
    );
    expect(summarise(results.filter((r) => r.outcome !== 'error')).failed).toBe(false);
  });

  it('reads in a read-only transaction, and runs nothing else', async () => {
    const recording = pgliteDb(db);
    await sweep(recording);
    expect(recording.executed).toHaveLength(2);
    expect(recording.executed[0]).toBe('set transaction read only');
    expect(recording.executed[1]).toMatch(
      /^select slug, .* from public\.public_reports order by slug$/,
    );
  });

  it('fails on zero slugs, and says so', () => {
    expect(summarise([])).toEqual({
      text: "0 slugs: 0 v2, 0 v1 (to v1's page, not rendered here), 0 gone (404 by design), 0 failed\nFAIL  no slug was read",
      failed: true,
    });
  });

  it('reads a v2 report as gone with the flag off, which is why the script sets the flag', async () => {
    vi.stubEnv('V2_CHECKS_PUBLIC', '');
    const results = await sweep(pgliteDb(db));
    expect(results.find((r) => r.slug === 'e-v2')!.outcome).toBe('gone');
  });

  it('refuses a production URL, before connecting', () => {
    const url = `postgresql://postgres.${PRODUCTION_REF}:pw@aws-0-us-east-1.pooler.supabase.com:6543/postgres`;
    expect(() =>
      openTarget({ dbUrlEnv: 'SWEEP_URL', yesProduction: false }, { SWEEP_URL: url }),
    ).toThrow(/refusing to run against production/);
    const direct = `postgresql://postgres:pw@db.${PRODUCTION_REF}.supabase.co:5432/postgres`;
    expect(() =>
      openTarget({ dbUrlEnv: 'SWEEP_URL', yesProduction: false }, { SWEEP_URL: direct }),
    ).toThrow(/refusing to run against production/);
  });

  it('the script sets the flag, and offers no production override', async () => {
    const { readFileSync } = await import('node:fs');
    const src = readFileSync(new URL('./report-slug-sweep.ts', import.meta.url), 'utf8');
    expect(src).toContain("process.env.V2_CHECKS_PUBLIC = '1'");
    expect(src).toContain('yesProduction: false');
    expect(src).not.toMatch(/yes-production|yesProduction: (true|values)/);
  });
});
