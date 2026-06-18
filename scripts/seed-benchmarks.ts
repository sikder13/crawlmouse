// Seed the 10 Stage-7 reference benchmark audits into the corpus (SPEC 01 v2 §8, Gate 2) via the
// REAL app/engine audit path — the SAME path a live user audit uses, never a DB-write tool.
//
// Per URL: (1) supabase-js INSERT a pending `audits` row (same shape as apps/web/.../audits/start),
// (2) supabase-js UPDATE status -> 'crawling' (the worker's mark-crawling step), (3) crawlAndPersist
// (the worker's own core: runAudit = the engine, then persistAuditResults = the row-writer). The only
// writes are the app's own supabase-js insert/update + persistAuditResults — NO apply_migration /
// execute_sql / edge-function / any MCP tool. Rows come from RUNNING THE ENGINE.
//
// Engine version follows the environment: `ENGINE_V2=1 pnpm tsx scripts/seed-benchmarks.ts` seeds
// under v2 (graceful-partial: large/slow sites stop at the budget and complete as low-confidence
// partials instead of throwing). The stored grade is context-only for the backtest, which re-crawls.
// Idempotent: skips a URL that already has a completed row. expires_at: null -> durable (TTL never
// deletes the benchmark corpus). Tagged via settings.benchmark / cohort for identification.
//
// Per-site pageCap override: nextjs.org has a very dense link graph that overran Postgres'
// statement_timeout on the bulk links insert at cap 500 (logged as a separate post-Phase-1 ticket,
// docs/tickets/2026-06-17-persist-links-insert-statement-timeout.md). It is seeded at a lower cap.
//
// Run: nvm use 22 && [ENGINE_V2=1] pnpm tsx scripts/seed-benchmarks.ts
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { crawlAndPersist } from '@crawlmouse/inngest/audit';

// supabase-js is required untyped (same pattern as backtest-engine.ts) so the scripts typecheck needs
// no @supabase/supabase-js type dep; crawlAndPersist accepts the client as SupabaseClient (any is ok).
const require = createRequire('/home/udsik/nahl-clients-projects/crawlmouse-v1.0.0/apps/web/');
const { createClient } = require('@supabase/supabase-js');

const env = Object.fromEntries(
  readFileSync(new URL('../apps/web/.env.local', import.meta.url).pathname, 'utf8')
    .split('\n').filter((l) => l.includes('=') && !l.trim().startsWith('#'))
    .map((l) => { const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim()]; }),
);
const sb = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });

const DEFAULT_PAGE_CAP = 500;
// The canonical Stage-7 reference set (one clean site per platform) — same list as scripts/p5/s1-seed.mjs.
// Optional 3rd element = a per-site pageCap override.
const SITES: [string, string, number?][] = [
  ['shopify', 'https://www.shopify.com'],
  ['wordpress', 'https://wordpress.org'],
  ['webflow', 'https://webflow.com'],
  ['squarespace', 'https://www.squarespace.com'],
  ['wix', 'https://www.wix.com'],
  ['ghost', 'https://ghost.org'],
  ['nextjs', 'https://nextjs.org', 150], // dense link graph -> bulk links insert overran statement_timeout at 500
  ['drupal', 'https://www.drupal.org'],
  ['joomla', 'https://www.joomla.org'],
  // gatsby.dev persistently `socket hang up`s our crawler (v1 AND v2 polite) — it resets the
  // connection regardless of politeness. Substituted with a clean, crawlable SSG docs site to keep
  // the corpus at 10 reference sites (Gate 2). gatsby.dev can be revisited if it stops blocking.
  ['vuejs', 'https://vuejs.org', 200],
];

interface SeedOutcome { cms: string; url: string; auditId: string | null; status: string; grade?: string; score?: number; pages?: number }

async function main() {
  const v2 = (process.env.ENGINE_V2 ?? '').trim().toLowerCase();
  console.log(`engine: ${v2 === '1' || v2 === 'true' || v2 === 'yes' || v2 === 'on' ? 'v2 (graceful-partial)' : 'v1'}\n`);
  const results: SeedOutcome[] = [];
  for (const [cms, url, capOverride] of SITES) {
    const pageCap = capOverride ?? DEFAULT_PAGE_CAP;
    // Idempotency: skip if a completed row for this URL already exists.
    const { data: existing, error: exErr } = await sb.from('audits').select('id').eq('url', url).eq('status', 'completed').limit(1);
    if (exErr) { results.push({ cms, url, auditId: null, status: `skip-check-error: ${exErr.message}` }); continue; }
    if (existing && existing.length > 0) {
      results.push({ cms, url, auditId: existing[0].id, status: 'already-seeded' });
      console.log(`SKIP  ${url} (already completed: ${existing[0].id})`);
      continue;
    }

    // 1) Insert the pending row (same shape as POST /api/audits/start). expires_at:null = durable corpus.
    const { data: inserted, error: insErr } = await sb.from('audits').insert({
      user_id: null,
      anonymous_session_id: null,
      url,
      status: 'pending',
      settings: { pageCap, benchmark: true, cohort: 'stage7-reference', platform: cms },
      expires_at: null,
    }).select('id').single();
    if (insErr || !inserted) { results.push({ cms, url, auditId: null, status: `insert-error: ${insErr?.message}` }); console.log(`FAIL  ${url} insert: ${insErr?.message}`); continue; }
    const auditId: string = inserted.id;

    // 2) Mark crawling (the worker's mark-crawling step; persistAuditResults completes only status='crawling').
    const { error: crawlingErr } = await sb.from('audits').update({ status: 'crawling' }).eq('id', auditId).eq('status', 'pending');
    if (crawlingErr) { results.push({ cms, url, auditId, status: `mark-crawling-error: ${crawlingErr.message}` }); console.log(`FAIL  ${url} mark-crawling: ${crawlingErr.message}`); continue; }

    // 3) Run the REAL worker core: runAudit (engine) + persistAuditResults (row-writer). Engine = env.
    try {
      console.log(`CRAWL ${url} (cap ${pageCap}) ...`);
      const summary = await crawlAndPersist(sb, { auditId, url, pageCap });
      results.push({ cms, url, auditId, status: 'completed', grade: summary.grade, score: summary.score, pages: summary.pages });
      console.log(`OK    ${url} -> ${summary.grade}/${summary.score} (${summary.pages} pages) id=${auditId}`);
    } catch (e) {
      // Don't leave the row stuck 'crawling' (the corpus query is status='completed'); mark it failed.
      await sb.from('audits').update({ status: 'failed' }).eq('id', auditId).eq('status', 'crawling');
      results.push({ cms, url, auditId, status: `crawl-failed: ${(e as Error).message.slice(0, 120)}` });
      console.log(`FAIL  ${url} crawl: ${(e as Error).message.slice(0, 120)}`);
    }
  }

  const present = results.filter((r) => r.status === 'completed' || r.status === 'already-seeded').length;
  console.log('\n=== seed summary (id + grade per site) ===');
  for (const r of results) {
    const g = r.grade ? ` ${r.grade}/${r.score} (${r.pages}pg)` : '';
    console.log(`  [${r.status}] ${r.cms.padEnd(11)} ${r.url}  ${r.auditId ?? ''}${g}`);
  }
  console.log(`\n${present}/${SITES.length} sites present (completed or already-seeded).`);
}

await main();
