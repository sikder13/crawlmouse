import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { RENDERED_SURFACES } from '@/lib/audit-view-state';

/**
 * SOURCE GUARD — the shape of `AuditView`'s render branches.
 *
 * GATE 4 / W8b. `AuditView.tsx` drew the refusal screen as `{refused && v2 && <ResultView …/>}`, and
 * a line-count-preserving mutation to `{false && refused && v2 && <ResultView …/>}` left the entire
 * 1426-test suite GREEN. That mutation is gate 3's blocker restored verbatim: every refused audit
 * back to the pre-5.1 failure card, "usually a site that blocks crawlers", in the failure colour.
 *
 * WHY A SOURCE GUARD AND NOT A RENDER TEST. `AuditView` is a client component driven by EventSource,
 * and this suite has no jsdom and no testing-library — every `.tsx` test renders through
 * `renderToStaticMarkup`. The React lifecycle is genuinely out of reach, which is why the branch sat
 * unverified through four gates. The decision itself is now a pure function (`chooseSurface`, proved
 * by execution in `audit-view-state.test.ts`); this file covers the other half — that the JSX still
 * WIRES that decision, one operand per branch.
 *
 * IT MATCHES THE OPERATION, NOT NAMES. The check is the shape of the guard expression: a branch must
 * open with `{surface === '…' &&` and nothing may precede the comparison inside the brace. Prefixing
 * `false &&`, `0 &&`, or any other operand moves the comparison off the opening brace and fails.
 * `crawled-text-cut-guard.test.ts` learned this distinction expensively; the SPEC 05 barrel guard and
 * gate 4's RPC guard both learned the sibling lesson — never carry your own copy of the inventory —
 * so the surface list here is IMPORTED from the module that defines it.
 */

const RAW = readFileSync(join(process.cwd(), 'app/audit/[id]/AuditView.tsx'), 'utf8');

/**
 * Comments are stripped before anything is matched. The first draft of this guard failed on the
 * comment that EXPLAINS the old compound form — it read the file's prose as if it were its code,
 * which is the identical mistake gate 4 found in the first draft of the RPC privilege guard (it
 * flagged the migration comment explaining why the functions are INVOKER). A guard that reads
 * documentation is a guard that goes red when someone documents the hazard it exists to catch.
 *
 * Block comments first, then line comments — and `//` inside a string is not a concern here because
 * the file contains no such literal; the anti-vacuity test below fails loudly if this ever eats the
 * component itself.
 */
const SRC = RAW.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1');

describe('GUARD — AuditView wires every surface, with single-operand branches', () => {
  it('renders a branch for every surface the decision can return', () => {
    // Deleting a branch outright is the other half of W8b, and it is caught by CONTENT rather than by
    // a line number — gate 4 / R3-NB4, where a `path:line` inventory produced phantom kills because
    // any line shift turned the guard red with no behavioural assertion failing.
    for (const surface of RENDERED_SURFACES) {
      expect(SRC, `no branch renders the '${surface}' surface`).toContain(`{surface === '${surface}' &&`);
    }
  });

  it('lets nothing precede the comparison inside a branch — `false &&` cannot be smuggled in', () => {
    // Every occurrence of the comparison must sit immediately after the opening brace.
    const occurrences = [...SRC.matchAll(/surface === '/g)].map((m) => m.index!);
    expect(occurrences.length).toBeGreaterThanOrEqual(RENDERED_SURFACES.length);
    for (const idx of occurrences) {
      let i = idx - 1;
      while (i >= 0 && /\s/.test(SRC[i]!)) i -= 1;
      const preceding = SRC.slice(Math.max(0, idx - 60), idx + 30).replace(/\n/g, ' ');
      expect(SRC[i], `a guard expression has an operand before the comparison: …${preceding}…`).toBe('{');
    }
  });

  it('keeps the old compound conditions out — they are what accepted the mutation', () => {
    // The pre-fix forms. Each one is a branch whose truth depends on more than the chosen surface,
    // which is exactly what let an extra operand hide.
    for (const banned of [
      '{refused &&',
      '{graded &&',
      '{running &&',
      '{canceled &&',
      '{awaitingResults &&',
      '{(failed ||',
    ]) {
      expect(SRC, `the compound branch form \`${banned}\` is back`).not.toContain(banned);
    }
  });

  it('reads a file that actually exists and actually contains the view', () => {
    // Anti-vacuity: a guard whose input silently became an empty string would pass every assertion
    // above by finding nothing to object to.
    expect(SRC.length).toBeGreaterThan(2000);
    expect(SRC).toContain('export function AuditView');
    expect(SRC).toContain('chooseSurface(');
  });
});
