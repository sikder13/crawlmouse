// Seed a batch of FRESH anonymous `completed` audits into the §8 backtest corpus to rebuild margin.
// The corpus depleted (~34 completed rows) as older free audits aged out on the 30-day TTL, so the
// last backtest landed at exactly 30 gradeable — zero margin. This is reusable corpus-refresh tooling
// (the corpus depletes again on every TTL cycle); keep it as ops tooling, separate from the durable
// Stage-7 benchmark seeder (scripts/seed-benchmarks.ts), which it deliberately does NOT touch.
//
// SAME real worker path as seed-benchmarks.ts: per URL — (1) supabase-js INSERT a pending `audits` row
// (same shape as POST /api/audits/start), (2) UPDATE status -> 'crawling', (3) crawlAndPersist (the
// worker's own core: runAudit = the engine, then persistAuditResults = the row-writer). The ONLY writes
// are the app's own supabase-js insert/update + persistAuditResults — NO apply_migration / execute_sql /
// edge-function / any MCP tool. Reuses apps/web/.env.local (the SAME Supabase creds the backtest uses).
// Bypasses Turnstile + the per-IP(3/day)/per-domain(1/hr)/global rate limits (no HTTP to the route).
//
// DIFFERENT from seed-benchmarks.ts (which seeds DURABLE benchmarks): these are THROWAWAY corpus margin —
//   • expires_at = now + AUDIT_TTL_DAYS(30)  → ages out on the TTL like a normal anon audit (NOT null/durable)
//   • settings.seed = 'corpus-refresh-*'      → traceable/cleanable; no benchmark/cohort tag
//   • a per-site READ-BACK of the persisted crawl-health classifies each row (GRADEABLE / floored / EXCLUDED)
//
// Run under v2 (REQUIRED: persistAuditResults only writes the coverage/confidence/fetched_ok columns for a
// v2 result, and v2 previews the coverage floor the backtest uses):
//   nvm use 22 && ENGINE_V2=1 pnpm exec tsx scripts/seed-corpus.ts
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { crawlAndPersist } from '@crawlmouse/inngest/audit';

// supabase-js required untyped (same pattern as backtest-engine.ts / seed-benchmarks.ts): the scripts
// typecheck needs no @supabase/supabase-js type dep; crawlAndPersist accepts the client as SupabaseClient.
const require = createRequire('/home/udsik/nahl-clients-projects/crawlmouse-v1.0.0/apps/web/');
const { createClient } = require('@supabase/supabase-js');

const env = Object.fromEntries(
  readFileSync(new URL('../apps/web/.env.local', import.meta.url).pathname, 'utf8')
    .split('\n').filter((l) => l.includes('=') && !l.trim().startsWith('#'))
    .map((l) => { const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim()]; }),
);
const sb = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });

const DEFAULT_PAGE_CAP = 500;          // matches the backtest's crawl cap so seed coverage% previews the backtest
const DENSE_RETRY_CAP = 200;           // ONLY for a site that excludes specifically on the dense-links statement_timeout
const AUDIT_TTL_DAYS = 30;             // = apps/web/lib/limits.ts AUDIT_TTL_DAYS; matches a normal free/anon audit's expires_at
const SEED_TAG = 'corpus-refresh-2026-06-26';
const GRADEABLE_MIN_OK_PAGES = 5;      // "gradeable" = >=5 ok pages (not a 0-ok exclusion)
const HIGH_COV = 0.90;                 // "high-cov" = coverage >= ~90%

const URLS: string[] = [
  'https://www.scrapethissite.com/',
  'https://web-scraping.dev/',
  'https://sive.rs/',
  'https://justinjackson.ca/',
  'https://lite.cnn.com/',
  'https://text.npr.org/',
  'https://jekyllrb.com/',
  'https://www.11ty.dev/',
  'https://danluu.com/',
  'https://www.sqlite.org/',
  'https://nginx.org/',
  'https://curl.se/',
  'https://tom.preston-werner.com/',
  'https://astro.build/',
  'https://www.gatsbyjs.com/docs/',
  'https://useaboon.com/',
];

// Dense-links Postgres statement_timeout signature (docs/tickets/2026-06-17-persist-links-insert-statement-timeout.md):
// persistAuditResults throws `links insert failed: <pg error>`; the pg timeout is code 57014 /
// "canceling statement due to statement timeout". This is the ONLY exclusion we retry (at a lower cap).
function isDenseLinksTimeout(msg: string): boolean {
  return /links insert failed/i.test(msg) && /(statement timeout|canceling statement|57014)/i.test(msg);
}

interface RowHealth {
  fetchedOk: number | null; coveragePct: number | null; confidence: string | null;
  partial: boolean | null; pageCount: number | null; score: number | null; grade: string | null;
}

