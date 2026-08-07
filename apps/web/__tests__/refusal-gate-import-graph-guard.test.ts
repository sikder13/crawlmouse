import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { resolve, join, relative, dirname, basename } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * GUARD — no surface may FABRICATE a verdict that the refusal gate withheld.
 *
 * SPEC 5.1a §4 withholds the letter and the score at the source: a refused audit carries `grade: null`
 * and `score: null`. Five of thirteen surfaces were nevertheless found defaulting those nulls back into
 * something printable — `grade ?? ''`, `asNumber(score) ?? 0`, `score ?? '—'` — and the worst of them
 * made a refused re-audit read not as blank but as a COLLAPSE: gauge at 0, sparkline diving to the
 * floor, and "Down 81 points since your last visit."
 *
 * WHY THE SURFACE LIST IS DERIVED FROM THE IMPORT GRAPH AND NEVER HARDCODED. Every one of those five
 * was written BEFORE the gate existed, and inspection caught none of them. The fourteenth surface will
 * be written AFTER it, and inspection will not catch that one either. A hardcoded list of files is what
 * made the SPEC 05 barrel guard vacuous: it enumerated what someone remembered, so anything added later
 * was invisible by construction. Here the module set is walked from the app's real entry points — every
 * Next.js route/page/image convention plus the worker — so a new surface is covered the moment it is
 * imported by anything reachable, and a module that is NOT reachable is correctly not policed.
 *
 * WHY IT MATCHES THE OPERATION RATHER THAN IDENTIFIER NAMES. `crawled-text-cut-guard.test.ts` learned
 * this expensively: its first version enumerated three method names and five real idioms walked past
 * it. The operation here is "apply a fabricating DEFAULT to a verdict-bearing expression" — a `??` or
 * `||` whose left side names a grade or a score and whose right side is a LITERAL. That catches
 * `grade ?? ''`, `asNumber(row.score) ?? 0` and `score ?? '—'` alike, and it does not care what the
 * variable is called.
 *
 * SAFE and therefore not matched: an EARLY RETURN on a missing verdict (`if (!grade) return
 * placeholder`), which produces no fallback value at all — what `lib/og-report-model.ts` does after it
 * was fixed.
 *
 * ⚠ KNOWN EVASIONS — MEASURED, NOT ASSUMED, AND DELIBERATELY NOT CLOSED HERE.
 * An adversarial review demonstrated SEVEN idioms that fabricate a verdict and pass this matcher. All
 * five had to be WRITTEN to demonstrate them; none is present in the codebase today (verified). They
 * are recorded rather than closed because closing them was attempted and made the guard WORSE:
 * broadening to "any fallback near a verdict token" flagged 96 sites, of which the large majority were
 * a type declaration, a blank line, Stripe checkout URLs and sparkline geometry. A 96-entry inventory
 * is 80 rubber-stamped justifications, which is this guard's own failure mode in a new costume.
 *
 *   const { grade = 'F' } = row;              destructuring default
 *   fn(grade = 'F')                            parameter default
 *   out.grade ??= 'F';                         logical assignment
 *   row.grade !== null ? row.grade : 'F'       ternary  ← this file previously called it SAFE. It is
 *                                              not: it fabricates the identical 'F'.
 *   grade ?? FALLBACK_GRADE                    named-constant right-hand side
 *   const g = row.grade; …  grade: g ?? '?'    renamed binding (needs dataflow, not a regex)
 *   score:\n     row.score ?? 0                a wrapped expression — the match is line-based. A
 *                                              two-line window was tried and only DOUBLE-reported the
 *                                              same expression at N and N-1; it cannot reach the
 *                                              genuinely-wrapped form because the anchor's character
 *                                              class excludes `:` and whitespace.
 *
 * Ticketed as docs/tickets/2026-08-06-refusal-guard-known-evasions.md. Precedent: the char-cut guard
 * documents its own undetectable case the same way — "logged with the verified evasion rather than
 * shipped as noise".
 *
 * WHEN THIS FAILS, do not paste the new line into the inventory. Decide first:
 *   - can a REFUSED audit reach this line? If yes, the default is a fabrication — remove it.
 *   - if no, what makes it unreachable, and is that pinned by a test?
 * The inventory entry must name the thing that makes it safe, not assert that it is.
 */

const REPO = resolve(__dirname, '../../..');
const WEB = join(REPO, 'apps/web');

