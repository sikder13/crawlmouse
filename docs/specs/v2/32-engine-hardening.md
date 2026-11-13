# SPEC 32 — Engine hardening (CC-32)

The engine says only what it measured, and the fetch guard has no gap, before v2 is switched on. Each
section gives the decision, the answers the build acted on (`questions.md` in the step's notes, with
the owner's rulings), and the gaps it leaves. The generated specs named below say what the code does;
this file says why.

<!-- D1 is the lead's section. -->

## D2 — A pure app shell is found and said; the grade population does not change

**Decision.** A route that serves an empty root is classed `thin` and is not graded. It is now an
_empty-root page_: a crawled page that answered 200 with HTML, was classed `thin`, and whose crawl row
v1's JS detector read as an app shell (`content_features.client_rendered`). The rule is one predicate,
`emptyRoot` (`packages/engine/src/v2/render/empty-root.ts`), read by the render, by `buildCheck`'s render
guard and by the `client_rendered_template` detector through `emptyRootUrls`
(`packages/engine/src/v2/build/plan.ts`).

- The render runs in two phases (`render/run.ts`). The graded phase is the render as it was. Once it has
  settled, the empty-root phase renders up to `EMPTY_ROOT_MAX_RENDERS` pages, `EMPTY_ROOT_PER_TEMPLATE`
  a template, drawn from every crawled page and ordered by template key, then PageRank, then URL, under
  its own allowance, daily reservation and stop. `docs/specs/v2/14-render.md` gives the numbers.
- The detector counts a template _present_ when it has a graded page or an empty-root page. A
  template with a graded page is judged on its rendered graded pages alone, so its verdict and
  confidence are what they were before CC-32; with no graded page rendered it reads `not_rendered`,
  whatever its empty-root pages show. Only a template with no graded page is judged on its rendered
  empty-root pages. `renderedConfidence` counts the renders that decided the verdict.
- `buildCheck` admits a render of a sampled page the graded phase may render, or of one of the
  empty-root picks `selectEmptyRoots` makes from the same crawl, and refuses any other.
- A throw out of an empty-root page leaves that phase's pages `phase_threw`; the graded phase stands.
  When today's budget refused the graded phase or threw, the empty-root phase does not ask it.
- No grade input moves. Verify:
  `pnpm --filter @crawlmouse/engine exec vitest run src/v2/build/no-grade-moves.test.ts src/v2/render/run.empty-root.test.ts`.
  The first builds each build fixture and each grade-guard case with the empty-root phase at 0 and at
  `EMPTY_ROOT_MAX_RENDERS`, with room for both phases and under a per-day cap the graded phase fills,
  and compares every grade, component, content, signals, coverage and site text-share number.
- The fixture `packages/engine/fixtures/v2/build/empty-shell-site.ts` is an empty shell on every route
  but one; its expected records are written by hand in `src/v2/build/empty-shell-site.test.ts`.

**Acting on.**

- _Q6, corrected._ The empty-root phase comes last: its allowance is the per-check browser time the
  graded phase left, not render slots. So it renders on a large site too, whenever the graded renders
  leave time; Q6's premise that a site with 25 or more graded pages renders no empty-root page was
  wrong. Its renders decide only templates with no graded page, so they cannot move a graded
  template's verdict. Where the graded phase uses the time, a template of empty-root pages alone reads
  `not_rendered`. Owner ruling: changing which pages Readable reads is a §5 question for later.
- _Q8, as ruled._ A template of empty-root pages alone has no graded page, so its fix's estimated effect
  is 0. Such a fix now ranks first among the site's fixes (`shellOnly`, `grade/effects.ts`, ties by
  fingerprint); its counterfactual changes no graded page, so no other fix's effect, absorption or the
  overview moves. The views head a `client_rendered_template` fix whose AI effect is estimated at 0 or
  less with "Makes N pages readable without JavaScript" (`pages_readable`,
  `apps/web/lib/v2/view/effect-headline.ts`), never a grade number and never "no measurable effect"; an
  AI effect still null keeps saying why it waits. N is the fix's `affected_pages`: for such a template,
  its crawled empty-root pages, which is what the check saw. How many of them were rendered is not on
  the Fix record, so no sample size is printed. Verify:
  `pnpm --filter @crawlmouse/engine exec vitest run src/v2/grade/effects.rendered.test.ts src/v2/build/empty-shell-site.test.ts`
  and `pnpm --filter @crawlmouse/web exec vitest run lib/v2/view/pages-readable.test.ts`.