async function readBack(auditId: string): Promise<RowHealth> {
  const { data } = await sb.from('audits')
    .select('fetched_ok_count, coverage_pct, confidence, partial, page_count, score, grade')
    .eq('id', auditId).single();
  return {
    fetchedOk: data?.fetched_ok_count ?? null,
    coveragePct: data?.coverage_pct ?? null,
    confidence: data?.confidence ?? null,
    partial: data?.partial ?? null,
    pageCount: data?.page_count ?? null,
    score: data?.score ?? null,
    grade: data?.grade ?? null,
  };
}

type Classification = 'GRADEABLE' | 'GRADEABLE(high-cov)' | 'floored-to-C60' | 'EXCLUDED';

function classify(h: RowHealth): Classification {
  const ok = h.fetchedOk ?? 0;
  if (ok < GRADEABLE_MIN_OK_PAGES) return 'EXCLUDED'; // 0-ok / thin crawl
  // The v2 coverage floor demotes a low-confidence/partial crawl to exactly C/60.00.
  if (h.grade === 'C' && h.score !== null && Math.abs(h.score - 60) < 0.005) return 'floored-to-C60';
  if (h.coveragePct !== null && h.coveragePct >= HIGH_COV) return 'GRADEABLE(high-cov)';
  return 'GRADEABLE';
}

function pct(x: number | null | undefined): string {
  return x === null || x === undefined ? 'n/a' : `${(x * 100).toFixed(0)}%`;
}

async function markFailed(auditId: string): Promise<void> {
  // Never leave a row stuck 'crawling' (the corpus query is status='completed'); only touch our own non-terminal row.
  await sb.from('audits').update({ status: 'failed' }).eq('id', auditId).in('status', ['pending', 'crawling']);
}

// Insert pending -> mark crawling -> crawlAndPersist. Throws with the auditId attached so the caller can
// retry (dense-links) or mark-failed (every other error). Mirrors the worker's pending->crawling->complete.
async function seedOne(url: string, pageCap: number): Promise<{ auditId: string; h: RowHealth }> {
  const expiresAt = new Date(Date.now() + AUDIT_TTL_DAYS * 24 * 60 * 60 * 1000).toISOString();
  const { data: inserted, error: insErr } = await sb.from('audits').insert({
    user_id: null,
    anonymous_session_id: null,
    url,
    status: 'pending',
    settings: { pageCap, seed: SEED_TAG },
    expires_at: expiresAt,
  }).select('id').single();
  if (insErr || !inserted) throw new Error(`insert: ${insErr?.message}`);
  const auditId: string = inserted.id;

  const { error: crawlingErr } = await sb.from('audits').update({ status: 'crawling' }).eq('id', auditId).eq('status', 'pending');
  if (crawlingErr) throw Object.assign(new Error(`mark-crawling: ${crawlingErr.message}`), { auditId });

  try {
    await crawlAndPersist(sb, { auditId, url, pageCap });
  } catch (e) {
    throw Object.assign(e instanceof Error ? e : new Error(String(e)), { auditId });
  }
  return { auditId, h: await readBack(auditId) };
}

interface Outcome {
  url: string; auditId: string | null;
  classification: Classification | 'already-seeded';
  grade?: string | null; score?: number | null; coveragePct?: number | null; confidence?: string | null;
  okPages?: number | null; cap?: number; note?: string;
}