// ─────────────────────────────────────────────────────────────────────────────
// 1. ENTRY POINTS — by Next.js/worker CONVENTION, not by a list of surfaces.
// ─────────────────────────────────────────────────────────────────────────────
const ENTRY_BASENAME =
  /^(page|route|layout|template|default|error|global-error|not-found|loading|opengraph-image|twitter-image|icon|apple-icon|sitemap|robots|manifest)\.(ts|tsx)$/;

function walkDir(dir: string, out: string[] = []): string[] {
  for (const e of readdirSync(dir)) {
    if (e === 'node_modules' || e === '.next' || e === 'dist' || e.startsWith('.pgdata')) continue;
    const p = join(dir, e);
    if (statSync(p).isDirectory()) walkDir(p, out);
    else out.push(p);
  }
  return out;
}

function entryPoints(): string[] {
  const entries: string[] = [];
  for (const f of walkDir(join(WEB, 'app'))) if (ENTRY_BASENAME.test(basename(f))) entries.push(f);
  for (const f of ['middleware.ts', 'instrumentation.ts', 'instrumentation-client.ts']) {
    const p = join(WEB, f);
    if (existsSync(p)) entries.push(p);
  }
  // The worker is an entry point in its own right: it serialises a verdict into the completed event
  // and into every persisted row, and nothing in `app/` imports most of it.
  for (const f of walkDir(join(REPO, 'inngest'))) {
    if (f.endsWith('.ts') && !f.includes('.test.')) entries.push(f);
  }
  return entries;
}

// ─────────────────────────────────────────────────────────────────────────────
// 2. THE IMPORT GRAPH.
// ─────────────────────────────────────────────────────────────────────────────
const EXT = ['.ts', '.tsx', '.js', '.jsx'];

function resolveSpec(spec: string, fromFile: string): string | null {
  let base: string;
  if (spec.startsWith('.')) base = resolve(dirname(fromFile), spec);
  else if (spec.startsWith('@/')) base = join(WEB, spec.slice(2));
  else if (spec === '@crawlmouse/engine') base = join(REPO, 'packages/engine/src/index.ts');
  else if (spec.startsWith('@crawlmouse/engine/')) base = join(REPO, 'packages/engine/src', spec.slice(19));
  else if (spec === '@crawlmouse/types') base = join(REPO, 'packages/types/src/index.ts');
  else if (spec.startsWith('@crawlmouse/types/')) base = join(REPO, 'packages/types/src', spec.slice(18));
  else if (spec === '@crawlmouse/inngest') base = join(REPO, 'inngest/client.ts');
  else if (spec.startsWith('@crawlmouse/inngest/')) base = join(REPO, 'inngest', spec.slice(20));
  else return null; // a third-party package — outside our control and outside this rule
  const cands: string[] = [];
  // TypeScript ESM writes `./x.js` for a `./x.ts` source.
  if (base.endsWith('.js')) cands.push(base.replace(/\.js$/, '.ts'), base.replace(/\.js$/, '.tsx'));
  cands.push(base, ...EXT.map((e) => base + e), ...EXT.map((e) => join(base, 'index' + e)));
  for (const c of cands) if (existsSync(c) && statSync(c).isFile()) return c;
  return null;
}

const IMPORT_RE = /(?:^|\n)\s*(?:import|export)\s[^;]*?from\s*['"]([^'"]+)['"]|import\s*\(\s*['"]([^'"]+)['"]\s*\)/g;

function buildGraph(): { reachable: Set<string>; unresolved: string[] } {
  const reachable = new Set<string>();
  const unresolved: string[] = [];
  const stack = entryPoints();
  while (stack.length) {
    const f = stack.pop()!;
    if (reachable.has(f)) continue;
    reachable.add(f);
    let src: string;
    try { src = readFileSync(f, 'utf8'); } catch { continue; }
    for (const m of src.matchAll(IMPORT_RE)) {
      const spec = m[1] ?? m[2];
      if (!spec) continue;
      // Only OUR code is walked. A third-party package cannot be policed by a source scan, and
      // pretending otherwise would be the vacuity this guard exists to avoid.
      if (!spec.startsWith('.') && !spec.startsWith('@/') && !spec.startsWith('@crawlmouse/')) continue;
      const r = resolveSpec(spec, f);
      if (r) { if (!reachable.has(r)) stack.push(r); }
      else unresolved.push(`${relative(REPO, f)} -> ${spec}`);
    }
  }
  return { reachable, unresolved };
}

