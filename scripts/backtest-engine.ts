// Backtest harness (SPEC 01 v2 §8 / T9) — crawl-once-grade-twice redesign.
//
// Pulls the last N completed real audits from Supabase, crawls each URL ONCE under the v2 pipeline,
// then grades that single crawl output under BOTH v1 and v2 (analyzeCrawl) and diffs THOSE — so a
// grade delta is attributable to the ENGINE, not crawl-to-crawl drift. The old harness re-crawled
// per engine, so live drift swamped the signal (a v1-vs-v1 re-run of nahlai.com moved C/64.29 ->
// C-/58.46). The stored DB grade is shown as context only, never the diff basis. Read-only on the DB.
//
// Crawl settings cancel out of the v1<->v2 delta (both gradings consume the identical crawlOut), so
// we crawl under the v2 pipeline — the post-cutover prod path — which also gives throttling sites
// their best shot via the polite/AIMD/backoff crawl. A URL that can't be crawled to a gradeable
// result (crawlForAudit throws, or 0 ok pages) is rendered as an EXCLUDED row with a reason, never
// silently dropped. --budget-ms raises the crawl wall-clock for slow sites (offline harness -> no
// 300s function limit -> the engine's 260s clamp is bypassed via the maxCrawlMsForTesting seam).
//
// Robustness (harness-only, no engine change): each crawl is raced against a WATCHDOG (default 300s,
// always kept above the effective crawl budget). A crawl that NEVER SETTLES (orphaned promise) would
// otherwise drain the event loop and kill the whole run with Node exit 13 — the per-crawl try/catch
// only catches throws/rejections, not a non-settling promise — so the watchdog converts it into a
// named EXCLUDED row instead. Per-site progress is logged live (URL + elapsed), and main() forces a
// clean process.exit(0) after writing the file so an abandoned crawl's dangling handles can't hang
// the process or re-trigger exit 13.
//
// Run: nvm use 22 && pnpm backtest -- --limit=30 [--budget-ms=600000] [--watchdog-ms=300000] [--out=evidence/backtest.md]
import { readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { crawlForAudit, analyzeCrawl } from '@crawlmouse/engine';
import { diffAudit, countFindings, formatFindingDeltas, SCORE_DELTA_THRESHOLD } from './backtest-diff.js';

const require = createRequire('/home/udsik/nahl-clients-projects/crawlmouse-v1.0.0/apps/web/');
const { createClient } = require('@supabase/supabase-js');

function arg(name: string): string | undefined {
  const flag = `--${name}=`;
  const found = process.argv.find((a) => a.startsWith(flag));
  return found ? found.slice(flag.length) : undefined;
}

// Mirror scripts/p5/reconcile-dryrun.ts: load env from apps/web/.env.local.
const env = Object.fromEntries(
  readFileSync(new URL('../apps/web/.env.local', import.meta.url).pathname, 'utf8')
    .split('\n').filter((l) => l.includes('=') && !l.trim().startsWith('#'))
    .map((l) => { const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim()]; }),
);
const sb = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });

const LIMIT = Number(arg('limit') ?? 30);
const PAGE_CAP = Number(arg('pageCap') ?? 500);
const budgetArg = arg('budget-ms');
const BUDGET_MS = budgetArg ? Number(budgetArg) : undefined; // undefined -> engine default (240s)
// Per-crawl watchdog: a crawl that fails to settle (orphaned promise) would otherwise drain the loop
// and kill the whole run with Node exit 13 — a non-settling promise is NOT a rejection, so the
// try/catch can't catch it. Keep the watchdog strictly ABOVE the effective budget so it only ever
// fires on the pathological case (the engine self-terminates at ~240s default / 260s clamp): budget
// + 60s grace, floor 300s. Overridable with --watchdog-ms.
const EFFECTIVE_BUDGET_MS = BUDGET_MS ?? 240_000;
const WATCHDOG_MS = Number(arg('watchdog-ms') ?? Math.max(300_000, EFFECTIVE_BUDGET_MS + 60_000));

interface CorpusAudit { id: string; url: string; score: number | null; grade: string | null }

