# AI surfaces: raw JSX children 500 the permanent report, and three guards are unpinned

**Status:** open · **Priority:** next batch, alongside FU-12k (same files)
**Found by:** hotfix-01 gate rounds 3 and 4 (security + test-quality lenses). **Deliberately not fixed in
hotfix-01** — owner ruled scope fixed at H1/H2/H3, and widening at gate stage is what made that hotfix run
four rounds.

## 1. Raw JSX children 500 a permanent, indexable page

A non-string value renders as `Objects are not valid as a React child` → permanent 500 on `/r/<slug>`,
against that component's own "degrade, not 500" contract.

| value | `AiReadinessReportSection` | `AiReadinessSection` |
|---|---|---|
| object `operator` / `token` | THROWS (`:155-156`, `:172-173`) | THROWS (`:102`, `:122`) |
| object `plainLanguage` | THROWS (`:122`) | THROWS (`:167`) |
| object `llmsTxt.note` | THROWS (`:192`) | THROWS (`:148`) |
| object `wafNote` | THROWS (`:188`) | THROWS (`:139`) |
| object `targetUrl` | ok (`safeDecodeUrlForDisplay`) | THROWS (`:176`) |

`report-snapshot.ts:154-159` copies `token`/`operator`/`botClass`/`allowedPageRatio`/`fullyBlocked` verbatim —
only `note` is clamped — so there is **no mint-time backstop** for these. Hotfix-01 widened the surface: base
rendered only the *blocked* group, the new "Can reach your pages" group renders the same pattern for **all**
retrieval bots.

Reachability is low — `operator`/`token`/`note` come from the static `AI_BOT_REGISTRY`
(`constants.ts:232-247`), and `toPersistableText()` always returns a string — so this needs DB drift or a
future engine change. **Fix the class:** `String(...)` at every verbatim child on both surfaces, and add the
AI section to the guard matrix. Hotfix-01 added `String(f.targetTitle)` at one site and left the siblings —
the `fix-the-class-not-the-instance` lesson recurring.

## 2. The audit page degrades worse than the report it was hardened alongside

`AiReadinessReportSection` guards with `ai.accessMatrix?.bots`, `Array.isArray(...)`, `ai.findings ?? []`.
`AiReadinessSection` has no equivalent, and its header comment claims the same tolerance the report actually
implements. All six of these throw on the audit page and render fine on the report: missing `bots`, non-array
`bots`, null `findings`, non-array `findings`, null `llmsTxt`, missing `accessMatrix`. Lower severity (not
indexed, recoverable by re-audit) but the comment is a false promise.

## 3. Three guards have no killing test

Confirmed by mutation against the full 1318-test suite:

- **`pct === null` guard**, BOTH surfaces (`AiReadinessSection.tsx:124`, `AiReadinessReportSection.tsx:174`).
  Removing it renders the literal `— reaches null% of your pages` on the permanent report. The one test that
  renders the drifted bot (`access-card.test.tsx`, `allowedPageRatio: undefined`) asserts only that the token
  appears, which passes with `null%` on screen.
- **The empty-state condition**, BOTH surfaces (`:132`, `:182`). Flipping `&&` to `||` survives. Under it, the
  common no-robots.txt case (all bots reach, none blocked) renders *"No AI retrieval crawler data is available
  for this site."* directly beneath a populated reach list — the self-contradicting card H1 exists to remove.
  Every fixture in both files renders at least one blocked bot, so the shape is untested.
- **`boundScope`'s tail-only / ellipsis-marker / trim behaviours** (`ai-view-logic.ts:193-199`) and
  `boundChars`' marker + `trimEnd` (`:166-169`) are killed **only** by `crawled-text-cut-guard.test.ts`, which
  matches literal source text. Proven live: update the inventory string alongside the mutation and the whole
  suite is green. Nothing behavioural asserts a truncated string is *marked* as truncated. The `0.55` head/tail
  split has no coverage at all, and both bound constants survive ±1 in either direction.

## Related
FU-12k (same files, same batch), FU-12h/i/j, and `2026-07-31-url-display-superlinear-decode.md`.