// ─────────────────────────────────────────────────────────────────────────────
// 3. THE OPERATION: a fabricating default applied to a verdict-bearing expression.
// ─────────────────────────────────────────────────────────────────────────────
/**
 * Left side names a grade or a score and may continue through property access, calls, indexing and
 * optional chaining (so `asNumber(row.score)` is one operand); right side is a LITERAL, which is what
 * makes it a fabrication rather than a fallback to another real value.
 */
const VERDICT_DEFAULT = /(grade|score)[A-Za-z0-9_.$[\]()'"?!]*\s*(\?\?|\|\|)\s*(-?\d|'|"|`)/i;

const isComment = (line: string): boolean => /^\s*(\/\/|\*|\/\*)/.test(line);

/** [ "<path>:<line>", "what makes it safe — naming the mechanism, not asserting the conclusion" ] */
const INVENTORY: [entry: string, why: string][] = [
  [
    'apps/web/app/top/[platform]/page.tsx:64',
    'Leaderboard mapper. Verdict-less reports are excluded AT THE QUERY, not here — pinned by ' +
      'refusal-surfaces.test.ts SURFACE 11, which asserts the SQL filter rather than the render.',
  ],
  [
    'apps/web/app/top/[platform]/page.tsx:65',
    'Same mapper, score half. Same query-level exclusion.',
  ],
  [
    'apps/web/components/report/ReportLegacyFallback.tsx:36',
    'Legacy public-report render. The route 404s first: isReportGone() returns true when the grade is ' +
      'null, pinned by refusal-surfaces.test.ts SURFACES 3 and 4.',
  ],
  [
    'apps/web/components/report/ReportLegacyFallback.tsx:39',
    'Same component, passing flag. Same isReportGone gate upstream.',
  ],
  [
    'apps/web/components/dashboard/SiteCard.tsx:32',
    'scoreDelta of an OPTIONAL delta object. `site.delta?` — the whole delta block renders only under ' +
      '`site.delta ?`, and the refusal branch is tested BEFORE it, so a refused site shows the refusal ' +
      'headline rather than a delta.',
  ],
  [
    'apps/web/components/dashboard/SiteCard.tsx:63',
    'The FROM side of a delta. gradeFrom is nullable because the PREVIOUS audit may have been refused; ' +
      'showing an absence marker for a prior unknown is not fabricating THIS audit\'s verdict, and the ' +
      'refusal branch above already claimed a refused current audit.',
  ],
  [
    'apps/web/components/dashboard/SiteCard.tsx:99',
    'Same gradeFrom, share-payload path. Same branch order.',
  ],
  [
    'apps/web/components/dashboard/dashboard-logic.ts:73',
    'Delta arithmetic on an already-present delta; callers pass a value only when a comparison exists. ' +
      'Pinned by dashboard-logic.test.ts, which covers the refused-re-audit case that produced the ' +
      '"Down 81 points" defect.',
  ],
  [
    'apps/web/components/audit/result-logic.ts:59',
    'NOT a verdict: `projectedGrade?.ledger.length ?? 0` counts ledger entries. Matched only because ' +
      'the property name contains "Grade" — kept listed rather than excluded by name, because ' +
      'excluding by name is how a matcher becomes decorative.',
  ],
  [
    'apps/web/components/audit/result-logic.ts:91',
    'Extracts the first letter of a grade string that is already present; the caller has a verdict.',
  ],
  [
    'apps/web/components/audit/ResultView.tsx:83',
    'NOT a verdict: same ledger-length count as result-logic.ts:59.',
  ],
  [
    'apps/web/app/audit/[id]/AuditView.tsx:178',
    'Inside `{graded && !v2 && ...}`. `graded` is the gate; the same block asserts snapshot!.grade! and ' +
      'snapshot!.score! non-null two lines above, so a refused audit never renders GradeCard at all.',
  ],
  [
    'apps/web/app/api/audits/[id]/stream/route.ts:144',
    'Feeds reconstructConversion, which returns projectedGrade/freeFix/prescriptions ALL NULL for an ' +
      'empty fix set — measured, not assumed. A refused audit persists no fix rows, so the default is ' +
      'consumed by a short-circuit and never reaches the payload.',
  ],
  [
    'apps/web/app/api/audits/[id]/stream/route.ts:145',
    'Same call, grade half. Same measured short-circuit.',
  ],
  [
    'apps/web/app/api/audits/[id]/stream/route.ts:160',
    'computeMonitoringDelta input, gated on isOwner && viewerIsPro && conv.previous_audit_id, and ' +
      'monitoring is re-gated at the projection chokepoint by canMonitor.',
  ],
  [
    'apps/web/app/api/audits/[id]/stream/route.ts:161',
    'Same call, previous-audit half. Same gate.',
  ],
];

describe('GUARD — the refusal gate, over the whole reachable import graph', () => {
  const { reachable, unresolved } = buildGraph();
  const files = [...reachable].sort();

  // ── anti-vacuity: a guard that policed nothing would pass in perfect silence ──────────────────
  it('resolves the graph with NO blind spots', () => {
    // An unresolved internal import is a subtree this guard cannot see. Third-party specs are skipped
    // deliberately and are not counted here.
    expect(unresolved).toEqual([]);
  });

  it('reaches a realistic module count from the entry-point conventions', () => {
    expect(entryPoints().length).toBeGreaterThan(50);
    expect(files.length).toBeGreaterThan(200);
  });

  it('actually reaches the surfaces that leaked, so the walk is not quietly empty', () => {
    // Named here as a REACHABILITY assertion, not as the policed set: if the walk breaks, these vanish
    // and this fails loudly instead of the rule silently covering nothing.
    const rel = new Set(files.map((f) => relative(REPO, f)));
    for (const surface of [
      'apps/web/lib/og-report-model.ts',
      'apps/web/lib/mint-snapshot.ts',
      'apps/web/lib/audit-stream-projection.ts',
      'apps/web/lib/dashboard.ts',
      'apps/web/lib/refusal-copy.ts',
      'apps/web/components/dashboard/SiteCard.tsx',
      'inngest/persist-results.ts',
    ]) {
      expect(rel.has(surface), `import graph no longer reaches ${surface}`).toBe(true);
    }
  });

  it('has a matcher that matches — proven against the real historical defects', () => {
    // The five shipped leaks, verbatim in shape. A matcher that stopped matching would otherwise turn
    // this whole file green while policing nothing.
    for (const bad of [
      "grade: report.grade ?? '?',",
      'score: asNumber(row.score) ?? 0,',
      "currentGrade: row.grade ?? '',",
      "const g = site.currentGrade || 'F';",
      "score: snapshot.score ?? '—',",
    ]) {
      expect(VERDICT_DEFAULT.test(bad), `matcher missed: ${bad}`).toBe(true);
    }
    // And does NOT match the SAFE idiom, or it would force the fixed code back into the inventory.
    for (const ok of [
      'const score = scoreNum != null ? scoreNum.toFixed(0) : dash;',
      "if (!report.grade || scoreNum === null) return { kind: 'placeholder' };",
      "const lastAuditedAt = site.history[site.history.length - 1]?.ranAt ?? '';",
    ]) {
      expect(VERDICT_DEFAULT.test(ok), `matcher over-matched: ${ok}`).toBe(false);
    }
  });

  // ── the rule ──────────────────────────────────────────────────────────────────────────────────
  it('every verdict default in a reachable module is inventoried with what makes it safe', () => {
    const listed = new Map(INVENTORY);
    const found: string[] = [];
    for (const f of files) {
      const rel = relative(REPO, f);
      readFileSync(f, 'utf8').split('\n').forEach((line, i) => {
        if (isComment(line)) return;
        if (VERDICT_DEFAULT.test(line)) found.push(`${rel}:${i + 1}`);
      });
    }
    const unlisted = found.filter((e) => !listed.has(e));
    expect(
      unlisted,
      'A reachable module defaults a withheld verdict into a printable value. Remove the default, or ' +
        'add an inventory entry NAMING what makes it unreachable for a refused audit.',
    ).toEqual([]);

    // Stale entries are removed too: an inventory that outlives its line is a list of claims about
    // code that no longer exists, which is how the SPEC 05 barrel guard died.
    const stale = [...listed.keys()].filter((e) => !found.includes(e));
    expect(stale, 'inventory entries no longer matching any line — delete them').toEqual([]);
  });

  it('gives every inventory entry a real justification', () => {
    for (const [entry, why] of INVENTORY) {
      expect(why.length, `${entry} needs a real justification`).toBeGreaterThan(40);
      // "it is safe" is a conclusion. The entry has to name a mechanism.
      expect(/gate|query|route|pinned|null|branch|short-circuit|counts|present|excluded|graded|ledger/i.test(why)).toBe(true);
    }
  });
});
