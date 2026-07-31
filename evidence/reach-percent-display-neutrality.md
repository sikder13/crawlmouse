# Grade & score neutrality — the reach-percentage display rule at `assemble.ts:201`

> **STATUS (round 5): the `Math.floor` change this document was written for was REVERTED.** Flooring a
> binary double understates an exact percentage — `Math.floor(0.29 * 100)` is 28, not 29, at 40 count-pairs
> up to 1000 pages (20 inside the crawl cap) — so the engine and the card both **round**, as main always did.
> The neutrality measurements below stand unchanged and are what matter: they show the display rule, whichever
> it is, moves no score, band, component or ratio. FU-12k replaces both computations with one exact
> integer-math percentage.

Evidence for owner condition (a) on the hotfix-01 round-3 blocker: *"prove score and grade neutrality —
`allowedPageRatio` and the AI score untouched, only the finding's display string changes."*

---

## 1. Why the A15 backtest is NOT the instrument here — read this first

The ruling asked for the A15 backtest with zero grade deltas. **A15 is structurally incapable of observing
this change, so running it would return "zero deltas" no matter what the change did.** That is a vacuous
gate, and vacuous gates are the exact class this hotfix series has been paying to eliminate — so it is
reported rather than banked.

> **CORRECTION (round 4).** An earlier version of this section said *"`assembleAiReadiness` is not on that
> path."* **That was false.** `packages/engine/src/audit.ts:515` sits INSIDE `analyzeCrawl` (declared at
> `audit.ts:297`, closing at `:551`), and the harness calls `analyzeCrawl` at `scripts/backtest-engine.ts:123-124`
> — so the assembler **executes on every backtested audit**. The corrected reasoning is below; the
> conclusion is unchanged, but the stated reason was wrong and would have told the next person extending
> `diffAudit` that the assembler is not on the harness at all.

- A15 crawls once and grades twice through **`analyzeCrawl`**, diffing the v1-vs-v2 **internal-linking** grade.
  `assembleAiReadiness` **runs** inside that call.
- But A15 cannot **observe** it: `diffAudit` consumes only `score`, `grade` and `countFindings(v*.findings)`
  (`backtest-engine.ts:125-128`, `backtest-diff.ts:22-46`), and `result.findings` is the **linking** array —
  `result.aiReadiness.findings` is never read. `scripts/backtest-engine.ts` and `scripts/backtest-diff.ts`
  contain zero references to `aiReadiness` / `ai_readiness` / `assemble` (`grep -c` → 0 in both).

So this is an **observability gap in the gate**, not an execution impossibility — and the difference matters
if anyone extends `diffAudit`. The internal-linking grade is untouchable by this change because nothing on
that path reads the display string; the AI-readiness score needs the separate proof given below.

## 2. Structural proof — `pct` cannot reach any scored value

Every occurrence of the variable in `packages/engine/src/analysis/ai-readiness/assemble.ts`:

