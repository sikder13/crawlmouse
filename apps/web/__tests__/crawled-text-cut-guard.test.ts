import { readFileSync, readdirSync } from 'node:fs';
import { resolve, join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * GUARD — no unreviewed char-index cut on crawled text.
 *
 * Crawled text is attacker-controlled and reaches Postgres jsonb/text through PostgREST, whose body
 * Postgres parses as JSON. Postgres rejects an unpaired UTF-16 surrogate (22P02), so a `.slice()` that
 * lands between the halves of a pair fails the insert, which throws in `persistAuditResults` and fails
 * THE WHOLE AUDIT. Four such sites shipped at once, and the reason was not that any one of them was
 * hard to spot — it was that nobody could enumerate them. The rule "no local `.slice()` on crawled
 * strings" is only worth stating if something checks it.
 *
 * HOW IT WORKS: every char-index cut in the engine, the web lib and the worker is inventoried below
 * with the reason it is safe. The test recomputes the set from source and requires an exact match, so
 * a NEW cut — or a changed one — fails until a human classifies it. It cannot tell a safe cut from an
 * unsafe one; it forces the question to be asked, which is the part that failed before.
 *
 * When this test fails, do NOT just paste the new snippet in. Decide first:
 *   • does the receiver hold crawled text (page text, title, anchor, URL, JSON-LD, llms.txt, robots)?
 *   • does the result get persisted, minted, exported, or sent to a subprocessor?
 * If yes to both, route it through `toPersistableText` instead of adding it here.
 */

const REPO = resolve(__dirname, '../../..');
const ROOTS = ['packages/engine/src', 'apps/web/lib', 'inngest'];
const CUT = /([A-Za-z_$][\w$.[\]'"()? ]{0,40})\.(slice|substring|substr)\s*\(\s*(-?[\w.$ +-]*)/g;

/** Reason codes — the classification that has to be made before a cut is allowed to exist. */
const ARRAY = 'array slice — cannot split a surrogate pair';
const ASCII = 'ASCII/structural — hex, percent-encoding, punctuation or a file extension';
const SCAN = 'scan buffer only — the cut value is matched against a regex and never persisted';
const SAFE_INDEX = 'cut at an index that cannot fall inside a pair';
const IMPL = 'the shared helper itself';

const INVENTORY: Record<string, [snippet: string, why: string][]> = {
  'packages/engine/src/text-safety.ts': [['return s.slice(0', IMPL]],

  // ── engine: crawled text ──────────────────────────────────────────────────────────────────────
  'packages/engine/src/analysis/ai-readiness/excerpt.ts': [['slice.slice(0', SAFE_INDEX]], // lastSpace
  'packages/engine/src/analysis/ai-readiness/classify.ts': [["if (NOSCRIPT_JS_NOTICE.test($(el).text().slice(0", SCAN]],
  'packages/engine/src/analysis/ai-readiness/llms-txt.ts': [['LLMS_TXT_SCAN_CAP ? body.slice(0', SCAN]],
  'packages/engine/src/analysis/ai-readiness/finding-id.ts': [["digest('hex').slice(0", ASCII]],
  'packages/engine/src/projection/ledger.ts': [['candidates.push(words.slice(0', ARRAY]],
  'packages/engine/src/projection/relevance.ts': [['return shared.slice(0', ARRAY]],
  'packages/engine/src/extract.ts': [['return MEDIA_EXTENSIONS.has(last.slice(dot + 1', ASCII]],
  'packages/engine/src/crawler.ts': [
    ['search).slice(0', 'URL parser output is percent-encoded ASCII (the raw fallback uses the helper)'],
    ['frontier.slice(0', ARRAY],
  ],
  'packages/engine/src/audit.ts': [['orderedSeeds.slice(0', ARRAY]],
  'packages/engine/src/analysis/structure.ts': [['sorted.slice(0', ARRAY]],
  'packages/engine/src/robots.ts': [["anchored ? rule.slice(0", ASCII]], // trailing '$'
  'packages/engine/src/url-canonical.ts': [['pathname.slice(0', ASCII]], // trailing '/'
  'packages/engine/src/ssrf-guard.ts': [
    ['parseInt(lower.slice(0', ASCII],
    ['parseInt(lower.slice(2', ASCII],
  ],

  // ── worker ────────────────────────────────────────────────────────────────────────────────────
  'inngest/progress.ts': [
    ['decodeURIComponent(raw.slice(0', 'probe only — the return value uses truncateWithoutSplitting'],
    ['ring.slice(ring.length - ringSize', ARRAY],
  ],

  // ── web lib ───────────────────────────────────────────────────────────────────────────────────
  'apps/web/lib/ai-readiness-packets.ts': [['sig.jsonLd.types.slice(0', ARRAY]],
  'apps/web/lib/audit-activity.ts': [['fresh].slice(-MAX_FEED_LENGTH', ARRAY]],
  'apps/web/lib/findings.ts': [['rows.slice(0', ARRAY]],
  'apps/web/lib/graph-assembly.ts': [
    ['ranked.slice(0', ARRAY],
    ['selected.slice(0', ARRAY],
    ['amongSelected.slice(0', ARRAY],
  ],
  'apps/web/lib/report-content.ts': [
    ['issues.slice(0', ARRAY],
    ['top.slice(0', ARRAY],
  ],
  'apps/web/lib/report-snapshot.ts': [['ordered.slice(0', ARRAY]],
  'apps/web/lib/share-url.ts': [["rchParams(search.startsWith('?') ? search.slice(1", ASCII]],
  'apps/web/lib/url-display.ts': [['raw.slice(i', 'display-only decode, never persisted']],
};

function sourceFiles(dir: string, out: string[] = []): string[] {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) {
      if (e.name !== 'node_modules' && e.name !== '__fixtures__') sourceFiles(p, out);
    } else if (/\.tsx?$/.test(e.name) && !/\.test\.tsx?$/.test(e.name)) out.push(p);
  }
  return out;
}

/** Every char-index cut in scanned source, as `relativePath :: receiver.method(firstArg`. */
function foundCuts(): string[] {
  const hits: string[] = [];
  for (const root of ROOTS) {
    for (const file of sourceFiles(resolve(REPO, root))) {
      const src = readFileSync(file, 'utf8');
      let m: RegExpExecArray | null;
      CUT.lastIndex = 0;
      while ((m = CUT.exec(src)) !== null) {
        hits.push(`${relative(REPO, file).replace(/\\/g, '/')} :: ${m[1]!.trim()}.${m[2]}(${m[3]}`);
      }
    }
  }
  return hits.sort();
}

const inventoried = (): string[] =>
  Object.entries(INVENTORY)
    .flatMap(([file, entries]) => entries.map(([snippet]) => `${file} :: ${snippet}`))
    .sort();

describe('GUARD: crawled-text cuts are inventoried, not incidental', () => {
  it('every char-index cut in engine/web-lib/worker is classified', () => {
    // An exact set match in BOTH directions: a new cut fails (must be classified), and a stale entry
    // fails too (so the inventory cannot rot into a list of things that no longer exist).
    expect(foundCuts()).toEqual(inventoried());
  });

  it('the guard is actually looking at code (fails loud if the roots move)', () => {
    // Without this, a renamed directory would empty the scan and the set-equality above would only
    // pass once the inventory was emptied to match — a guard that guards nothing, silently.
    expect(foundCuts().length).toBeGreaterThan(20);
  });

  it('every audit-fatal cutter routes through the shared helper', () => {
    // The inventory proves no UNREVIEWED cut exists; this proves the reviewed ones use the helper.
    // Both are needed: a rewrite could drop the helper call without adding a matching `.slice(`.
    const uses = (rel: string, fn: string) => {
      const src = readFileSync(resolve(REPO, rel), 'utf8');
      expect(src, `${rel} must call ${fn}`).toContain(fn);
    };
    uses('packages/engine/src/analysis/ai-readiness/excerpt.ts', 'toPersistableText');
    uses('packages/engine/src/analysis/ai-readiness/legibility.ts', 'toPersistableText');
    uses('packages/engine/src/projection/action-packet.ts', 'toPersistableText');
    uses('packages/engine/src/projection/ledger.ts', 'toPersistableText');
    uses('apps/web/lib/report-snapshot.ts', 'toPersistableText');
    uses('apps/web/lib/billing/csv.ts', 'wellFormText');
    uses('inngest/progress.ts', 'truncateWithoutSplitting');
  });

  it('no module reimplements the surrogate check instead of importing it', () => {
    // The original fix was a local surrogate-aware clamp in report-snapshot.ts. It was correct, and it
    // was useless everywhere else — a copy in one file is how a class stays open.
    const offenders: string[] = [];
    for (const root of ROOTS) {
      for (const file of sourceFiles(resolve(REPO, root))) {
        const rel = relative(REPO, file).replace(/\\/g, '/');
        if (rel.endsWith('packages/engine/src/text-safety.ts')) continue;
        if (/0xd800|0xdbff|0xdc00|0xdfff/i.test(readFileSync(file, 'utf8'))) offenders.push(rel);
      }
    }
    expect(offenders).toEqual([]);
  });
});
