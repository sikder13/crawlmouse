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
    text: 'A site keeps at most `report_refusals_max()` entries',
    withdrawnIn: 'docs/specs/v2/31-agency.md §10, CC-31 review rounds 6 and 7',
    truth:
      'An entry that records a pause, a refusal or a request’s time is kept whatever the count, so a ' +
      'row can hold more; past the bound the oldest entries that hold a link’s hash alone go.',
    allowedIn: [],
  },
  {
    text: 'The records the screen reads do not say which the account pays',
    withdrawnIn:
      'docs/specs/v2/22-audit-flow.md (the Seats foot’s registry entry), CC-31 review round 7',
    truth:
      'account.billing_period_months is read from the account’s subscription, and the Seats foot ' +
      'gives the year’s price of a seat to an account charged by the year.',
    allowedIn: [],
  },
  {
    text: 'the changed and cascaded rows read 0',
    withdrawnIn: 'docs/ops/erasure.md §5, CC-V1FIX review round 1',
    truth:
      'executeErasure reads every count again with the erased user id, addresses and accounts ' +
      '(after.counts), and each is 0 only when the erasure is complete.',
    allowedIn: [],
  },
  {
    text: 'which only the v2 door sets, so on v1 it never fires',
    // The guard reads Markdown: this is the finding's text in the report rendered from
    // docs/ops/v1-inventory.json, which v1-inventory.test.ts holds equal to the inventory.
    withdrawnIn:
      'docs/specs/v2/v1-audit.md finding A-8 (from docs/ops/v1-inventory.json), CC-V1FIX review round 1',
    truth: 'Since A-8 every magic-link request sets cm_auth_for, door or v1.',
    allowedIn: [],
  },
  {
    text: 'carries no binding, and then its anonymous v1 audits are claimed',
    withdrawnIn: 'docs/specs/v2/25-account-door.md (Known risks), CC-V1FIX A-8',
    truth:
      'Every magic-link request sets cm_auth_for, and /login/verify claims anonymous v1 audits ' +
      'only when it is the binding of the address the link signed in (bindingMatches).',
    allowedIn: [],
  },
  {
    text: 'that guard does not run on them in the suite',
    withdrawnIn:
      'docs/specs/v2/27-account-screens.md (Known gaps), CC-27 review round 2 (accessibility and deploy safety)',
    truth:
      'account-control-names.test.tsx reads ACCOUNT_ELEMENTS and CC27_ELEMENTS and requires their ' +
      'paths to equal the account previews the registry lists, so the guard runs on every CC-27 preview.',
    allowedIn: [],
  },
  {
    text: 'CC-27 does not edit that file',
    withdrawnIn: 'apps/web/__tests__/v2/_lib/screens.tsx, CC-27 review round 2',
    truth: 'CC-27 extended account-control-names.test.tsx with the owner’s approval.',
    allowedIn: [],
  },
  {
    text: 'so it drops the crawler changes whose summaries describe the old ones',
    withdrawnIn:
      'docs/specs/v2/26-dashboard-site.md (Known gaps), CC-26 review round 2 (correctness and tests)',
    truth:
      'The verdict guard’s account-screen property keeps each crawler change, with a neutral ' +
      'summary in place of one that describes the old verdict, and counts the runs that reach a ' +
      'crawler change opened on a verdict that is not a block.',
    allowedIn: [],
  },
  {
    text: 'and 2 challenged pages can reach 27 pages',
    withdrawnIn:
      'docs/specs/v2/20a-check-builder.md (Differences from ARCH-2), CC-20a mutation of the stage-1 bound',
    truth:
      'Stage 1 holds at most 25 pages because sample checks the page count before each template page ' +
      '(plan.ts STAGE1_MAX_PAGES); the template bound alone does not imply it.',
    allowedIn: [],
  },
  {
    text: 'which is what holds the stage to 25',
    withdrawnIn:
      'docs/specs/v2/20a-check-builder.md (Differences from ARCH-2), CC-20a review round 1',
    truth:
      "Challenged pages can share the homepage's template (a template key leaves the query out), so the " +
      'template bound allows 26; the 25-page check in sample is what holds the stage to its bound.',
    allowedIn: [],
  },
  {
    text: 'to a redirect chain marks every page that carries it',
    withdrawnIn:
      'docs/specs/v2/17-content-and-grade.md (Technical SEO), owner ruling of 2026-11-05 (second set)',
    truth:
      'A crawlability defect is counted on the URL that carries it: a redirect record marks the ' +
      'redirecting URL, not the pages linking to it, so one site-wide link costs at most one URL.',
    allowedIn: [],
  },
  {
    text: 'a robots.txt disallow therefore raises Access as an unblock does',
    withdrawnIn:
      'docs/specs/v2/17-content-and-grade.md (Access) and packages/engine/src/v2/grade/access.ts, CC-17 review round 6',
    truth:
      'A disallow leaves the crawler out of the mean, so Access moves to the mean of the others: up ' +
      'when its share was below it, down when above (35 to 33.33), and as far as an unblock only when ' +
      "the others' mean is 1 (formula rows A5d, A5e).",
    allowedIn: [],
  },
  {
    text: 'so a deliberate block lowers nothing',
    withdrawnIn: 'docs/specs/v2/17-content-and-grade.md (Access), CC-17 review round 6',
    truth: 'Same proposition: disallowing a crawler served better than the others lowers Access.',
    allowedIn: [],
  },
  {
    text: 'by whose application its effect is 0 or less',
    withdrawnIn: 'docs/specs/v2/17-content-and-grade.md (Fix effects), CC-17 review round 6',
    truth:
      'The absorber is the fix whose application takes the effect from above 0 to 0 or less; an ' +
      'effect gone before any fix naming its page is left unattributed (effects.ts).',
    allowedIn: [],
  },
  {
    text: 'no title, or no meta description',
    withdrawnIn:
      'docs/specs/v2/17-content-and-grade.md (Technical SEO) and packages/engine/src/v2/grade/technical-seo.ts, CC-17 third rulings',
    truth:
      'A missing or empty title is a crawlability defect on its URL; a missing meta description is ' +
      'not (owner ruling, 2026-11-05) and stays a page fact (lacksTitle, technical-seo.test.ts).',
    allowedIn: [],
  },
  {
    text: 'which is an owner question',
    withdrawnIn: 'docs/specs/v2/16-structure-detectors.md (conditions), CC-17 fourth ruling',
    truth:
      'The owner ruled (2026-11-05) that the hreflang placement as built is the rule: an alternate ' +
      'the crawl did not read cannot be a finding, and a redirecting or gone alternate puts the ' +
      'defect on the member whose annotation must change.',
    allowedIn: [],
  },
  {
    text: 'the defect counted on the member that names it',
    withdrawnIn: 'docs/specs/v2/17-content-and-grade.md (Technical SEO), CC-17 third rulings',
    truth:
      'A missing hreflang return is counted on the alternate that was read and does not annotate ' +
      'back; the member naming an alternate carries the defect only when that alternate redirects ' +
      'or is gone (hreflang-gaps.ts).',
    allowedIn: [],
  },
  {
    text: 'An alternate does not annotate back, or redirects or is gone.',
    withdrawnIn: 'docs/specs/v2/16-structure-detectors.md (conditions), CC-17 third rulings',
    truth:
      'hreflang_missing_return is carried by the alternate that was read and does not annotate back; ' +
      'an alternate that redirects or is gone is hreflang_alternate_redirects or ' +
      'hreflang_alternate_gone, carried by the member naming it (hreflang-gaps.ts).',
    allowedIn: [],
  },
  {
    // SPEC 12 and SPEC 15 both said it, each rendered from code (worker/src/spec/render.ts,
    // engine/src/v2/access/spec.ts); CC-12d replaced the canary rule with the witness rule.
    text: 'only when the tagged Googlebot canary was served',
    withdrawnIn:
      'packages/worker/src/verdict/table.ts (the witness rule) and SPEC 12, SPEC 15 (CC-12d)',
    truth:
      'A refusal is blocked_by_ua_rule when another tested crawler or the tagged Googlebot canary ' +
      'was served on the same page (ENGINE-GAP §3.5a). On the nike.com shape, Claude-SearchBot served ' +
      'makes four refusals user-agent rules although the canary is refused.',
    allowedIn: [],
  },
  {
    // The verdict meaning (worker/src/verdict/meanings.ts), rendered into SPEC 12 and the runbook; a
    // reviewer found it after the two wordings above were registered.
    text: 'refused while the tagged Googlebot canary was served on the same page',
    withdrawnIn:
      'packages/worker/src/verdict/meanings.ts, SPEC 12, docs/ops/worker-runbook.md (CC-12d)',
    truth:
      'blocked_by_ua_rule means another tested crawler or the tagged Googlebot canary was served on ' +
      'the same page from the same address; the canary is one possible witness, not the only one.',
    allowedIn: [],
  },
  {
    text: 'the tagged Googlebot canary was not served on those pages, so IP verification is not ruled out',
    withdrawnIn: 'packages/engine/src/v2/access/spec.ts, SPEC 15 (CC-12d)',
    truth:
      'An unverified refusal is one where nothing we sent that claims to be a crawler, the canary ' +
      'included, was served on the page: the canary alone being refused does not make it one.',
    allowedIn: [],
  },
  {
    // The spelling that SURVIVED the withdrawal, in the evidence file, and that a reviewer found.
    text: 'can only happen when `page_count < 5`',
    withdrawnIn:
      'evidence/2026-08-08-hotfix-01.md §H1 and docs/OPERATING-RULES.md §5 (Amendment 2)',
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
    truth:
      'Same proposition as above; recorded separately because the two files word it differently.',
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
    allowedIn: [
      'evidence/2026-08-08-hotfix-01.md',
      'docs/deploy/spec51a-stage4-migration-runbook.md',
    ],
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
  {
    text: 'true, true, true, true, false, false, false, false, true, true, false',
    withdrawnIn:
      'docs/deploy/spec51a-stage4-migration-runbook.md (4b), after 20261106000002_v1_client_grant_hardening.sql',
    truth:
      'Since P2 the stage 4 column check reads false, false, false, false, false, false, false, ' +
      'false, true, false, false: authenticated keeps nine audits columns, grade among them, and ' +
      'anon none (infra/supabase/checks/08-v1-client-grants.sql).',
    allowedIn: [],
  },
  {
    text: 'INTENDED READABLE: user-facing by design',
    withdrawnIn:
      'docs/deploy/spec51a-stage4-migration-runbook.md (4b), after 20261106000002_v1_client_grant_hardening.sql',
    truth:
      'audits.refusal and audits.coverage are not readable by anon or authenticated since P2: no ' +
      'client code reads them.',
    allowedIn: [],
  },
  {
    // SPEC 25 said the scrubber removed the claim target everywhere; it removed only keys of that
    // name, and the request-data integration copied the raw Cookie header onto every event (CC-25).
    text: 'and `post_login_next` from every Sentry event',
    withdrawnIn: 'apps/web/lib/auth/sentry-scrub.ts and SPEC 25 (CC-25 review round 2)',
    truth:
      'Sentry events carry no cookie: the request-data integration runs with cookies off, and the ' +
      'scrubber drops cookie, cookies, set-cookie and post_login_next keys and post_login_next= values.',
    allowedIn: [],
  },
  {
    // SPEC 25 implied a call more than half a slot window later is never refused; two calls up to a
    // full window apart can still share a cell (CC-25).
    text: 'a later one finds the first’s ledger rows once they are written',
    withdrawnIn: 'apps/web/lib/auth/stores.ts (gridSerialize) and SPEC 25 (CC-25 review round 2)',
    truth:
      'Within half a window the second call is always refused; up to a full window apart it may be; ' +
      'beyond that it is not, and the ledger lookup decides.',
    allowedIn: [],
  },
  {
    // CC-SEC review round 4: Vercel also serves a static route handler at its .rsc spellings.
    text: 'the two static routes are served only as written',
    withdrawnIn: 'docs/specs/v2/sec-baseline.md (D9), CC-SEC review round 4',
    truth:
      "A static route's own letters answer only as written, and Vercel also serves it with `.rsc` or " +
      '`.rsc/` appended and with `/.rsc` appended; the edge rules count those spellings.',
    allowedIn: [],
  },
  // CC-SEC, the search_path ruling: an empty search_path leaves pg_temp searched first, so check 09
  // no longer allows it. Withdrawn in e302578d (check 09's header, rendered into db-migrations.md) and
  // 642dea0f (sec-baseline.md D6); registered here in a later commit, after the review found the
  // registry had not been updated.
  {
    text: 'must be exactly "", "pg_catalog, pg_temp"',
    withdrawnIn:
      'infra/supabase/checks/09-definer-search-path.sql and docs/ops/db-migrations.md (e302578d)',
    truth:
      'Check 09 allows exactly "pg_catalog, pg_temp" and "pg_catalog, public, pg_temp"; an empty ' +
      'setting is a finding, because it leaves pg_temp searched first.',
    allowedIn: [],
  },
  {
    text: 'exactly `""`, `pg_catalog, pg_temp`',
    withdrawnIn: 'docs/specs/v2/sec-baseline.md, D6 check 09 (642dea0f)',
    truth: 'Check 09 allows exactly `pg_catalog, pg_temp` and `pg_catalog, public, pg_temp`.',
    allowedIn: [],
  },
  {
    text: "`start_trial_with_ledger` keeps `''`",
    withdrawnIn: 'docs/specs/v2/sec-baseline.md, D6 (642dea0f)',
    truth:
      '20261108000002 sets start_trial_with_ledger to pg_catalog, pg_temp and keeps its lock_timeout; ' +
      "its rollback restores ''.",
    allowedIn: [],
  },
  {
    text: 'it has no required reviewer, because',
    withdrawnIn: 'docs/ops/db-migrations.md §7, CC-COST (owner ruling Q3)',
    truth:
      'production has a required reviewer, the owner, enforced while the repository is public ' +
      '(run 43067443133); a private repository on GitHub Pro does not enforce it.',
    allowedIn: [],
  },
  {
    text: 'there is no second click',
    withdrawnIn: 'docs/ops/db-migrations.md §1 step 5, CC-COST (owner ruling Q3)',
    truth: 'While the repository is public, apply waits for the owner to approve production.',
    allowedIn: [],
  },
  // The two below were corrected in d0c2b506 and e6238b12 and registered in the commit after them.
  {
    text: 'A form refused with 400, 402, 409 or 429',
    withdrawnIn: 'docs/specs/v2/31-agency.md §9, CC-31 Tier B review round 2 (n7)',
    truth:
      'POST /api/reports sends a form back to /reports for either of its two 400s, its 402, its ' +
      '403, its 409 and its 429; no request reaches the 403 while each role may export_report.',
    allowedIn: [],
  },
  {
    text: "says what holds a schedule's reports where something does",
    withdrawnIn: 'docs/specs/v2/31-agency.md §8, CC-31 Tier B review round 2 (n6)',
    truth:
      'The matrix’s schedule cell says three holds its records show: no contact, the Agency trial ' +
      'for a contact that is not the owner’s address, and a pause by the recipient. A contact ' +
      'that has not confirmed is not in those records, and the cell says nothing of it.',
    allowedIn: [],
  },
  {
    // CC-32 D7: Cloudflare's changelog of 1 July 2026 gives the new defaults to new domains only.
    text: 'After 15 Sep 2026 the default is not "allow"',
    withdrawnIn: 'docs/OPERATING-RULES.md §12 (Cloudflare), CC-32 D7',
    truth:
      "From 15 September 2026 Cloudflare's changelog gives new domains Training and Agent blocked on " +
      'pages with ads and Search allowed; it states no change for a domain already on Cloudflare, and ' +
      "its policy page says a new domain uses Allow for all three. A site's edge is read from a check.",
    allowedIn: [],
  },
  {
    text: 'serves its own `robots.txt` at the edge and the origin is never asked',
    withdrawnIn: 'docs/OPERATING-RULES.md §12 (Cloudflare), CC-32 D7',
    truth:
      'Bot Preference Sync prepends managed directives to the origin robots.txt, and only when a ' +
      'policy is Block, Block on pages with ads or (Training) Disallow; with every policy on Allow ' +
      'the file is served unchanged.',
    allowedIn: [],
  },
  {
    // Withdrawn in SQL, which this guard cannot read; registered so no document repeats it.
    text: 'so a retried notice reports the same rows',
    withdrawnIn:
      'infra/supabase/migrations/20261115000001_v2_033_operations.sql (take_founder_overflow), CC-33 review round 3 M2',
    truth:
      'A retried "N more" notice reports the rows carrying its key: the ones it took, or none once a ' +
      'later hour re-took them; it takes no new row once a mail was claimed under its key.',
    allowedIn: [],
  },
  {
    // The same comment's other withdrawn sentence (round 3 M2), registered as the one above is.
    text: 'finds no rows under its key',
    withdrawnIn:
      'infra/supabase/migrations/20261115000001_v2_033_operations.sql (take_founder_overflow), CC-33 review round 3 M2',
    truth:
      'A retry of an earlier hour\'s "N more" notice answers the rows still carrying its key, and ' +
      'takes no row back from a later hour once a mail was claimed under its own key: the rows it ' +
      'took, or none once a later hour re-took them.',
    allowedIn: [],
  },
  {
    text: "the constants' bound",
    withdrawnIn: 'docs/ops/inngest-budget.md (the worst check), CC-35 review round 1 (Tier B B3)',
    truth:
      'The heaviest of the shapes searched is not a bound: batches that differ from one another are not tried (scripts/golive/budget.ts).',
    allowedIn: [],
  },
  {
    text: 'with the flags off over the same rows',
    withdrawnIn: 'docs/ops/go-live.md (After a rollback), CC-35 review round 1 (Tier B)',
    truth:
      'Each phase of the rollback proof seeded a fresh stand-in the same way; the ids differ between the two logs.',
    allowedIn: [],
  },
  {
    text: 'shows the same sites and checks',
    withdrawnIn: 'docs/ops/go-live.md (After a rollback), CC-35 review round 1 (Tier B)',
    truth:
      'The proof did not switch the flags on again over the same rows; a rollback changes the deployment, not the database.',
    allowedIn: [],
  },
  {
    text: 'which records the consent, is the one way to start one',
    withdrawnIn: 'docs/specs/v2/35-go-live.md D5, CC-35 review round 1 (Tier B)',
    truth:
      "The test pins CC-29's route as the starter's one importer and the starter as the one source of trialDays.",
    allowedIn: [],
  },
  {
    text: 'lists 4 functions',
    withdrawnIn: 'docs/ops/go-live.md (sync boxes), CC-35 review round 1 (Tier B B2)',
    truth:
      'Inngest syncs an onFailure handler as a function of its own: the counts functionCountsByStep() prints, which golive-sync-count.test.ts holds to the serve route.',
    allowedIn: [],
  },
  {
    text: 'the function count `golive:check` lists',
    withdrawnIn: 'docs/ops/go-live.md, CC-35 review round 2 (deploy safety R2-1, Tier B)',
    truth: 'golive:check prints no function count; functionCountsByStep() does, after each step.',
    allowedIn: [],
  },
  {
    text: 'Nothing a visitor reads changes',
    withdrawnIn: 'docs/ops/go-live.md step 2, CC-35 review round 1 (Tier B)',
    truth:
      'Step 2 serves no route a visitor can use: each route reading V2_PIPELINE answers 404 first while V2_CHECKS_PUBLIC is off.',
    allowedIn: [],
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
    .replace(/\s+/g, ' ') // reflow / re-wrap
    .toLowerCase(); // casing — a LIVE MISS, see below
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
    expect(
      hits,
      'the registry must match its own text through wrapping and blockquotes',
    ).toHaveLength(1);
    // …and the raw form does NOT match, which is why normalisation is not decoration.
    expect(planted.includes(WITHDRAWN[0]!.text)).toBe(false);
  });

  for (const claim of WITHDRAWN) {
    it(`no tracked file still asserts: "${claim.text.replace(/\n/g, ' ').slice(0, 60)}…"`, () => {
      const offenders = docs.filter((rel) => {
        if (claim.allowedIn.includes(rel)) return false;
        return normalize(readFileSync(join(REPO_ROOT, rel), 'utf8')).includes(
          normalize(claim.text),
        );
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
