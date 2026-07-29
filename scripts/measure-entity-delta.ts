// Measures the AI-score delta from the SPEC 05 homepage-entity signal, by evaluating BOTH the
// pre-change predicate and the CURRENTLY SHIPPED one on the SAME fetched homepage.
//
// WHY THIS FILE EXISTS. `evidence/ai-entity-scan-delta.md` contradicted the code twice — once about the
// vocabulary, once about the crediting positions — because the measurement lived in a throwaway script
// and the document was updated from memory afterwards. A rule with no mechanism is a wish. This is the
// mechanism: re-run it in the SAME commit as any change to the entity predicate, and paste the summary.
//
//   nvm use 22 && npx tsx scripts/measure-entity-delta.ts --limit=80
//
// Requires `apps/web/.env.local` (service-role key) to read the audit corpus. Read-only: it SELECTs
// completed audit URLs and fetches those homepages. It writes nothing, anywhere.
//
// The CURRENT predicate is read through the real `extractPage` — the shipped crawl path, not a
// reimplementation of it — so the measurement cannot drift from production by construction. Only the
// RETIRED predicate is reconstructed here, because by definition it no longer exists in the codebase.
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { extractPage } from '@crawlmouse/engine';

// Resolved through apps/web, which owns the dependency — `scripts` deliberately does not take one on
// for a diagnostic. No type import: the package is not resolvable from here at TYPE level either, and
// `scripts/backtest-engine.ts` reaches it the same way.
const require = createRequire(new URL('../apps/web/', import.meta.url));
// eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
const { createClient } = require('@supabase/supabase-js');

const env = Object.fromEntries(
  readFileSync(new URL('../apps/web/.env.local', import.meta.url), 'utf8')
    .split('\n')
    .filter((l) => l.includes('=') && !l.trim().startsWith('#'))
    .map((l) => {
      const i = l.indexOf('=');
      return [l.slice(0, i).trim(), l.slice(i + 1).trim()];
    }),
) as Record<string, string>;

const sb = createClient(env.NEXT_PUBLIC_SUPABASE_URL!, env.SUPABASE_SERVICE_ROLE_KEY!, {
  auth: { persistSession: false },
}) as { from: (t: string) => any };

/**
 * THE RETIRED PREDICATE, reconstructed verbatim: `@graph`-only recursion, exact-match on two names.
 * Kept deliberately dumb — it is a historical baseline, not code under test.
 */
const OLD_TYPES = new Set(['Organization', 'WebSite']);
function oldPredicate(node: unknown, depth = 0): boolean {
  if (depth > 64 || !node) return false;
  if (Array.isArray(node)) return node.some((n) => oldPredicate(n, depth + 1));
  if (typeof node !== 'object') return false;
  const o = node as Record<string, unknown>;
  const t = o['@type'];
  if (typeof t === 'string' && OLD_TYPES.has(t)) return true;
  if (Array.isArray(t) && t.some((x) => typeof x === 'string' && OLD_TYPES.has(x))) return true;
  return Array.isArray(o['@graph']) ? oldPredicate(o['@graph'], depth + 1) : false;
}

const LIMIT = Number(process.argv.find((a) => a.startsWith('--limit='))?.slice(8) ?? 80);
const { data } = await sb
  .from('audits')
  .select('url')
  .eq('status', 'completed')
  .not('grade', 'is', null)
  .order('started_at', { ascending: false })
  .limit(LIMIT);

const seen = new Set<string>();
let gained = 0;
let lost = 0;
let same = 0;
let fetched = 0;
// Two shape counts the evidence file reports as LIMITS of the corpus, so they must be measured here
// rather than asserted there: they are how we know what this corpus cannot tell us.
let arrayAuthorWorksFor = 0;
let curieTypes = 0;
const gainers: string[] = [];
const losers: string[] = [];

for (const row of (data ?? []) as { url: string }[]) {
  let origin: string;
  try {
    origin = new URL(row.url).origin;
  } catch {
    continue;
  }
  if (seen.has(origin)) continue;
  seen.add(origin);

  let html: string;
  try {
    const res = await fetch(origin, {
      headers: { 'user-agent': 'Mozilla/5.0 (compatible; CrawlmouseBot/1.0; +https://crawlmouse.com/bot)' },
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) continue;
    html = await res.text();
  } catch {
    continue;
  }
  fetched += 1;

  // CURRENT: the shipped extraction path, exactly as the worker runs it.
  const nowVal = extractPage(html, origin, {}).aiSignals?.jsonLd.hasEntityType ?? false;

  // RETIRED: parse the same blocks and run the old walk over them.
  const blocks: unknown[] = [];
  for (const m of html.matchAll(/<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)) {
    try {
      blocks.push(JSON.parse(m[1]!));
    } catch {
      /* malformed block — the engine treats it the same way */
    }
  }
  const oldVal = blocks.some((b) => oldPredicate(b));

  if (nowVal && !oldVal) {
    gained += 1;
    gainers.push(origin);
  } else if (!nowVal && oldVal) {
    lost += 1;
    losers.push(origin);
  } else {
    same += 1;
  }

  const raw = JSON.stringify(blocks);
  if (/"author"\s*:\s*\[/.test(raw) && /worksFor/.test(raw)) arrayAuthorWorksFor += 1;
  if (/"@type"\s*:\s*"(schema|s):[A-Za-z]/.test(raw)) curieTypes += 1;
}

console.log(`\nSUMMARY: ${fetched} homepages | ${gained} gained +3.0 | ${lost} lost -3.0 | ${same} unchanged`);
console.log(`gainers: ${gainers.join(', ') || '(none)'}`);
console.log(`losers : ${losers.join(', ') || '(none)'}`);
console.log(`corpus limits — array-author+worksFor sites: ${arrayAuthorWorksFor}; CURIE @type sites: ${curieTypes}`);
process.exit(0);
