// Backtest harness — SPEC 5.1a Stage 0.5 re-axis (was: SPEC 01 v2 §8 crawl-once-grade-twice).
//
// WHAT CHANGED AND WHY
// The previous harness crawled each site ONCE and graded that single output under v1 and v2, so its
// axis was the GRADING half. SPEC 5.1a's Stage 1 (robots on every entry path, canonicalisation, trap
// caps) and Stage 3 (stratified frontier) change WHICH PAGES ARE FETCHED. A crawl-half change is
// applied identically to both sides of a one-crawl diff and cancels out exactly, so the old harness
// would have printed Δ0.00 across the corpus while every production grade moved — the same blindness
// SPEC 05 found when this harness silently could not observe AI-readiness output.
//
// The axis is now BASE ENGINE vs HEAD ENGINE: two independent crawls, each graded by the engine that
// produced it, diffed on grade AND on crawl composition. Composition is reported even when the grade
// is unchanged, because equal grades do not imply equal samples — two production duskroute.com runs
// scored an identical 61.20 from discovered sets of 2 526 and 2 979 URLs.
//
// MODES
//   --mode=ab     (default) base engine vs head engine. Requires --base-engine.
//   --mode=repro  the SAME (head) engine twice against the same site. This is B6's shape: an unchanged
//                 site must yield an identical digest AND an identical grade. A digest difference here
//                 is either genuine site drift or a determinism defect — and the named set difference
//                 is what tells them apart, which is the whole point of SPEC 5.1 §6.7.
//
// CORPUS: the last N completed audits from Supabase, or an explicit --urls list (which needs no
// database and no .env.local, so the harness runs from any worktree and offline against fixtures).
//
// Run:
//   nvm use 22
//   git worktree add ../crawlmouse-base origin/main && (cd ../crawlmouse-base && pnpm install)
//   pnpm backtest -- --mode=ab --base-engine=$PWD/../crawlmouse-base/packages/engine/src/index.ts \
//                    --limit=30 [--budget-ms=600000] [--out=evidence/backtest.md]
//   pnpm backtest -- --mode=repro --urls=https://example.com,https://example.org
import { readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { crawlForAudit, analyzeCrawl } from '@crawlmouse/engine';
import { formatFindingDeltas, formatCompositionDelta, SCORE_DELTA_THRESHOLD } from './backtest-diff.js';
import { runEnginePair, loadEngineFromPath, type EngineApi, type PairResult } from './backtest-runner.js';

function arg(name: string): string | undefined {
  const flag = `--${name}=`;
  const found = process.argv.find((a) => a.startsWith(flag));
  return found ? found.slice(flag.length) : undefined;
}

const MODE = (arg('mode') ?? 'ab') as 'ab' | 'repro';
const LIMIT = Number(arg('limit') ?? 30);
const PAGE_CAP = Number(arg('pageCap') ?? 500);
const budgetArg = arg('budget-ms');
const BUDGET_MS = budgetArg ? Number(budgetArg) : undefined; // undefined -> engine default (240s)
const EFFECTIVE_BUDGET_MS = BUDGET_MS ?? 240_000;
// Keep the watchdog strictly ABOVE the effective budget so it only fires on the pathological
// never-settling case (the engine self-terminates at ~240s default / 260s clamp).
const WATCHDOG_MS = Number(arg('watchdog-ms') ?? Math.max(300_000, EFFECTIVE_BUDGET_MS + 60_000));
const MAX_MOVED_URLS_SHOWN = 4;

/**
 * Env is loaded from a path RELATIVE TO THIS FILE (or --env), never an absolute developer path. The
 * previous version hardcoded the primary checkout, so the harness silently read another worktree's
 * dependencies and could not run from a feature worktree at all — which is exactly where a backtest is
 * needed. Anything already exported in the process environment wins, so CI needs no dotfile.
 */
function loadEnv(): Record<string, string | undefined> {
  const path = arg('env') ?? resolve(new URL('../apps/web/', import.meta.url).pathname, '.env.local');
  let fromFile: Record<string, string> = {};
  try {
    fromFile = Object.fromEntries(
      readFileSync(path, 'utf8')
        .split('\n').filter((l) => l.includes('=') && !l.trim().startsWith('#'))
        .map((l) => { const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim()]; }),
    );
  } catch {
    // Not fatal: --urls needs no database at all, and an operator may have exported the vars.
  }
  return { ...fromFile, ...process.env };
}

