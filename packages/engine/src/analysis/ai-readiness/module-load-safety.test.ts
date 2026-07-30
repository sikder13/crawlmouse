import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * THE MERGE-DARK PLAN DEPENDS ON THIS INVARIANT: no AI-readiness module may do work at MODULE LOAD that
 * can throw.
 *
 * `extract.ts` imports `computePageAiSignals` STATICALLY, and the `AI_READINESS_EXTRACTION` kill switch
 * (plus its try/catch) wraps only the CALL. So a module-scope throw fires regardless of the flag and
 * takes down the entire crawl path — `/api/audits/start` and the Inngest worker — not just AI
 * readiness. The runbook's rollback lever cannot reach it, and the redeploy it needs is the slowest
 * possible remediation.
 *
 * This nearly shipped: a hand-rolled selector matcher parsed the strip constants at module scope and
 * threw on an unsupported selector shape. That was deliberate fail-fast, and it was safe ONLY because
 * its inputs were compile-time constants, making it build-time-or-never. The matcher is gone (cheerio
 * matches again), so the hazard is gone with it — and this test exists so it does not come back
 * unnoticed, since the next author of a module-scope `const` has no reason to know any of the above.
 *
 * Two checks, because either alone is weak: importing every module proves TODAY is fine, and the source
 * scan proves the SHAPE that made it fragile is absent.
 */
const DIR = new URL('.', import.meta.url).pathname;
const MODULES = readdirSync(DIR)
  .filter((f) => f.endsWith('.ts') && !f.endsWith('.test.ts'))
  .sort();

describe('AI-readiness modules are safe to LOAD (the kill switch cannot cover module scope)', () => {
  it('sanity: the module list is non-trivial, so a glob failure cannot make this vacuous', () => {
    expect(MODULES.length).toBeGreaterThan(5);
  });

  it('every module imports without throwing', async () => {
    for (const f of MODULES) {
      await expect(import(/* @vite-ignore */ join(DIR, f)), f).resolves.toBeDefined();
    }
  });

  it('no module-scope statement can throw at load', () => {
    // Scan for the shape, not just the outcome: a top-level `throw`, or a module-scope `const X = fn()`
    // whose callee is defined in-file and contains a `throw`. Comments and strings are stripped first so
    // prose about throwing does not trip it.
    for (const f of MODULES) {
      const src = readFileSync(join(DIR, f), 'utf8')
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/\/\/[^\n]*/g, '');
      const lines = src.split('\n');
      for (const [i, line] of lines.entries()) {
        // A `throw` at column 0 is module scope by construction (anything nested is indented).
        expect(/^throw\b/.test(line), `${f}:${i + 1} throws at module scope`).toBe(false);
      }
      // A module-scope initializer that CALLS a local function which throws — the exact shape the
      // deleted `const STRIP = parseStripSelectors(...)` had.
      for (const m of src.matchAll(/^(?:export\s+)?const\s+\w+\s*=\s*(\w+)\s*\(/gm)) {
        const callee = m[1]!;
        const body = new RegExp(`function\\s+${callee}\\b[\\s\\S]*?\\n}`, 'm').exec(src)?.[0] ?? '';
        expect(
          /\bthrow\b/.test(body),
          `${f}: module-scope const calls ${callee}(), which can throw — that fires regardless of ` +
            `AI_READINESS_EXTRACTION=0 and takes down the whole crawl path`,
        ).toBe(false);
      }
    }
  });
});