```
201:    const pct = Math.round(b.allowedPageRatio * 100);
203:      ... `${b.operator}'s ${b.token} can reach only ${pct}% of your pages — blocking a search/…`
205:      ... `${b.operator}'s ${b.token} (${b.botClass}) can reach ${pct}% of your pages. Blocking a …`
```

Note `:203` and `:205` are **two** consumers of one variable, so the rule applies to the retrieval and the
training finding alike. Only the retrieval string is pinned by test; the training path is a known coverage
gap, carried into FU-12k.

Three occurrences: one declaration, two template literals producing `plainLanguage`. Nothing reads `pct`
into a score, a component, a band, or the matrix. `allowedPageRatio` and `accessSubscore` are computed in
`buildAccessMatrix` (`access-matrix.ts`) from the **unrounded** ratio and are never recomputed here.

## 3. Differential proof — the same assembler, both rules, real shapes

Ran `assembleAiReadiness` over **1381** distinct site shapes (`total` 1…200 pages × blocked ∈ {0, 1, 2,
⌊n/3⌋, ⌊n/2⌋, n−1, n}), driving a real parsed `robots.txt` that disallows a prefix for `OAI-SearchBot`
only — i.e. the ratio is produced by the real robots evaluation, not injected. Captured under `Math.floor`,
then re-captured under `Math.round`, and diffed. **This is the load-bearing result and it is rule-agnostic:**
it shows that whichever display rule ships, nothing scored moves.

| field | deltas across 1381 assemblies |
|---|---|
| `score` | **0** |
| `band` | **0** |
| `components` (all four, incl. weights) | **0** |
| `accessMatrix` (incl. every `allowedPageRatio`, `fullyBlocked`) | **0** |
| finding **kinds** emitted | **0** |
| `totalFindings` | **0** |
| bot finding **display text** | **465** ← the only thing that moves |

465 of 1381 shapes change their display string, which is the population the blocker affected; nothing
scored moves in any of them.

## 4. What actually shipped, and why not floor

The defect being fixed was never the rounding rule — it was that the engine and the card used **different**
rules, so a restricted bot rendered "reaches 99%" on the card and "can reach only 100%" in a finding six
lines below, on one screen and on the permanent report. Measured: they disagreed on **1258 of 2406** ordinary
`(pages, disallowed-paths)` pairs.

Flooring both sides made them agree and was **wrong**: `allowedPageRatio` is a binary double, so
`Math.floor(0.29 * 100)` is 28 when the truth is 29 — **40** `(allowed, total)` pairs up to 1000 pages
understate by a full point, **20** inside the 500-page cap. Rounding is accidentally correct at every one, so
both sides round, matching main.

**Residual, accepted:** a bot at ratio in [0.995, 1) reads "reaches 100% of your pages" under the "Blocked or
restricted" heading. Odd but true. On main this exists only in the finding text (the card carries no
percentage), so it is new on the card — the price of not printing a false number. FU-12k retires it by
computing the percentage once from the integer counts and flooring **that**, which is exact.

> **CORRECTION (round 4) — an earlier version of this section claimed the region is "not reachable on any
> audit in production today", generalising from a five-row corpus.** Only **5** audits carry `ai_readiness`
> at all; three have no restrictive robots and two are our own canaries. "Every stored ratio is 0 or 1" is a
> fact about that corpus, not a property of the world — the same over-generalisation that let three review
> rounds miss the original blocker.
>
> The region is reachable by ordinary means: **sitemap seeds bypass the crawler's robots filter.**
> `crawler.ts:274-281` applies `isAllowedByRobots` to *enqueued links* only, while `audit.ts:207-239` passes
> sitemap URLs straight into `startUrls` unchecked — so any sitemap-listed path that robots disallows enters
> `pages` and drops every bot below 1. Measured with `Disallow: /search` + `Disallow: /cart` over 419 pages:
> all 14 bots at ratio 0.98807. (That crawler/sitemap gap is pre-existing and out of scope here; it is cited
> only as the reachability proof.)

## 5. Regression pins

- `apps/web/components/ai/reach-percent-agreement.property.test.tsx` — a fast-check property driving the real
  assembler and the real `AiReadinessSection`, extracting **both** percentages from rendered HTML and
  asserting they are equal. **It asserts AGREEMENT, not CORRECTNESS**, and cannot see an error the two sides
  make together — which is exactly how it passed green while both floored `0.29 * 100` to 28. Stated in the
  file itself so it is not mistaken for coverage it cannot give.
- The truth assertions live in the two unit pins — `assemble.test.ts` and `ai-view-logic.test.ts` — against
  **hand-computed** values (29/100 → 29, 57/100 → 57, 87/150 → 58, 290/500 → 58), each paired with an
  assertion that `Math.floor` is wrong at that pair, never against the other side's output.

Mutation-verified in both directions: engine → floor fails the engine pin; card → floor fails the card pin
and both property cases.

## 6. Immutability

> **CORRECTION (round 4).** An earlier version said the finding text is "produced at **render** time".
> It is not. Only `buildExecutiveSummary` is render-time; the bot finding's `plainLanguage` is produced at
> **crawl** time by the engine and frozen — into `audits.ai_readiness`, and again into
> `public_reports.report_snapshot` at mint.

The consequence the original wording hid: the access card **recomputes** the percentage at render from the
frozen `allowedPageRatio`, while the frozen finding text keeps whatever the engine wrote. So a report minted
with a fractional ratio can render a card percentage beside a finding percentage computed under a *different*
rule — permanently, on an immutable artifact, which is the exact incoherence this work exists to remove.

Checked against production: **46 public reports, 2 carry `aiReadiness`, and every restricted retrieval bot in
them is at `ratio = 0`** (where every rounding rule agrees). Across all 5 audits with AI data, zero fractional
ratios. The window closed with zero instances — by luck, not by design. FU-12k's frozen-snapshot rule makes it
deliberate: legacy snapshots (no persisted percentage) fall back to **rounding**, matching their frozen text,
because an immutable artifact must prioritise internal coherence over retroactive correctness; new audits
persist an exactly-computed percentage at mint.

## 7. The durable fix

Two independent computations of one number is the actual defect class — logged as **FU-12k**: the engine
should emit the display percentage once and the card should read it.