async function main(): Promise<void> {
  const v2flag = (process.env.ENGINE_V2 ?? '').trim().toLowerCase();
  const isV2 = v2flag === '1' || v2flag === 'true' || v2flag === 'yes' || v2flag === 'on';
  console.log(`engine: ${isV2 ? 'v2' : 'v1'}${isV2 ? '' : '  ⚠️  NOT v2 — crawl-health columns will be null and everything misclassifies EXCLUDED; re-run with ENGINE_V2=1'}\n`);

  const outcomes: Outcome[] = [];
  for (const url of URLS) {
    // Idempotency: skip a URL that already has a completed row (safe re-runs).
    const { data: existing } = await sb.from('audits').select('id').eq('url', url).eq('status', 'completed').limit(1);
    if (existing && existing.length > 0) {
      console.log(`SKIP  ${url} (already completed: ${existing[0].id})`);
      outcomes.push({ url, auditId: existing[0].id, classification: 'already-seeded' });
      continue;
    }

    let auditId: string | null = null;
    try {
      console.log(`CRAWL ${url} (cap ${DEFAULT_PAGE_CAP}) ...`);
      const r = await seedOne(url, DEFAULT_PAGE_CAP);
      auditId = r.auditId;
      const cls = classify(r.h);
      outcomes.push({ url, auditId, classification: cls, grade: r.h.grade, score: r.h.score, coveragePct: r.h.coveragePct, confidence: r.h.confidence, okPages: r.h.fetchedOk, cap: DEFAULT_PAGE_CAP });
      console.log(`  -> ${cls}  ${r.h.grade ?? '?'}/${r.h.score ?? '?'}  cov=${pct(r.h.coveragePct)} conf=${r.h.confidence ?? '?'} ok=${r.h.fetchedOk ?? '?'}  id=${auditId}`);
    } catch (e) {
      const err = e as Error & { auditId?: string };
      auditId = err.auditId ?? auditId;
      const msg = err.message ?? String(e);

      // ONLY the dense-links statement_timeout is retried — once, at a lower cap. The row is still
      // 'crawling' (persistAuditResults threw before the completion update) and persist is idempotent
      // (it clears children first), so re-crawling the same id at a smaller cap is safe.
      if (auditId && isDenseLinksTimeout(msg)) {
        console.log(`  ⚠️  dense-links statement_timeout at cap ${DEFAULT_PAGE_CAP}; retrying ${url} at cap ${DENSE_RETRY_CAP} ...`);
        try {
          await crawlAndPersist(sb, { auditId, url, pageCap: DENSE_RETRY_CAP });
          const h = await readBack(auditId);
          const cls = classify(h);
          outcomes.push({ url, auditId, classification: cls, grade: h.grade, score: h.score, coveragePct: h.coveragePct, confidence: h.confidence, okPages: h.fetchedOk, cap: DENSE_RETRY_CAP, note: 'recovered at cap 200' });
          console.log(`  -> ${cls}  ${h.grade ?? '?'}/${h.score ?? '?'}  cov=${pct(h.coveragePct)} conf=${h.confidence ?? '?'} ok=${h.fetchedOk ?? '?'} (cap ${DENSE_RETRY_CAP})`);
          continue;
        } catch (e2) {
          const m2 = (e2 as Error).message ?? String(e2);
          await markFailed(auditId);
          outcomes.push({ url, auditId, classification: 'EXCLUDED', cap: DENSE_RETRY_CAP, note: `dense-retry failed: ${m2.slice(0, 90)}` });
          console.log(`  FAIL  ${url} retry@${DENSE_RETRY_CAP}: ${m2.slice(0, 90)}`);
          continue;
        }
      }

      // Every other error (0-ok / JS shell / socket hang up / wall-clock timeout / blocked): do NOT retry.
      if (auditId) await markFailed(auditId);
      outcomes.push({ url, auditId, classification: 'EXCLUDED', cap: DEFAULT_PAGE_CAP, note: msg.slice(0, 90) });
      console.log(`  FAIL  ${url}: ${msg.slice(0, 90)}`);
    }
  }

  // ---- report ----
  const seeded = outcomes.filter((o) => o.classification !== 'already-seeded');
  const isGradeable = (o: Outcome) => o.classification === 'GRADEABLE' || o.classification === 'GRADEABLE(high-cov)' || o.classification === 'floored-to-C60';
  const gradeable = seeded.filter(isGradeable);
  const highCov = seeded.filter((o) => o.classification === 'GRADEABLE(high-cov)');
  const floored = seeded.filter((o) => o.classification === 'floored-to-C60');
  const excluded = seeded.filter((o) => o.classification === 'EXCLUDED');

  console.log('\n=== per-site results ===');
  console.log('| URL | grade | cov% | confidence | ok | classification | note |');
  console.log('|---|---|---|---|---|---|---|');
  for (const o of outcomes) {
    const g = o.grade ? `${o.grade}/${o.score}` : '—';
    console.log(`| ${o.url} | ${g} | ${pct(o.coveragePct)} | ${o.confidence ?? '—'} | ${o.okPages ?? '—'} | ${o.classification} | ${o.note ?? ''} |`);
  }
  console.log(`\nseeded ${seeded.length}: gradeable=${gradeable.length} (high-cov=${highCov.length}, floored=${floored.length}), excluded=${excluded.length}`);
  if (excluded.length > 0) {
    console.log('excluded sites:');
    for (const o of excluded) console.log(`  - ${o.url} (${o.note ?? 'thin/0-ok'})`);
  }

  // Authoritative corpus size: total completed rows now (the next backtest's --limit is set from this).
  const { count } = await sb.from('audits').select('id', { count: 'exact', head: true }).eq('status', 'completed');
  console.log(`\ncorpus: ${count ?? '?'} completed audits total now (+${gradeable.length} gradeable additions from this seed).`);
}

await main();
// Force a clean exit: crawlAndPersist (Crawlee) can leave a socket/handle open that would hang the
// process at the end. The unref'd timer fires only if something lingers; a clean run exits naturally first.
setTimeout(() => process.exit(0), 1500).unref();
