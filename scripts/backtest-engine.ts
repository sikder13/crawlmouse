// Backtest harness (SPEC 01 v2 §8 / T9). Pulls the last N completed real audits from
// Supabase, RE-RUNS the current engine on each URL, and emits an old-vs-new diff
// (grade, score, per-category finding counts) as markdown. Read-only against the DB.
// Until ENGINE_V2 lands, the "new" run uses the current engine, so deltas ≈ 0 (modulo
// live-site drift) — this proves the harness works end to end; it becomes the cutover
// gate once the v2 path is implemented (run with ENGINE_V2=1).
//
// Run: nvm use 22 && pnpm backtest -- --limit=30 [--out=evidence/backtest.md]
import { readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { runAudit } from '@crawlmouse/engine';

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
const SCORE_DELTA_THRESHOLD = 5; // |Δscore| above this must be explained before cutover (§8)

interface CorpusAudit { id: string; url: string; score: number | null; grade: string | null }

/** Pure diff of one audit's old (stored) vs new (re-run) grade/score/finding counts. Unit-testable. */
export function diffAudit(
  old: { score: number | null; grade: string | null; findingCounts: Record<string, number> },
  fresh: { score: number; grade: string; findingCounts: Record<string, number> },
) {
  const scoreDelta = fresh.score - (old.score ?? NaN);
  const categories = new Set([...Object.keys(old.findingCounts), ...Object.keys(fresh.findingCounts)]);
  const findingDeltas: Record<string, number> = {};
  for (const c of categories) findingDeltas[c] = (fresh.findingCounts[c] ?? 0) - (old.findingCounts[c] ?? 0);
  return {
    scoreDelta,
    gradeChanged: old.grade !== fresh.grade,
    findingDeltas,
    large: Number.isFinite(scoreDelta) && Math.abs(scoreDelta) > SCORE_DELTA_THRESHOLD,
  };
}

async function findingCounts(auditId: string): Promise<Record<string, number>> {
  const { data, error } = await sb.from('findings').select('category').eq('audit_id', auditId);
  if (error) throw new Error(`findings fetch failed: ${error.message}`);
  return (data ?? []).reduce((acc: Record<string, number>, r: { category: string }) => {
    acc[r.category] = (acc[r.category] ?? 0) + 1; return acc;
  }, {});
}

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

  const engineLabel = env.ENGINE_V2 || process.env.ENGINE_V2 ? 'v2' : 'v1 (current)';
  const rows: string[] = [
    `# Backtest: ${audits.length} audits — new engine = ${engineLabel}`,
    '',
    '| URL | old | new | Δscore | grade | finding deltas | flag |',
    '|---|---|---|---|---|---|---|',
  ];
  let largeCount = 0;

  for (const a of audits as CorpusAudit[]) {
    try {
      const oldCounts = await findingCounts(a.id);
      const fresh = await runAudit({ url: a.url, pageCap: 500, perHostConcurrency: 8, staggerMs: 250, pageTimeoutMs: 10000 });
      const freshCounts = fresh.findings.reduce<Record<string, number>>((acc, f) => {
        acc[f.category] = (acc[f.category] ?? 0) + 1; return acc;
      }, {});
      const d = diffAudit({ score: a.score, grade: a.grade, findingCounts: oldCounts }, { score: fresh.score, grade: fresh.grade, findingCounts: freshCounts });
      if (d.large) largeCount += 1;
      const deltaStr = Object.entries(d.findingDeltas).filter(([, v]) => v !== 0).map(([k, v]) => `${k}:${v > 0 ? '+' : ''}${v}`).join(', ') || '—';
      rows.push(`| ${a.url} | ${a.grade ?? '?'}/${a.score ?? '?'} | ${fresh.grade}/${fresh.score} | ${Number.isFinite(d.scoreDelta) ? d.scoreDelta.toFixed(2) : 'n/a'} | ${d.gradeChanged ? '⚠ changed' : 'same'} | ${deltaStr} | ${d.large ? '🚩 explain' : ''} |`);
    } catch (e) {
      rows.push(`| ${a.url} | ${a.grade ?? '?'}/${a.score ?? '?'} | ERROR | n/a | n/a | ${(e as Error).message} | 🚩 |`);
    }
  }

  rows.push('', `**${largeCount}** audit(s) with |Δscore| > ${SCORE_DELTA_THRESHOLD} — each must be explained before cutover (§8).`);
  const md = rows.join('\n');
  const out = arg('out');
  if (out) { writeFileSync(out, md); console.log(`Wrote ${out}`); }
  console.log(md);
}

await main();
