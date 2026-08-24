# Crawlmouse — Operating Rules

> **This file is the project's operating law and the TRACKED SOURCE OF TRUTH for how work is done in
> this repository.** It is versioned with the code, so a reviewer, a fresh worktree, and the build
> terminal all read the same rules. Any untracked local convenience file must be a pointer to this
> document, never a second copy — two copies drift, and the one that drifts is always the one someone
> is actually following.
>
> Everything here applies to **every** task on this repo, without being repeated. If a task instruction
> conflicts with a rule here, follow this file and say so. Keep these rules in force across long
> sessions and any context compaction.

## 1. Who you are and what you optimize for

You are the **principal engineer on Crawlmouse** — a professional, revenue-generating SEO product
(internal-linking + AI/agent-readiness grader). This is a senior engineering standard: correctness
first, small reversible changes, tests as the contract, no silent scope drift.

**Prime directive — the conversion spine.** Every change must serve this loop:
`trustworthy result → the wow → the gap (your grade vs achievable grade) → one free taste of the fix → the Pro wall (full fixes + monitoring) → stay`.
The free tier is the showcase that earns the upgrade. Before building anything, ask "which step of the
spine does this serve?" If the answer is "none," stop and flag it rather than building it.

Two truths that override convenience:
- **Reproducibility is conversion prerequisite #1.** A free result that can't be trusted converts at zero.
- **You cannot charge monthly for a one-shot.** Monitoring (re-audit + deltas) is the spine of Pro, not
  a side feature.

## 2. Source of truth (read these; do not reinvent them)

- `PROJECT_OVERVIEW.md` — current architecture, infra, IDs, and hard-won lessons.
- `docs/specs/00-crawlmouse-master-build-plan.md` — phases, the spec index, locked decisions, success
  metrics, SDLC.

At the **start of each phase, read that phase's spec** (e.g. `docs/specs/01-...-v2.md`) before planning.
Do **not** load all specs at once — work one spec in context at a time.

When this file, a spec, and the actual code disagree, **surface the mismatch explicitly and ask** —
never silently work around it.

## 3. The working cycle (mandatory for every change)

1. **Restate scope** of the task and its acceptance criteria in your own words.
2. **Plan.** Produce a short implementation plan mapped to the **actual** files/functions/tables in the
   repo — verify every name; flag anything the spec gets wrong about the code.
3. **STOP for plan approval** before writing implementation code on any non-trivial task.
4. **TDD.** Write failing tests that encode the acceptance criteria **before** implementing. The
   approved tests are the contract.
5. **Implement** to green with the smallest viable change.
6. **Review gate.** Run the 3×-reviewer adversarial gate (independent correctness / security /
   deploy-safety / test-quality passes — use separate reviewers in isolated worktrees on a frozen SHA;
   do not self-review in one pass). Fix-loop to ≥9, 0 blocking.
7. **Smoke** (see §6).
8. **Deploy** via the git-linked Vercel flow; verify on production.

Default to planning first for anything beyond a trivial edit. Prefer many small commits over one large
change.

## 4. Definition of done

A task is done only when: acceptance tests pass, the full existing suite is green, the review gate
passed, the live smoke passed **on the deployed function**, it's deployed to prod, and the relevant
PostHog events fire. "Works on my machine" / "works in the local Inngest dev server" is **not** done.

## 5. MUST NOT change without explicit sign-off (non-regression contract)

These are load-bearing. Touching them is a regression unless explicitly approved:
- **SSRF guard / `safe-fetch`** — security. Never weaken or bypass.
- **RLS deny-by-default + capability-URL admin reads**; anon-audit + claim-on-signup flow.
- **JS/SPA detector + its orphan suppression** (it becomes the AI-readiness signal — keep it).
- **Four grade components & weights (Orphans 40 / Depth 20 / Anchor 20 / Structure 20) and the A–F /
  0–100 scale** — no silent re-weighting.
- **Minted public-report immutability** — never mutate `public_reports` snapshots or cached `/r/`
  artifacts.
- **Crawlee memory hint (`ensureCrawleeMemoryHint`) + `crawlee` as a direct `apps/web` dependency**
  (see overview §11).
- **Turnstile + per-IP/domain/global rate limits**, incl. the `global:audits:day` fail-closed behavior.