async function corpusUrls(): Promise<string[]> {
  const explicit = arg('urls');
  if (explicit) return explicit.split(',').map((u) => u.trim()).filter(Boolean);

  const env = loadEnv();
  if (!env.NEXT_PUBLIC_SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) {
    throw new Error(
      'No corpus source: pass --urls=<comma-separated>, or provide NEXT_PUBLIC_SUPABASE_URL + ' +
        'SUPABASE_SERVICE_ROLE_KEY (via --env=<path to .env.local>, apps/web/.env.local, or the environment).',
    );
  }
  // @supabase/supabase-js is an apps/web dependency, not a scripts one. Resolve it from THIS
  // checkout's apps/web rather than an absolute path, so any worktree works.
  const require = createRequire(new URL('../apps/web/', import.meta.url));
  const { createClient } = require('@supabase/supabase-js');
  const sb = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
  const { data, error } = await sb
    .from('audits').select('url').eq('status', 'completed').not('url', 'is', null)
    .order('completed_at', { ascending: false }).limit(LIMIT);
  if (error) throw new Error(`audits fetch failed: ${error.message}`);
  return ((data ?? []) as { url: string }[]).map((a) => a.url);
}

function renderRow(p: PairResult): string {
  if (p.excluded) {
    const r = p.excluded.replace(/\|/g, '/').slice(0, 80);
    return `| ${p.url} | — | — | n/a | n/a | — | — | ⛔ EXCLUDED (${r}) |`;
  }
  const d = p.grade;
  const comp = formatCompositionDelta(p.composition!, MAX_MOVED_URLS_SHOWN).replace(/\|/g, '/');
  // A grade that moved while the sample did NOT is an ENGINE change, and a grade that moved while the
  // sample did is an explained input change. Flagging them differently is the distinction SPEC 5.1 §6.7
  // exists to make; collapsing both into one "explain" marker is what made E3 unresolvable.
  const flag = d.large
    ? (p.composition!.identical ? '🚩 engine (same sample)' : '🚩 explain (sample moved)')
    : '';
  return (
    `| ${p.url} | ${p.base.grade}/${p.base.score.toFixed(2)} | ${p.head.grade}/${p.head.score.toFixed(2)} | ` +
    `${d.scoreDelta >= 0 ? '+' : ''}${d.scoreDelta.toFixed(2)} | ${d.gradeChanged ? `${p.base.grade}→${p.head.grade}` : 'same'} | ` +
    `${p.composition!.baseCount}→${p.composition!.headCount} ${comp} | ${formatFindingDeltas(d.findingDeltas)} | ${p.head.health} | ${flag} |`
  );
}