**Known gaps.**

- **The coverage count is not stored.** The brief asked for `Check.coverage.empty_root_pages`. The
  contract forbids an optional key (`packages/types/src/v2/contract.test.ts`, "no field anywhere in the
  contract is optional"), and a required or nullable key would fail every stored check, so it was
  stopped for the owner. The count is computable from the stored rows today (`emptyRootUrls`).
- **Across checks.** The empty-root phase spends per-check time the graded phase left, under the
  unchanged per-check and per-day caps, so a day's total can be reached sooner and a later check's
  graded phase refused `daily_cap`. Within one check no grade input moves; across checks this is the
  one way the phase can, bounded by `EMPTY_ROOT_MAX_RENDERS` renders a check.
- An open fix's shell template is not put first in the empty-root phase; the order is by key alone.
- The built-site recording (`fixtures/v2/build/generate.ts`) leaves the empty-root phase off, so the web
  fixture built from it is unchanged; `empty-shell-site.ts` carries the phase.
- Production renders nothing until a daily budget is set (`apps/web/lib/v2/pipeline/steps/finish.ts`), so
  each crawled shell template's record reads `not_rendered` there, and the check that first detects it
  writes no `opened` change row (`diff/diff.ts` `measuredBefore`).

## D3 — A fix whose subject is gone is measured, as `template_absent`

**Decision.** `detectRendered` gives a record to each template an awaiting client-rendered fix names
(`awaitingShellTemplates`, `AWAITING_FIX_STATUSES`), the helper the render planner reads too. When the
check holds no graded and no empty-root page of the template, the record is `indeterminate`, reason
`template_absent` (appended to `RENDERED_INDETERMINATE_REASONS`, engine-local). The lifecycle's rule
for an indeterminate record applies; no state is added. Verify:
`pnpm --filter @crawlmouse/engine exec vitest run src/v2/detectors/rendered-absent.property.test.ts`, a
fast-check property over generated pages and fixes through `detectorOutcomes` and `diffCheck`: each
awaiting fix with a template key gets a record, and the diff moves its last measurement to the check.

**Acting on.** F3 is reframed, not closed: an open fix whose template is gone is measured again on each
check and reads indeterminate; a fix marked done becomes `unable_to_verify`. The fix does not close by
itself.

**Known gaps.** A template that comes back is measured as usual; one that never does keeps its open fix
open, now measured. `template_absent` is not stored: the fix keeps `last_state` `indeterminate`, and its
`gone` field holds a page's 404 or 410 only, which cannot say "template gone" without a contract change,
so the dashboard cannot tell a gone template from one not rendered. An awaiting fix whose
`template_key` is null cannot be named by template: it gets no record and stays as it was (the
property generates that case). The detector opens every fix with its template's key.

## D4 — An effect at or below zero is shown as no measurable effect

**Decision.** The engine keeps the number it computed. In `apps/web/lib/v2/view/effect-headline.ts`,
`formatPoints` is the one printer of an effect's sign: a figure above zero only. The headline is, in
order: waiting where it waited before (and, for a structure fix, when its Technical SEO effect is at or
below 0 and its AI effect is not estimated); AI points above 0; for a `client_rendered_template` fix
whose AI effect is estimated at 0 or less, the pages it makes readable (D2's Q8 ruling); Technical SEO
points above 0; "SEO not estimated" when that effect is null; otherwise `no_effect`, "No measurable
effect on the grade" (short form "No measurable effect"). A group's points take each member at 0 first
(`groupSum`). D4 leaves the fix order unchanged. Verify:
`pnpm --filter @crawlmouse/web exec vitest run lib/v2/view/effect-points.test.ts lib/v2/view/plus-sign-guard.test.ts`.
The guard fails on a line under `lib/v2/view` that holds `+${` or a quoted plus sign and is not an
allowlisted line of its file; its self-test shows it flags a mid-template `+${` and a second such line
in an allowlisted file.

**Acting on.** _Q5:_ the printers are `points`, `fixFirstBody`, `restPoints` (the "N more" row) in
`result.ts`, and `effectOf`, `proPoints` and `groupPoints` in `segment/fixes.ts`.

**Known gaps.** A minted report snapshot keeps the text it was minted with. Screens whose fixtures print
a group of zero effects now read "No measurable effect" where they read "+0 …"; their visual baselines
were not re-taken here.
