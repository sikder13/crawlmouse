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
// Run: nvm use 22 && pnpm backtest -- --limit=30 [--budget-ms=600000] [--out=evidence/backtest.md]
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

  for (const a of audits as CorpusAudit[]) {
    const stored = `${a.grade ?? '?'}/${a.score ?? '?'}`;
    const exclude = (reason: string) => {
      excludedCount += 1;
      rows.push(`| ${a.url} | ${stored} | — | — | n/a | n/a | — | — | ⛔ EXCLUDED (${reason.replace(/\|/g, '/').slice(0, 80)}) |`);
    };
    try {
      const { crawlOut, ctx } = await crawlForAudit(
        { url: a.url, pageCap: PAGE_CAP, perHostConcurrency: 8, staggerMs: 250, pageTimeoutMs: 10000 },
        BUDGET_MS ? { maxCrawlMsForTesting: BUDGET_MS } : {},
        true, // crawl under the v2 pipeline (the post-cutover prod path)
      );
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
    } catch (e) {
      exclude((e as Error).message);
    }
  }

  rows.push(
    '',
    `**${largeCount}** audit(s) with |Δscore| > ${SCORE_DELTA_THRESHOLD} — each must be explained before the ENGINE_V2 flip (§8).`,
    `**${excludedCount}** excluded (logged above, not dropped). **${partialCount}** partial (budget/cap-truncated crawl; the v1↔v2 diff is still valid).`,
  );
  const md = rows.join('\n');
  const out = arg('out');
  if (out) { writeFileSync(out, md); console.log(`Wrote ${out}`); }
  console.log(md);
}

await main();