async function main() {
  if (MODE !== 'ab' && MODE !== 'repro') throw new Error(`--mode must be 'ab' or 'repro', got '${MODE}'`);
  const urls = await corpusUrls();
  if (urls.length === 0) {
    console.log('No URLs to backtest. (Prod audits may have been cleaned — or pass --urls=.)');
    return;
  }

  const headEngine: EngineApi = { crawlForAudit, analyzeCrawl };
  const baseEnginePath = arg('base-engine');
  if (MODE === 'ab' && !baseEnginePath) {
    throw new Error(
      '--mode=ab needs --base-engine=<abs path to a base checkout>/packages/engine/src/index.ts. ' +
        'Create one with: git worktree add ../crawlmouse-base origin/main && (cd ../crawlmouse-base && pnpm install)',
    );
  }
  const baseEngine = baseEnginePath ? await loadEngineFromPath(resolve(baseEnginePath)) : headEngine;

  const header = MODE === 'ab'
    ? `# Backtest (base vs head engine): ${urls.length} sites`
    : `# Backtest (reproducibility: the same engine twice): ${urls.length} sites`;
  const rows: string[] = [
    header,
    '',
    `Mode: \`${MODE}\`. Crawl: pageCap=${PAGE_CAP}, budget=${BUDGET_MS ? `${BUDGET_MS}ms` : 'engine default (240s)'}.` +
      (MODE === 'ab' ? ` Base engine: \`${baseEnginePath}\`.` : ' Both sides are the SAME engine — a difference is drift or a determinism defect.'),
    '',
    '**Composition** is the HTTP-200 fetched-URL set. `identical` means the two crawls reached exactly the same pages,',
    'so any grade delta beside it is attributable to the ENGINE and nothing else.',
    '',
    '| URL | base | head | Δ(head−base) | grade | composition (base→head) | finding deltas | health(head) | flag |',
    '|---|---|---|---|---|---|---|---|---|',
  ];

  let largeCount = 0;
  let excludedCount = 0;
  let sampleMovedCount = 0;
  let engineOnlyCount = 0;

  for (const [i, url] of urls.entries()) {
    const tag = `[${i + 1}/${urls.length}]`;
    console.log(`${tag} ${MODE === 'ab' ? 'base+head' : 'repro'} crawl of ${url} …`);
    const pair = await runEnginePair({
      url,
      baseEngine,
      headEngine,
      baseV2: true,
      headV2: true,
      opts: {
        pageCap: PAGE_CAP, perHostConcurrency: 8, staggerMs: 250, pageTimeoutMs: 10000,
      },
      flags: BUDGET_MS ? { maxCrawlMsForTesting: BUDGET_MS } : {},
      watchdogMs: WATCHDOG_MS,
    });
    rows.push(renderRow(pair));

    const secs = (pair.elapsedMs / 1000).toFixed(1);
    if (pair.excluded) {
      excludedCount += 1;
      console.log(`${tag} ⛔ EXCLUDED ${url} — ${pair.excluded} (${secs}s)`);
      continue;
    }
    if (pair.grade.large) largeCount += 1;
    if (!pair.composition!.identical) sampleMovedCount += 1;
    else if (pair.grade.scoreDelta !== 0) engineOnlyCount += 1;
    console.log(
      `${tag} ${url} → base ${pair.base.grade}/${pair.base.score.toFixed(2)} | head ${pair.head.grade}/${pair.head.score.toFixed(2)} | ` +
        `Δ${pair.grade.scoreDelta >= 0 ? '+' : ''}${pair.grade.scoreDelta.toFixed(2)} | sample ${pair.composition!.identical ? 'identical' : 'MOVED'} (${secs}s)`,
    );
  }

  rows.push(
    '',
    `**${largeCount}** site(s) with |Δscore| > ${SCORE_DELTA_THRESHOLD} — each must be explained before merge (SPEC 5.1 §10).`,
    `**${sampleMovedCount}** site(s) where the fetched-page set changed (an explained input change; the moved URLs are named in the row).`,
    `**${engineOnlyCount}** site(s) where the grade moved on an IDENTICAL sample — that is an engine change, and the only kind that needs no crawl caveat.`,
    `**${excludedCount}** excluded (logged above, never silently dropped).`,
  );

  const md = rows.join('\n');
  const out = arg('out');
  if (out) writeFileSync(out, md); // synchronous → the canonical evidence file is fully flushed here
  // Force a clean exit: a watchdog-abandoned crawl can leave dangling handles that would otherwise
  // hang the process or re-trigger Node exit 13.
  process.stdout.write(`${out ? `Wrote ${out}\n` : ''}${md}\n`, () => process.exit(0));
  setTimeout(() => process.exit(0), 1500).unref();
}

await main();
