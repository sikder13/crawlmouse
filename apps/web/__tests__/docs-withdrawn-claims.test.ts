import { describe, it, expect } from 'vitest';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * GUARD: A WITHDRAWN CLAIM CANNOT SURVIVE ANYWHERE IN TRACKED DOCUMENTATION.
 *
 * ─── WHY THIS EXISTS ───────────────────────────────────────────────────────────
 * Twice now, a false proposition has been corrected in the file someone happened to have open and
 * asserted — in the same commit — to have been corrected everywhere.
 *
 *  1. *"view indirection is CLOSED"* was generalised from a fixture named `frontier_v` and falsified by
 *     the identical shape named `zone_v` (`OPERATING-RULES` §10's canonical matcher-class example).
 *  2. *"`proxy_gradeable < 5` can only occur when `page_count < 5`"* was withdrawn in
 *     `docs/OPERATING-RULES.md` and left standing verbatim in `evidence/2026-08-08-hotfix-01.md` — the
 *     very file that document's "see §H1" pointer sends the reader to — under a commit message stating
 *     the claim was withdrawn. A reviewer found it with one `grep`.
 *
 * Both are the same failure, and it is not a failure of care: the correction WAS careful, and it was
 * still local. Nothing executed to check that the sentence was gone. This test is that execution.
 *
 * ─── THE CONTRACT (`OPERATING-RULES` §10) ─────────────────────────────────────
 * When a §10 withdrawal retires a proposition, its distinctive wording is added to `WITHDRAWN` **in
 * the same commit as the withdrawal**. Thereafter no tracked file may contain it except while
 * explicitly quoting it as withdrawn — which is what `allowedIn` is for, and why an allowance must
 * name the file and say why.
 *
 * ─── WHAT THIS GUARD DOES **NOT** DO ──────────────────────────────────────────
 * Stated plainly, because a guard whose scope is overstated is the exact thing this file exists to
 * stop, and this repo has shipped that defect before (the catalog guard's completeness claim, four
 * times).
 *
 *  · It matches STRINGS, not meaning. A paraphrase passes, and so does any rewording.
 *  · **Markdown emphasis inside the claim defeats it** (`can only **happen** when`), as does an HTML
 *    comment splitting a word (`hap<!-- x -->pen`). Both were demonstrated against this guard.
 *  · Inside an `allowedIn` file it cannot tell "quotes this in order to withdraw it" from "asserts it
 *    again". `allowedIn` is a recorded human judgement, not a proof. It is deliberately per-file
 *    rather than global so the hole is one named file wide, and `allowedIn` entries are themselves
 *    checked below — an allowance for a claim a file no longer contains fails the suite.
 *  · It covers tracked `*.md` only: not code comments, not migration SQL, not commit messages, not the
 *    PR body. `~6.5 kB worst case` lives in a `.sql` file this guard cannot see, which is why that
 *    entry names the SQL explicitly in `withdrawnIn`.
 *
 * Normalisation handles blockquote markers, whitespace reflow, and CASE.
 *
 * ⚠ TWO CLAIMS ABOUT THIS GUARD WERE FALSE IN THE COMMIT THAT INTRODUCED IT, and a reviewer measured
 * both. It said normalisation was load-bearing for "all three" registry entries: replacing `normalize`
 * with the identity function costs **2 of the 8 tests**, not all of them — entries 1 and 2 appear unwrapped on
 * a single line and match raw, so only entry 3 needs it, in 2 of its 3 files. And case folding was
 * absent, which was not hypothetical: `evidence/2026-08-08-gate9-reports.md` carries
 * "View indirection is CLOSED" with a capital V, in a file that is not excused — the guard passed on
 * one character of case. Writing a guard and then asserting its reach without measuring it is the same
 * defect the guard exists to catch, one level up.
 */

const REPO_ROOT = join(__dirname, '..', '..', '..');

interface WithdrawnClaim {
  /** The exact wording that must not survive. Distinctive enough that a match is the claim itself. */
  readonly text: string;
  /** Where it was withdrawn, so a reader can find the correction and the evidence for it. */
  readonly withdrawnIn: string;
  /** What is true instead — recorded here so the registry is readable on its own. */
  readonly truth: string;
  /** Files permitted to contain it, each because they quote it AS withdrawn. */
  readonly allowedIn: readonly string[];
}

const WITHDRAWN: readonly WithdrawnClaim[] = [
  {
    // The spelling that SURVIVED the withdrawal, in the evidence file, and that a reviewer found.
    text: 'can only happen when `page_count < 5`',
    withdrawnIn: 'evidence/2026-08-08-hotfix-01.md §H1 and docs/OPERATING-RULES.md §5 (Amendment 2)',
    truth:
      'leetcode.com has page_count 50 and proxy_gradeable 0 — all 50 pages non-200 AND flagged ' +
      'excluded. The proxy is blind to KIND exclusion, which is a different reason from being small.',
    // Quotes it inside the ⚠ block that withdraws it.
    allowedIn: ['evidence/2026-08-08-hotfix-01.md'],
  },
  {
    // The spelling used in tracked law where the claim is quoted back in order to call it false.
    text: 'proxy_gradeable < 5` can only occur when `page_count < 5',
    withdrawnIn: 'docs/OPERATING-RULES.md §5 (Amendment 2)',
    truth: 'Same proposition as above; recorded separately because the two files word it differently.',
    allowedIn: ['docs/OPERATING-RULES.md'],
  },
  {
    // Registered in the commit that withdrew it — which is the rule, and which the withdrawing commit
    // did not do. Registering it here is what surfaces `docs/deploy/spec51a-stage4-migration-runbook.md`,
    // a second document the withdrawal never mentioned.
    text: '~6.5 kB worst case',
    withdrawnIn: 'inngest/persist-helpers.ts (the bound) and evidence/2026-08-08-hotfix-01.md §H2',
    truth:
      'The post-bound worst case is ~57 kB on the wire / ~34 kB on disk, on two DIFFERENT hostile ' +
      'payloads — JSON escaping doubles quotes and backslashes, which the UTF-8 byte budget does not ' +
      'count. The original figure assumed ~60 B keys.',
    // The migration SQL carries it too, at 20260804000001:69, but this guard reads `*.md` only — an
    // applied migration file is not edited retroactively, so that copy is corrected in the runbook and
    // at the bound instead.
    allowedIn: ['evidence/2026-08-08-hotfix-01.md', 'docs/deploy/spec51a-stage4-migration-runbook.md'],
  },
  {
    text: 'view indirection is CLOSED',
    withdrawnIn: 'docs/OPERATING-RULES.md §10 (the zone_v / frontier_v matcher-class rule)',
    truth:
      'A catalog guard matching the table name as a substring discovers a security-definer function ' +
      'over a view called frontier_v and NOT the identical function over one called zone_v. Measured ' +
      'both directions; anon deleted real rows with the suite green.',
    // Case-insensitive matching is what makes this entry cover `evidence/2026-08-08-gate9-reports.md`,
    // which carries it with a capital V — a LIVE MISS the guard passed on its first commit.
    //
    // All three quote it in order to call it false: CURRENT-STATUS as the corrected claim FC-1,
    // OPERATING-RULES §10 as a worked example of the class, and the hotfix evidence as the first of
    // the two occurrences that motivated this guard.
    //
    // Worth recording: this guard FAILED on the commit that introduced it, because writing §10's new
    // entry and the evidence section quoted the claim in two more files. That is the guard working —
    // the allowance is a deliberate, reviewable act, which is exactly what it could not be when the
    // only mechanism was remembering to grep.
    allowedIn: [
      'docs/handoff/CURRENT-STATUS.md',
      'docs/OPERATING-RULES.md',
      'evidence/2026-08-08-hotfix-01.md',
      // Surfaced ONLY by case folding: the gate report that first called it false, headed
      // "FC-1 · 'View indirection is CLOSED' — FALSE. The closure is NAME-DEPENDENT."
      'evidence/2026-08-08-gate9-reports.md',
    ],
  },
];

/**
 * Markdown-aware normalisation. Strips blockquote markers and collapses whitespace, so the SAME
 * sentence is the same string whether it was re-wrapped by an editor or moved into a `>` block.
 * Both real occurrences were line-wrapped, and one of them lives inside a blockquote — matching raw
 * text would have missed all three registry entries.
 */
function normalize(text: string): string {
  return text
    .replace(/^[ \t]*>[ \t]?/gm, '') // markdown blockquote markers
    .replace(/\s+/g, ' ')             // reflow / re-wrap
    .toLowerCase();                   // casing — a LIVE MISS, see below
}

/** Every tracked documentation file. `git ls-files` so untracked scratch cannot fail the suite. */
function trackedDocs(): string[] {
  const out = execFileSync('git', ['ls-files', '-z', '*.md'], { cwd: REPO_ROOT, encoding: 'utf8' });
  return out.split('\0').filter(Boolean);
}

describe('GUARD: withdrawn claims do not survive in tracked documentation', () => {
  const docs = trackedDocs();

  it('finds a corpus at all — a guard over zero files proves nothing', () => {
    // Anti-vacuity. If `git ls-files` ever returns nothing (wrong cwd, no git), every assertion below
    // passes for free, which is exactly the shape of a guard that has quietly stopped guarding.
    expect(docs.length).toBeGreaterThan(20);
    expect(docs).toContain('docs/OPERATING-RULES.md');
  });

  it('the registry is well-formed, so an entry cannot be added that guards nothing', () => {
    for (const c of WITHDRAWN) {
      expect(c.text.length, `too short to be distinctive: ${c.text}`).toBeGreaterThan(15);
      expect(c.withdrawnIn.length).toBeGreaterThan(0);
      expect(c.truth.length, `no stated truth for: ${c.text}`).toBeGreaterThan(20);
    }
  });

  it('the guard is LIVE — a planted withdrawn claim is found', () => {
    // Proves the matcher runs, per §10's "prove the harness live" rule, without writing to the repo.
    // Planted the way a real regression arrives: re-wrapped, and inside a blockquote.
    const planted = `> preamble\n> ${WITHDRAWN[0]!.text.replace(' ', '\n> ')}\n> postamble`;
    const hits = WITHDRAWN.filter((c) => normalize(planted).includes(normalize(c.text)));
    expect(hits, 'the registry must match its own text through wrapping and blockquotes').toHaveLength(1);
    // …and the raw form does NOT match, which is why normalisation is not decoration.
    expect(planted.includes(WITHDRAWN[0]!.text)).toBe(false);
  });

  for (const claim of WITHDRAWN) {
    it(`no tracked file still asserts: "${claim.text.replace(/\n/g, ' ').slice(0, 60)}…"`, () => {
      const offenders = docs.filter((rel) => {
        if (claim.allowedIn.includes(rel)) return false;
        return normalize(readFileSync(join(REPO_ROOT, rel), 'utf8')).includes(normalize(claim.text));
      });

      expect(
        offenders,
        `This claim was withdrawn in ${claim.withdrawnIn}.\n` +
          `What is true instead: ${claim.truth}\n` +
          `Still asserted in: ${offenders.join(', ')}\n` +
          `Correct those files, or — if a file quotes it in order to withdraw it — add the file to ` +
          `that entry's allowedIn with a comment saying why.`,
      ).toEqual([]);
    });
  }

  it('every allowedIn entry really does contain the claim it is excused for', () => {
    // An allowance that no longer applies is a hole nobody can see. If the quoting file stops quoting
    // the claim, the allowance must go rather than sit there permitting a future re-introduction.
    for (const claim of WITHDRAWN) {
      for (const rel of claim.allowedIn) {
        expect(docs, `allowedIn names a file that is not tracked: ${rel}`).toContain(rel);
        expect(
          normalize(readFileSync(join(REPO_ROOT, rel), 'utf8')).includes(normalize(claim.text)),
          `${rel} is excused for a claim it no longer contains — delete the allowance`,
        ).toBe(true);
      }
    }
  });
});
