# Grade & score neutrality — `Math.round` → `Math.floor` at `assemble.ts:201`

Evidence for owner condition (a) on the hotfix-01 round-3 blocker: *"prove score and grade neutrality —
`allowedPageRatio` and the AI score untouched, only the finding's display string changes."*

---

## 1. Why the A15 backtest is NOT the instrument here — read this first

The ruling asked for the A15 backtest with zero grade deltas. **A15 is structurally incapable of observing
this change, so running it would return "zero deltas" no matter what the change did.** That is a vacuous
gate, and vacuous gates are the exact class this hotfix series has been paying to eliminate — so it is
reported rather than banked.

- `scripts/backtest-engine.ts` and `scripts/backtest-diff.ts` contain **zero** references to
  `aiReadiness` / `ai_readiness` / `assemble` (`grep -c` → 0 in both). A15 crawls once and grades twice
  through **`analyzeCrawl`**, diffing the v1-vs-v2 **internal-linking** grade.
- `assembleAiReadiness` is not on that path. Its only production caller is `packages/engine/src/audit.ts:515`,
  which runs *after* and *beside* the linking analysis.

So the internal-linking grade is untouchable by this change **by construction**, and the AI-readiness score
needs a different proof. Both are given below.

## 2. Structural proof — `pct` cannot reach any scored value

Every occurrence of the variable in `packages/engine/src/analysis/ai-readiness/assemble.ts`:

```
201:    const pct = Math.floor(b.allowedPageRatio * 100);
203:      ... `${b.operator}'s ${b.token} can reach only ${pct}% of your pages — blocking a search/…`
205:      ... `${b.operator}'s ${b.token} (${b.botClass}) can reach ${pct}% of your pages. Blocking a …`
```

Three occurrences: one declaration, two template literals producing `plainLanguage`. Nothing reads `pct`
into a score, a component, a band, or the matrix. `allowedPageRatio` and `accessSubscore` are computed in
`buildAccessMatrix` (`access-matrix.ts`) from the **unrounded** ratio and are never recomputed here.

## 3. Differential proof — the same assembler, both rules, real shapes

Ran `assembleAiReadiness` over **1381** distinct site shapes (`total` 1…200 pages × blocked ∈ {0, 1, 2,
⌊n/3⌋, ⌊n/2⌋, n−1, n}), driving a real parsed `robots.txt` that disallows a prefix for `OAI-SearchBot`
only — i.e. the ratio is produced by the real robots evaluation, not injected. Captured under the shipped
`Math.floor`, then re-captured with the source mutated back to `Math.round`, and diffed:

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

## 4. What the change fixes

`Math.round` only ever ran for `allowedPageRatio < 1` (the `continue` above it), so it could render a
**restricted** bot as reaching **100%** — self-contradictory alone, and in direct conflict with the result
page's access card, which floors. Measured before the fix: the two disagreed on **1258 of 2406** ordinary
`(pages, disallowed-paths)` pairs — one `Disallow:` rule matching one crawled path on a 400-page site is
enough. Flooring can only understate reach, which is the safe direction for a restriction warning.

Not reachable on any audit in production today: **every** stored `allowedPageRatio` is exactly 0 or 1, which
is why three review rounds and a render-against-production pass all missed it, and why only a property
test over the ratio range could catch it.

## 5. Regression pin

`apps/web/components/ai/reach-percent-agreement.property.test.tsx` — a fast-check property that drives the
real engine assembler and the real `AiReadinessSection`, extracts **both** percentages from the rendered
HTML, and asserts they are equal across the ratio range. Mutation-verified: reverting `assemble.ts` to
`Math.round` fails it; changing the card to round fails it plus two sibling cases.

## 6. Immutability

`buildExecutiveSummary` and this finding text are produced at **render** time from stored data, but the
stored `plainLanguage` of an already-minted `/r/` report is frozen in `public_reports.report_snapshot` and
is **not** rewritten. Existing reports keep the text they were minted with; only audits crawled after this
ships carry the corrected string.

## 7. The durable fix

Two independent computations of one number is the actual defect class — logged as **FU-12k**: the engine
should emit the display percentage once and the card should read it.