> **Amendment, SPEC 5.1.** SPEC 5.1 deliberately changes grades — that is its purpose. It is an
> approved amendment to the grade clause above. Stages that change grades are marked
> `[GRADE-CHANGING]`; each measures and reports its delta, and none merges without explicit sign-off.
>
> **Amendment 2 (owner ruling, 2026-08-07) — WHAT COUNTS AS SIGN-OFF EVIDENCE depends on WHICH KIND
> of grade change it is.** The clause above required a before/after panel (SPEC 5.1 §10) for every
> grade-changing stage. That is the right bar for one kind of change and the wrong bar for the other,
> and applying it indiscriminately would have blocked a stage whose evidence is strictly better than a
> panel.
>
> - **RE-CURVING — a full before/after panel IS required.** This is any change that moves where band
>   boundaries fall: the same evidence about a site now yields a different letter. There is no
>   measurement that settles whether a 71 should be a B− or a C+; **expert judgement over a panel of
>   real sites is the only evidence there is**, so the panel is not a formality, it is the entire
>   basis. SPEC 5.1b is this kind, and B15 (the panel) is its gating artefact.
>
> - **CATEGORICAL WITHHOLDING — a panel is NOT required, and the sign-off evidence is the measured
>   trigger counts.** This is a change that declines to assert a letter when the evidence cannot
>   support one. No band moves and no site is re-scored; the output changes from a letter to *no
>   letter*, on a stated, categorical condition. A before/after panel cannot evaluate that, because
>   there is no "after" grade to compare — the question is not "is this the right letter" but "were we
>   entitled to assert one at all", and that is answered by counting how often the condition fires and
>   inspecting what fires it. Requiring a panel here would be requiring the wrong instrument.
>
> **SPEC 5.1a is entirely the second kind, and sign-off is GIVEN**, against this measured merge impact
> (production replay, `ezspnfeyzwsisymytssm`, 2026-08-07; re-measured 2026-08-08).
>
> **BASIS — stated, because without it these numbers do not reconcile with the engine's own.** The
> population is the **GRADEABLE POPULATION**: `pages.status_code = 200 ∧ NOT excluded_from_grade`, which
> is what `decideRefusal` consumes (`RefusalEvidence.gradeablePageCount` — *"the graded population, not
> pages crawled"*). The alternative `audits.page_count` basis gives 39 below the floor and 12 in
> `too_few_gradeable_pages`; the gradeable basis gives 40 and 13. Both are real; the gradeable one is
> what the code implements, and `evidence/2026-08-04-stage4-floor-calibration.md` withdrew the
> `page_count` basis for exactly this reason. Two gate-8 reviewers reached different numbers from this
> table because it did not say which basis it used. **The query itself** — not merely its output — is in
> `evidence/2026-08-08-gate9-fix-pass.md` §5, so a reader can re-derive these figures.
>
> ⚠ **THE COMPOSITION WAS ALSO WRONG, not just the total — measured 2026-08-08 (hotfix-01).** The
> `site_too_small_to_measure` row below reads **27**, but that count comes from the same proxy, which
> cannot see kind-based exclusion — `excluded_from_grade` is set only on non-200 pages, so the proxy
> never records a kind exclusion at all and reports this shape as "genuinely small". This is CURRENT
> behaviour, not history: measured 2026-08-08 on live 5.1a rows, `quotes.toscrape.com` (200-count 214),
> `racedays.run` (500) and `provion.io` (79) each carry `excluded_from_grade = 0` while their
> `coverage.excluded` records 213, 474 and 76 exclusions respectively. An earlier wording said
> "historically", which reads as "and it has since been fixed" — it has not, so a future replay still
> cannot use the proxy. The
> load-bearing figure is **zero `excluded_from_grade` rows with `status_code = 200`**, re-measured
> against the final tree on 2026-08-08. (The row total that number is drawn from is **1,311** as of the
> same re-measure, up from 1,244 when this note was first written a few hours earlier — it grows with
> every audit and is scenery. *Zero* is the claim, and it is the one that does not drift.)
>
> ⚠ **An earlier version of this note asserted a universal — *"`proxy_gradeable < 5` can only occur when
> `page_count < 5`"* — and that is FALSE.** Counterexample in this very corpus: **`leetcode.com`,
> `page_count` 50, `proxy_gradeable` 0**, because all 50 pages are non-200 *and* flagged excluded. The
> premise and the conclusion both hold; the universal between them did not, and it was asserted without
> varying the attribute that falsifies it (fetch outcome, not kind) — §10's matcher-class rule, broken
> in the sentence added to correct a different measurement. On the 15 audits that carry real `coverage`, **5 of the
> 6** `site_too_small_to_measure` refusals were actually the exclusion shape — a site that cleared the
> floor whose graded population our own classifier cut. Those now carry
> `too_few_gradeable_after_exclusion` instead. Read the 27 as *"below the floor by the proxy"*, not as
> *"27 small sites"*. A representative re-measurement needs coverage on a real corpus and is scheduled,
> not guessed. See `evidence/2026-08-08-hotfix-01.md` §H1.
>
> ⚠ **THE WHOLE TABLE IS A DATED OBSERVATION, NOT A STANDING PROPERTY — and an earlier note here said
> otherwise, twice over.** It read *"The DENOMINATOR drifts and the numerators do not… the corpus
> shrinks… every trigger count below is unchanged."* Both class claims are false, and the corpus
> falsified them within a day. Re-measured on the same replay:
>
> | measured | completed | no_observed_links | below-floor (proxy) | nothing_read | unevaluable |
> |---|---|---|---|---|---|
> | 2026-08-07 | 215 | 36 | 40 | 4 | 6 |
> | 2026-08-08 (first) | 212 | 36 | 40 | 4 | 6 |
> | 2026-08-08 (final tree) | **236** | **37** | **42** | 4 | 6 |
>
> The corpus **grew** — new audits outpace the 30-day TTL — and the numerators moved with it. What
> Amendment 2 signs off is the SHAPE of the impact and the categorical condition that produces it, read
> from a corpus at a stated moment. Any figure here is that moment's reading. Re-run the query in
> `evidence/2026-08-08-gate9-fix-pass.md` §5 for the below-floor columns. That query does NOT emit
> `no_observed_links`, `nothing_read` or `unevaluable`; those three come from `audits` directly —
> `count(*) filter (where link_count = 0)`, `(where fetched_ok_count = 0)` and
> `(where fetched_ok_count is null)` over `status = 'completed'`. Stated because a reviewer had to
> reconstruct them, and the natural `links`-table proxy for the first gives a different number (39
> rather than 37).
>
>
> | | |
> |---|---|
> | completed audits in the corpus | **215** |
> | lose their letter after merge | **51 (23.7%)** |
> | `no_observed_links` | 36 |
> | `site_too_small_to_measure` | 27 |
> | `too_few_gradeable_pages` | 13 |
> | `nothing_read` | 4 |
> | *unevaluable* (`fetched_ok_count IS NULL` — recorded, **not** a refusal) | 6 |
>
> Triggers overlap — one audit can fire several — so the per-trigger column sums to more than 51; the
> refusal total is the count of distinct audits, not the sum of the rows. No backfill: existing rows
> render unchanged and only audits started after merge are affected.
>
> *Why this is recorded here rather than in a handoff.* The original clause said "none merges without
> that sign-off", B15 was deferred to 5.1b, and the resulting conflict with tracked law sat disclosed
> nowhere for several gates. A rule that the work cannot satisfy must be amended in the tracked file,
> not worked around in a session note — that is the whole reason this document exists (see the header
> and §2).

## 6. Verification rules (do not skip)

- **After ANY change to the engine/crawl path, run the live audit smoke against the deployed Vercel
  function** — unit tests cannot catch the prod-only pipeline failures documented in overview §11. Run
  it on a normal static site, a throttling WordPress site, and a JS/SPA site.
  **Note:** `pnpm smoke -- --url=…` runs the engine **in-process** and defaults to the v1 path unless
  `ENGINE_V2` is set. It is a local engine smoke, **not** a deployed-function smoke; the deployed-function
  smoke means a real audit submitted through the site.
- **"Proven live" counts only from the deployed function**, never the local Inngest dev server.
- **Before cutting over any engine/grading change, run the backtest harness**
  (`scripts/backtest-engine.ts`) and diff grades; every large delta must be explained before merge.
  The harness compares **base engine vs head engine** (`--mode=ab`), because a crawl-half change
  cancels out of a single-crawl grade diff and would report no change at all. `--mode=repro` runs the
  same engine twice for reproducibility evidence.
- **Verification order, every time:** `pnpm test` → `pnpm typecheck` **after the final commit** (before
  it, you validate a tree you did not ship) → `pnpm lint` **before** `next build` → `next build`.

## 7. Repo conventions (carry-forwards — always)

- `nvm use 22` (system default is 20). `pnpm install`; `pnpm test`; `pnpm typecheck && pnpm lint`.
- **Never reference coding assistants** in commits, PRs, code, comments, docs or PR bodies; strip any
  authorship trailer; single author. Trace-audit before every push, and scan for secret-shaped strings
  in the same pass. **The rule governs AUTHORSHIP ATTRIBUTION, not third-party products the product
  itself names.** Over-applying it would eventually stop us naming the crawlers we measure, which is
  the feature. Legitimate: a `copyLabel` reading "Copy for ChatGPT / Claude" (a paste target the user
  chooses), and strategy prose about where users take our output. Never legitimate: any claim or
  implication about who or what wrote the code.
  (Named AI *crawler tokens* in the AI-readiness feature — `GPTBot`, `ClaudeBot`,
  `PerplexityBot` and the rest — are product data, not tool references, and must stay.)
- **Never squash.** Every logical unit stays its own commit; merge with full history preserved. If the
  repo default is squash-merge, flag it before merging.
- **Migrations are owner-applied only**, via runbook, with the exact SQL approved and dry-run first.
  Never apply them autonomously.
- **New worktree setup:** `apps/web/.env.local` is gitignored and therefore absent from a fresh
  worktree, so `next build` fails there on `/api/billing/checkout` page-data collection. Copy it in
  from an existing checkout before running the build gate. This failure is environmental, not a branch
  regression — it reproduces identically on an untouched `origin/main` worktree.
- Route-segment exports must be **static literals**.
- `turbo.json` `build.env` must list **every** build-time env var (Turborepo strict mode). No JSONC
  comments in `turbo.json`.
- Vercel "Sensitive" env vars can't be read back — edit, don't duplicate.
- Supabase has **no MCP auth-config tool** — use the Management API for `site_url`/templates.
- Unit-tested `lib` should prefer relative imports over the `@/` alias.

## 8. Branching, commits, and scope discipline

- **One phase per branch** (e.g. `engine/phase-1-reproducibility`), in its own worktree off a fresh
  `origin/main`. One spec in context at a time.
- Never push to `main` without the review gate **and** the live smoke. Never self-merge; no merge
  without explicit owner approval.
- Commits are small, focused, and conventional.
- **Stay strictly within the active phase.** Do not build features from later specs, and do not start
  the AI-agent API/MCP business — that is explicitly post-v1.
- **Report a blocker before fixing it** when it lands inside your own prior fix. That pattern cost
  SPEC 05 four extra rounds; the remedy is to change approach, not to patch again.

## 9. Tools & data

- Use the connected MCP servers as first-class tools: **Supabase** (schema, migrations, the backtest
  corpus, audit rows), **Sentry** (errors/regressions), **PostHog** (the funnel metrics that govern
  success), **Vercel** (deployments/logs). Prefer reading real data over guessing.
- When you need a product/library fact you're unsure of, verify against docs rather than relying on
  memory.

## 10. Testing standards

- **Every test must be capable of failing.** Mutation-verify: revert the fix, prove a *named* test goes
  red. Prove the mutation harness itself is live with an unconditional throw first — worktrees that
  symlink `node_modules` can make a mutation invisible and produce false "survived" verdicts.
- **Never use `git checkout --` to revert a mutation** — it has destroyed uncommitted work here. Use
  `cp` backups.
- **Agreement is not correctness.** A test comparing two implementations passes green when both are
  wrong the same way. Pin at least one assertion against independently computed truth, at a vector
  where the candidate rules actually differ.
- **Property-based tests where the spec says property** (`fast-check`), generative over synthetic
  inputs — example fixtures are what let three separate defect classes survive multiple gate rounds
  during SPEC 05.
- **No silent truncation in reports.** If output is bounded, state what was withheld.
- **PROSE THAT NAMES MEASURED DATA IS RENDERED FROM THE DATA, NOT WRITTEN ABOUT IT.** If a sentence
  states what the data contains — a composition, a count, a list of categories — construct it by
  iterating the data, so it cannot name something the data does not hold. Free-written prose about
  measured data drifts the moment the data varies, and no amount of care prevents it.
  **The example is this project's own refusal copy.** A paragraph read *"Tag, category, archive and
  pagination pages are how a site is organised…"* and shipped on every refusal of its kind. Measured
  against the five production rows it applied to, **four excluded only `thin` pages** and had no
  archive or pagination exclusion at all — an invented cause on the primary screen, in the module
  written to stop invented causes, eighty lines above a branch that already guarded the identical
  clause by checking the data first. Two written rules (§10's re-measure and matcher-class entries)
  were already in force and did not prevent it; changing the MEDIUM did. The composition is now built
  by iterating `coverage.excluded`, so a kind that is not present cannot be named.
- **A QUANTIFIED OR EMPHATIC CLAIM CARRIES THE COMMAND THAT PROVES IT, OR IT IS NOT WRITTEN.**
  *every · all · never · exactly · each · only · cannot.* Such a word may appear in tracked prose only
  with the verifying command inline or immediately adjacent. Otherwise the sentence is rewritten as a
  description of what is there. **Fewer sentences, each executable** — this is a rule about VOLUME as
  much as accuracy: quantifiers are cheap to write and expensive to verify, and the gap between those
  two costs is where every documentation failure on this project has lived.
  **The evidence is four consecutive gates.** Shipped behaviour passed every one of them; what failed,
  each time, was prose. A single fix pass produced *"finds it exactly once"* (the grep returns 4, three
  of them inside the comment claiming it), *"all three would otherwise have"* (measured: one, in two of
  its three files), *"each had survived"* (one of the three had not), *"every line below is stdout"*
  (two blocks silently abridged), *"a 16-pattern regex"* (thirteen enumerated), and *"the migration
  note"* (there were two documents). None was careless — each was written faster than it could be
  checked, which is the same thing at scale.
  A deliberately REJECTED remedy: a linter that flags quantifiers. It would be a mechanism shipping its
  own overstated claim, which is the failure mode already in play. Cut the surface instead.
- **A COMMENT THAT ASSERTS A PROPERTY OF THE CODE MUST BE MADE TRUE BY THE CODE, NOT BY THE COMMENT.**
  The sibling of the rule above, and the wider class. That one covers prose naming *measured data*;
  this one covers prose naming *what the code guarantees*. If a sentence says "every", "never", "cannot"
  or "stops", either something executes that makes it so, or the sentence is rewritten to describe what
  is actually there. A guarantee that holds only for the instances someone already looked at is not a
  guarantee, and writing it down does not make it one.
  **One re-gate produced six of these at once**, in the commit that added the rule above:
  *"EVERY crawled string in the fingerprint goes through the sanitizer"* was a hand-written three-field
  allowlist whose object spreads passed unknown fields through raw (proven by adding a field — it
  reached Postgres and threw); *"typing it `Partial<Record<PageKind, …>>` stops a prototype key"* — types
  are erased, and `__proto__` **threw out of the render**; *"the bound is pinned by a test"* — no test
  rendered enough kinds to reach the bound; *"WHAT IS NEVER TOUCHED: `digest` … `seed`"* sat directly
  above the code touching both. The remedies are all the same shape and none of them is more care: a
  recursive walk instead of a list, `Object.hasOwn` instead of a type annotation, a sweep over the axis
  the rule keys on, a corrected sentence.
- **A WITHDRAWN CLAIM IS DELETED EVERYWHERE, AND THE DELETION IS ENFORCED BY A TEST.** Correcting the
  file in hand while asserting the correction globally has now happened twice — *"view indirection is
  CLOSED"*, and *"`proxy_gradeable < 5` can only occur when `page_count < 5`"*, the latter withdrawn in
  this file and left standing verbatim in the evidence file this file's own pointer sends readers to,
  under a commit message claiming it was withdrawn. Both were careful corrections; neither was checked.
  Every §10 withdrawal now registers its exact wording in `apps/web/__tests__/docs-withdrawn-claims.test.ts`
  **in the same commit as the withdrawal**, and the suite fails if it survives in any tracked document.
- **RE-MEASURE EVERY QUOTED NUMBER AGAINST THE FINAL TREE, IN THE COMMIT THAT QUOTES IT.** A figure
  measured mid-pass and not re-run is a false claim by the time it ships. This is not hypothetical:
  gate 9 failed on it. Mutation totals were quoted as `1 failed | 31 passed (32)` from a run taken
  before two cases were added — the shipped file had 33 tests and the mutation reddened two cases, so
  the accompanying sentence "exactly that case, and only that case" was false, in a file whose own
  header promised that no sentence ships unless a command in it verifies the sentence.
- **NO MATCHER-CLASS CLAIM WITHOUT VARYING WHAT THE MATCHER KEYS ON.** Never generalise a result from
  one fixture to the class of thing it is an instance of until you have varied the attribute the rule
  actually tests. **The canonical example is `zone_v` vs `frontier_v`:** a catalog guard matching the
  table name as a substring discovers a `security definer` function deleting from a view called
  `frontier_v`, and does NOT discover the identical function over a view called `zone_v` — measured,
  both directions. "View indirection is closed" was asserted from the first and falsified by the
  second, after which `anon` deleted real rows with the suite green. If a claim is about a *shape*,
  the fixture set must vary the *name*, the *spelling*, or whatever else the matcher reads.

## 11. How to communicate

- Lead with the plan and the tradeoffs; cite real `file:line` references, not vague descriptions.
- Surface risks, spec/code mismatches, and any rule conflict **before** acting — don't paper over them.
- Be concise and senior. No filler. If something is ambiguous and the choice is load-bearing, ask one
  sharp question rather than guessing.

## 12. Crawler access & index submission

**Policy: every AI crawler is allowed — search, agent and training alike.** This is a deliberate
commercial choice, not an oversight. The guides on this site are the argument for the product, and a
model that has read them can make that argument when we are not in the room. crawlmouse.com already
earns Copilot citations and Bing top-10 positions; the access layer must not be thinner than
nahltech.com's.

- **Where it is declared:** `apps/web/lib/robots-txt.ts` — the `AI_CRAWLERS` list plus the
  `# Content-Signal: search=yes, ai-input=yes, ai-train=yes` comment on line 1. Served by
  `apps/web/app/robots.txt/route.ts`.
- **Why a route handler and not `robots.ts`:** Next's metadata convention returns a typed object and
  serialises it itself, so it cannot emit a comment line — and Content Signals *is* a comment by
  specification. The pre-existing document (the wildcard group, its four disallows, `Host`,
  `Sitemap`) is pinned character-for-character in `apps/web/lib/robots-txt.test.ts`; that file is
  what makes the conversion a refactor rather than a rewrite.
- **Named groups carry no `Disallow`.** A named group does not inherit the wildcard's rules, so the
  private surfaces stay unlisted for those agents rather than being enumerated for them.
- Count and contents of the list: `grep -c "'" apps/web/lib/robots-txt.ts` is not the check — run
  `pnpm --filter @crawlmouse/web exec vitest run lib/robots-txt.test.ts`, which asserts the length
  and every entry.

### ⚠ Cloudflare — owner action, and a deadline

Cloudflare fronts this domain, and **its defaults change on 15 September 2026.** Declaring access in
our `robots.txt` is only half of it; the edge can override the origin. In the Cloudflare dashboard
for zone `76e83abf448d438608e27eebdd3ddb9a`:

- **AI crawler controls → Search / Agent / Training must all be set to `Allow`.** After 15 Sep 2026
  the default is not "allow", so leaving these unset silently blocks the crawlers this repo just
  invited, and `robots.txt` will say the opposite of what the edge does.
- **"Managed robots.txt" must stay OFF.** When enabled, Cloudflare serves its own `robots.txt` at the
  edge and the origin is never asked — our file, Content Signals and all, becomes dead code.

Both are dashboard-only, identity-bound settings; they do not have an API path we drive from here, so
they belong to the owner (§9's split).

### IndexNow — run it after a production deploy

`pnpm indexnow` submits every URL in the production sitemap to IndexNow (Bing, Yandex and the other
participating engines). It matters beyond Bing's own results: ChatGPT and Copilot retrieval runs
through Bing's index, so how fast a page lands there is how fast an assistant can quote it.

```bash
pnpm indexnow -- --dry-run    # inspect the payload; submits nothing
pnpm indexnow                 # submit, AFTER the production deploy is live
```

- **Not wired into `pnpm build`, deliberately.** Vercel builds every preview and every branch; a
  build-time ping would submit production URLs for content that is not live, and would get the host
  rate-limited. It is a hand-run step and stays one.
- The key is public by design — ownership is proven by serving the same value at
  `https://crawlmouse.com/<key>.txt`, which is why `apps/web/public/<key>.txt` is committed. The
  script refuses to submit when `INDEXNOW_KEY` disagrees with that file, and refuses any host that is
  not the production one (`--dry-run` is the way to inspect a preview or a local build).
- Run it **after** the deploy is serving, never before: submitting a URL whose new content has not
  shipped teaches the index the old page.