async function main() {
  const { data: audits, error } = await sb
    .from('audits')
    .select('id, url, score, grade')
    .eq('status', 'completed')
    .not('url', 'is', null)
    .order('completed_at', { ascending: false })
    .limit(LIMIT);
  if (error) throw new Error(`audits fetch failed: ${error.message}`);
  if (!audits || audits.length === 0) {
    console.log('No completed audits in the corpus — nothing to backtest. (Prod audits may have been cleaned.)');
    return;
  }

  const rows: string[] = [
    `# Backtest (crawl-once-grade-twice): ${audits.length} audits — v1 vs v2 on the SAME crawl`,
    '',
    `Crawl: v2 pipeline, pageCap=${PAGE_CAP}, budget=${BUDGET_MS ? `${BUDGET_MS}ms` : 'engine default (240s)'}. Stored grade = context only; the diff is v1↔v2.`,
    '',
    '| URL | stored | v1 | v2 | Δ(v2−v1) | grade | finding deltas (v2−v1) | health(v2) | flag |',
    '|---|---|---|---|---|---|---|---|---|',
  ];
  let largeCount = 0;
  let excludedCount = 0;
  let partialCount = 0;

  for (const [i, a] of (audits as CorpusAudit[]).entries()) {
    const stored = `${a.grade ?? '?'}/${a.score ?? '?'}`;
    const tag = `[${i + 1}/${audits.length}]`;
    const t0 = Date.now();
    const elapsed = () => `${((Date.now() - t0) / 1000).toFixed(1)}s`;
    console.log(`${tag} crawling ${a.url} …`);
    const exclude = (reason: string) => {
      excludedCount += 1;
      const r = reason.replace(/\|/g, '/').slice(0, 80);
      rows.push(`| ${a.url} | ${stored} | — | — | n/a | n/a | — | — | ⛔ EXCLUDED (${r}) |`);
      console.log(`${tag} ⛔ EXCLUDED ${a.url} — ${r} (${elapsed()})`);
    };
    let watchdogTimer: ReturnType<typeof setTimeout> | undefined;
    try {
      // Race the crawl against a watchdog. The watchdog timer keeps the loop alive while we await, so
      // an orphaned (never-settling) crawl can't exit-13 mid-run; when it fires we get a named
      // EXCLUDED row via the catch below instead of losing the whole run.
      const { crawlOut, ctx } = await Promise.race([
        crawlForAudit(
          { url: a.url, pageCap: PAGE_CAP, perHostConcurrency: 8, staggerMs: 250, pageTimeoutMs: 10000 },
          BUDGET_MS ? { maxCrawlMsForTesting: BUDGET_MS } : {},
          true, // crawl under the v2 pipeline (the post-cutover prod path)
        ),
        new Promise<never>((_, reject) => {
          watchdogTimer = setTimeout(
            () => reject(new Error(`crawl did not settle within ${(WATCHDOG_MS / 1000).toFixed(0)}s (watchdog)`)),
            WATCHDOG_MS,
          );
        }),
      ]);
      const okPages = crawlOut.pages.filter((p) => p.statusCode === 200).length;
      if (okPages === 0) {
        exclude(`0 ok pages${crawlOut.budgetExhausted ? ', budget exhausted' : ''}`);
        continue;
      }
      // Grade the SINGLE crawl output under both engines; the delta is purely the grading-logic change.
      const v1 = analyzeCrawl(crawlOut, ctx, false);
      const v2 = analyzeCrawl(crawlOut, ctx, true);
      const d = diffAudit(
        { score: v1.score, grade: v1.grade, findingCounts: countFindings(v1.findings) },
        { score: v2.score, grade: v2.grade, findingCounts: countFindings(v2.findings) },
      );
      if (d.large) largeCount += 1;
      const h = v2.crawlHealth;
      const partial = !!(h?.partial || crawlOut.budgetExhausted);
      if (partial) partialCount += 1;
      const health = h
        ? `${h.confidence} cov=${(h.coveragePct * 100).toFixed(0)}% blk=${(h.blockRate * 100).toFixed(0)}%${partial ? ' partial' : ''}`
        : '—';
      rows.push(
        `| ${a.url} | ${stored} | ${v1.grade}/${v1.score.toFixed(2)} | ${v2.grade}/${v2.score.toFixed(2)} | ` +
          `${d.scoreDelta >= 0 ? '+' : ''}${d.scoreDelta.toFixed(2)} | ${d.gradeChanged ? `${v1.grade}→${v2.grade}` : 'same'} | ` +
          `${formatFindingDeltas(d.findingDeltas)} | ${health} | ${d.large ? '🚩 explain' : ''} |`,
      );
      console.log(
        `${tag} ${a.url} → v1 ${v1.grade}/${v1.score.toFixed(2)} | v2 ${v2.grade}/${v2.score.toFixed(2)} | ` +
          `Δ${d.scoreDelta >= 0 ? '+' : ''}${d.scoreDelta.toFixed(2)}${d.large ? ' 🚩' : ''}${partial ? ' partial' : ''} (${elapsed()})`,
      );
    } catch (e) {
      exclude((e as Error).message);
    } finally {
      if (watchdogTimer) clearTimeout(watchdogTimer);
    }
  }

  rows.push(
    '',
    `**${largeCount}** audit(s) with |Δscore| > ${SCORE_DELTA_THRESHOLD} — each must be explained before the ENGINE_V2 flip (§8).`,
    `**${excludedCount}** excluded (logged above, not dropped). **${partialCount}** partial (budget/cap-truncated crawl; the v1↔v2 diff is still valid).`,
  );
  const md = rows.join('\n');
  const out = arg('out');
  if (out) writeFileSync(out, md); // synchronous → the canonical evidence file is fully flushed here
  // Force a clean exit after the (synchronous) file write. A watchdog-abandoned crawl can leave
  // dangling sockets/handles open; without this the process could hang at the end or re-trigger Node
  // exit 13. The file is canonical, so flush the table to stdout then exit; a short unref'd fallback
  // guarantees termination even if stdout is wedged.
  process.stdout.write(`${out ? `Wrote ${out}\n` : ''}${md}\n`, () => process.exit(0));
  setTimeout(() => process.exit(0), 1500).unref();
}

await main();
