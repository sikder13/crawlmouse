# SPEC 05 Hotfix-01 — handoff (2026-07-31)

**Written for a reader with ZERO prior context.** Everything needed to resume is here or linked from
here. Read this file top to bottom before touching anything.

---

## 1. Where the code is

| | |
|---|---|
| Working tree | `/home/udsik/nahl-clients-projects/crawlmouse-spec05` (a git worktree of the main repo) |
| Branch | `fix/spec05-hotfix-01` |
| HEAD | `9f3e250d00ab9375256b1ad482434be96d70cba2` |
| Base | `main` @ `1d67056` (the merged SPEC 05 PR #21) |
| **Pushed?** | **NO — local only.** `git ls-remote --heads origin fix/spec05-hotfix-01` is empty. Nothing on this branch exists anywhere but this machine. |
| Tree | clean (`git status --porcelain` empty) |
| Suite | engine **603** · web **1308** · inngest **136** · scripts **5** — `npx turbo run test --force` 5/5 green |
| typecheck / lint / build | all green; `next build` OK, route classification byte-identical to pre-hotfix (reviewer-verified by manifest diff) |
| No PR opened | Standing instruction is **STOP at the PR**; we never reached it. |

### Commits on the branch (base → HEAD)

```
52365e4 fix(ai): the access card contradicted the findings on the same screen, plus two copy defects
d9ac01c fix(ai): close the gate findings — the summary garbled real copy, and the render layer was unpinned
b0b325a fix(ai): the summary put the generic half first and truncated the distinguishing half
9f3e250 test: close the round-2 test gaps, and state the render-time effect on minted reports
```

### Leftover gate worktrees (safe to delete)

`../cm-hf2-r1`, `../cm-hf2-r2`, `../cm-hf2-r3`, all detached at `d9ac01c`.
Remove with `git worktree remove --force ../cm-hf2-rN && git worktree prune`.
Their `node_modules` are **symlinks into `crawlmouse-spec05`** — see §7, this has burned reviewers.

---

## 2. Job 2 — production canary: **DONE, owner-accepted**

SPEC 05 is merged and `AI_READINESS_EXTRACTION` is **ON** in production. The formal three-site smoke
ran against production and passed. Owner accepted this and closed the job.

| site | class | AI score / band | page-class sample | `ai_signals` | duration vs baseline |
|---|---|---|---|---|---|
| `alynthe.com` | JS/SPA — **flagship** | **36 · `at_risk`** | **`{js_blind: 9}`** | 9/9 | 4 s vs 2 s |
| `mohammadalinijhoom.com` | throttling WordPress | 84 · `ready` | 61 pages | 61/61 | 250 s vs 247 s |
| `info.cern.ch` | static — **control** | 79 · `partial` | 432 pages | 415/432 | **247 s vs 248 s** |

**The flagship assertion passed**, which is the point of the whole exercise: `contentWithoutJs` is **0**
on the weight-40 component and every page classifies `js_blind`. The round-9 blocker (a hand-rolled CSS
matcher that missed `<script>`/`<style>`) would have scored this site **~89 `ready`**. It doesn't.

`info.cern.ch` is an exact control — same site, same 432 pages, same linking grade `B−/73.33` — measured
**248 s with extraction OFF vs 247 s ON**, i.e. no measurable cost, plus incidental determinism proof.

The 17 of 432 pages without `ai_signals` are all `status_code = 0` (no response body ever arrived), so
there was nothing to extract. 200s: 320/320. 404s: 95/95. **Not a defect.**

No crashes, no audit failures, no new Sentry issues (the single pre-existing `crawl.degraded`, 2 events,
last seen before the smoke). No public reports minted during the smoke, as instructed.

**SPEC 5.1 control case, recorded by owner request:** `racedays.run` scored **80.32 / B+ / 419 pages on
both 2026-07-27 and 2026-07-30** — byte-identical three days apart. Reproducibility holds; the known
instability is site-shape-dependent (duskroute-style giant index pages monopolising the frontier), not
universal.

---

## 3. Job 1 — the hotfix: what it is

Three defects observed on the live SPEC 05 UI. **apps/web only — no engine, no scoring, no persisted
shape, no migration.**

- **H1 (critical).** The "Who can reach your content" card rendered `blockedRetrievalBots` — bots with
  `allowedPageRatio < 1` — under a heading that says the opposite. On production audit
  `15a79871-d3aa-40e6-95c7-69432d6c3b37`, OAI-SearchBot / ChatGPT-User / PerplexityBot are
  `fullyBlocked: true, allowedPageRatio: 0`, and the card listed all three as reachers while findings on
  the **same screen** said each "can reach only 0% of your pages". The score (access 50% = 3 of 6
  retrieval bots) and the findings were correct; only the card was wrong.
  **Fix:** one `partitionRetrievalBots()` returning `{ canReach, blocked }`, rendered as two
  never-mixed groups on the result page **and** the public report, each blocked row stating its actual
  reach share.
- **H2.** Executive summary shipped "10 over-optimized anchor**ss**". The pluraliser appended `'s'` to
  `findingMeta(cat).label`, and that label is not uniformly a singular countable noun.
  **Fix:** explicit `countable: { one, other }` per category, plus an uncounted `siteWide` phrase for
  categories the engine emits once site-wide.
- **H3.** Collapsed AI finding rows showed a bare "Site-wide" — three identical rows on a real audit.
  **Fix:** `findingSummary()` combining the finding text with the target.

---

## 4. Gate history — and the two blockers I introduced

Every round is 3 independent reviewers (correctness / security / test-quality+deploy) on a frozen SHA in
isolated worktrees.

### Round 1 (on `52365e4`) — correctness **6**, security **7**, tests **6**, deploy **9**, 1 BLOCKING

**Blocker (mine).** `findingSummary` cut at the first `. `, which is abbreviation-blind. The engine's
`heading_structure` copy is *"This page skips heading levels (e.g. H1 → H3), which weakens the
machine-readable outline."* — the first `". "` is inside `"(e.g. "`, so the row rendered:

```
This page skips heading levels (e.g — Race Days
```

A broken fragment with an unclosed parenthesis, on the free result page, **strictly worse than the bare
label it replaced**. Reviewer-measured reach: **24 of the 100 rendered rows** on that audit, because
`heading_structure` is 364 of its 500 findings.

**Resolved in `d9ac01c`** by deleting the sentence-boundary logic entirely rather than adding an
abbreviation guard — bounding by length has no rule to get wrong, whereas a cleverer cut relocates the
next exception. Separator also moved from ` — ` to ` · ` because the engine's own copy contains em
dashes, which made the target read as a continuation.

Also fixed in that pass: the "note says the share" justification was **false** (`note` is a static
registry blurb, so 50% and 0% rendered identically — now both surfaces state the percent); the render
layer was unpinned on both surfaces; the copy test was tautological (read expectations from the table
under test, so `countable: { one: 'kumquat' }` shipped green); `js_rendered` / `generic_anchor_overuse`
counts were meaningless.

### Round 2 (on `d9ac01c`) — correctness **7**, security **7**, tests **8**, deploy **9**, 2 BLOCKING

Reviewer 3 confirmed **all six round-1 survivors now die**, and verified route classification by
manifest diff rather than inspection.

**Blocker A (mine, correctness).** `findingSummary` rendered `[88 chars of plainLanguage] · [60 chars of
scope]`. For page-level findings `plainLanguage` is generic **by design**, so the scope is the entire
distinguisher — and I head-truncated exactly that. Real sites share long prefixes:

```
.../collections/womens-running-shoes/products/aero-glide-{7,8,9}   → three byte-identical rows
"How to train for a marathon in twelve weeks — a complete guide, part {1,2,3}" → likewise
```

The exact symptom H3 exists to remove, reintroduced by the fix for it — and for url-only rows **worse
than before**, since the pre-fix code printed the whole url.
**Resolved in `b0b325a`:** the scope is now **middle-ellipsised**, keeping both ends, so `aero-glide-7`
and `part 3` survive. Pinned with those exact shapes asserting three distinct rows.

**Blocker B (mine, security/trust).** The scope sentence I *added in round 1's fix* read "training
crawlers are listed in the findings below" — a promise the page cannot keep. The client ledger is
severity-sorted and capped at `AI_CLIENT_MAX_FINDINGS = 100`, and `training_bot_blocked` is `info`.
Verified on audit `15a79871`: **5 high + 414 medium fill all 100 slots**, so zero info findings are
delivered and those crawlers appear nowhere. It was incomplete besides — opt-out tokens are neither
retrieval nor training and are on no surface at all (FU-12a).
**Resolved in `b0b325a`:** the line states scope and why it matters, and claims nothing about elsewhere.

Also fixed in that pass: `Math.round` rendered *"Blocked or restricted — reaches 100% of your pages"*
for a bot at 299/300 (now floored); `incomplete_crawl` was the **third** site-wide singleton and I'd
fixed only two — and my test asserted `"7 partial crawls"`, a string the engine can never produce, so it
*certified* the miss; the astral-boundary assertion was vacuous (both caps are even and emoji are 2
UTF-16 units, so a raw slice never splits — now run at odd offsets); the `hasOwnProperty` guard added in
round 1's fix had no test at all.

`9f3e250` then closed reviewer 3's residuals: an over-broad `/\w*ss\b/` regex, a test title that
overstated its assertion, and a determinism test written **honestly** — see §6.

### Current state: **round 3 has NOT been run.** That is the next action — see §5.

---

## 5. NEXT ACTION — owner-approved, with a required change of approach

Round 3 is approved, **but do not simply run another gate.** Owner ruling, verbatim in substance:

> Before round 3, break the loop that produced two self-inflicted regressions: **RENDER the actual
> hotfix output against the real production audit `15a79871-d3aa-40e6-95c7-69432d6c3b37` and inspect the
> rendered rows and copy directly**, on both the audit page and the public report. **Write copy against
> observed output, not against helper tests.**

Concretely:
1. Pull the real `ai_readiness` jsonb and `accessMatrix` for that audit from Supabase (read-only).
2. Render `AiReadinessSection` (result page) and `AiReadinessReportSection` (public report) with it.
3. **Read the actual rows and copy.** Both blockers above were invisible to helper tests and obvious the
   moment real data hit the real component.
4. Only then run the 3× gate on a fresh frozen SHA.

---

## 6. The failure pattern, stated plainly

**Each gate round found a blocker inside the fix for the previous round's blocker.** Round 1's fixes
introduced both of round 2's blockers. Both were in UI copy and layout.

The mechanism, consistently:

- I wrote and validated against **helper unit tests** with fixtures I invented. The helpers were correct
  in isolation every time.
- The defects lived in **the interaction between generic copy and real data shapes** — an abbreviation
  inside a template; a generic sentence whose distinguisher is the target; a severity cap that evicts
  the very findings a sentence points at. None is visible from a helper test, and all three were obvious
  within seconds of rendering real production data.
- Worse, several of my *tests* certified the bugs: `"7 partial crawls"` (unproducible), the even-parity
  astral vector, expectations read from the table under test, and an assertion checking the whole
  document when the string also appears in the expanded body.

**Remedy, now mandated:** render against production data **first**, write copy against observed output,
and only then write the tests that pin it. A test written before looking at real output tends to encode
the same assumption the code does.

Secondary lesson worth carrying: when a reviewer's claim contradicts your own, **verify it yourself
before acting**. In the SPEC 05 rounds a reviewer's "the clone is the quadratic term" was wrong and
nearly propagated into the docs; in this hotfix a reviewer's every claim checked out. Both were resolved
by measuring, not by deferring.

---

## 7. Environment gotchas that have cost real time

- **`nvm use 22` before any node/npx command.** System default is Node 20 and fails.
- **Gate worktrees symlink `node_modules` into `crawlmouse-spec05`.** So `apps/web/node_modules/@crawlmouse/*`
  resolves to *that* tree: mutating `packages/**` is invisible to `apps/web`/`inngest` runs and produces
  **false "SURVIVED"** verdicts. Use a temporary `resolve.alias` plus a positive control (an
  unconditional `throw`) to prove any harness is live before recording a survivor.
- **Never `git checkout --` to revert a mutation** — it has destroyed uncommitted work here. Use `cp`
  backups. Clear `node_modules/.vite` between mutation runs.
- **The crawled-text cut guard** (`apps/web/__tests__/crawled-text-cut-guard.test.ts`) is set-equal both
  ways: it fails on a **new** unclassified cut *and* on a **stale** entry whose code was deleted. It
  matches the literal source text, so an escape like `…` in source must appear escaped in the
  inventory entry.
- **`ai-view-logic.ts` is imported by a `'use client'` component**, so it must not import the engine
  barrel (that is the A9 defect). Use dependency-free code-point handling (`Array.from`) instead of the
  engine's `toPersistableText`.
- Standing rules: **no squash, full history, trace-audit before any push, never force-push `main`,
  migrations owner-applied only, no merge without owner go.**

---

## 8. FU-12 — logged, NOT fixed (owner ruling: log, do not widen this hotfix)

Full text in `docs/specs/05-follow-ups.md` under "FU-12". Summary with reproductions:

### 12b — **MOST SUBSTANTIVE. First item of the NEXT batch.**
The executive summary states per-category counts that `capFindings` (`report-snapshot.ts:61-72`) has
already truncated at `MAX_FINDINGS_PER_CATEGORY = 10`, and `report-content.ts` counts the capped array.
Verified in live `public_reports`: **justinjackson.ca (494 pages), ru.wikipedia.org, sellontube.com,
recurpay.com and mohammadalinijhoom.com all sit at exactly n=10** for `deep_page` and
`over_optimized_anchor`. Magnitude is pre-existing — the old copy printed the same 10 — **but this
hotfix applied the principle "grammatical and false is worse than ungrammatical and false" to the
site-wide UNIT and not to the CAP, in the same sentence, on a permanent artifact.** `orphan` is
correctly exempt (it uses the true `orphanCount`). Fix: say "at least N", or carry a pre-cap total the
way `totalFindings` already does.

### 12a — opt-out crawlers are on **no** surface at all
`Google-Extended` / `Applebot-Extended` are neither `retrieval` nor `training`, so they are excluded
from the access card *and* get no finding (`assemble.ts:189-193` has no branch for that class). On
racedays.run both are fully blocked and invisible everywhere. Pre-existing.

### 12c — `summarizeFindings` still tie-breaks with `localeCompare`
`report-content.ts:93`. `buildExecutiveSummary` was moved to code-unit ordering because the output is
frozen into a permanent report and collation is ICU-dependent; its sibling on the same `/r/` page was
not. No divergence is producible across the 9 shipped categories — latent, not live.

### 12d — `partitionRetrievalBots` ignores `fullyBlocked`
It reads only `allowedPageRatio`, so a drifted snapshot with `{ fullyBlocked: true, allowedPageRatio: 1 }`
would render as a reacher. Not engine-producible (`access-matrix.ts:31` keeps them consistent).

### 12e — `bots: [null]` throws on both surfaces
A null **element** passes `Array.isArray` then derefs `.botClass` → 500 on a permanent indexable page,
against the report component's own "degrade, not 500" contract. Pre-existing (the old helper threw
identically) and unreachable — `report-snapshot.ts:154` derefs `b.token` at mint and would throw first.
The result page has no guard on `score.accessMatrix.bots` at all — same pre-existing gap.

### 12f — dead copy for two categories the engine never emits as findings
`near_orphan` and `under_linked_important` exist only as projection-ledger fix categories, so their
`countable` entries — and the test rows pinning them — describe copy the engine cannot produce.

### 12g — `over_optimized_anchor` phrasing implies the wrong direction
"page with over-optimized anchor text" reads as the page's **outgoing** anchors; the engine measures
**inbound** anchor concentration on the target (`grade-inputs.ts:78`, `perTargetHHI`). Unit (pages) is
now correct; the preposition is still ambiguous.

---

## 9. Behaviour note the reader should know

`buildExecutiveSummary` runs at **render** time, so this hotfix changes what **already-minted** public
reports display — `"10 over-optimized anchorss"` becomes `"10 pages with over-optimized anchor text"` on
reports minted before it. **No `public_reports` row is mutated and no cached artifact is rewritten**, so
§5 minted-snapshot immutability holds. It is nonetheless a visible change to permanent artifacts and is
stated here so it is not mistaken for drift.

---

## 10. Related documents

- `docs/specs/05-follow-ups.md` — FU-1 … FU-12, the full logged backlog. **FU-10g is P1** (a pre-existing
  `js-detect.ts` crash: 22 KB of deeply-nested HTML hard-crashes any audit via an uncaught call at
  `audit.ts:147`; the §5 argument is pre-made there so the patch can ship fast).
- `docs/deploy/spec05-migration-runbook.md` — both migrations applied and verified; the
  `AI_READINESS_EXTRACTION` opt-out semantics and the "Preview is not a canary" correction.
- `evidence/ai-entity-scan-delta.md` + `scripts/measure-entity-delta.ts` — the reproducible entity-signal
  measurement.
- `evidence/grade-identity-spec05-hardening.md` — the grade-identity proof.
