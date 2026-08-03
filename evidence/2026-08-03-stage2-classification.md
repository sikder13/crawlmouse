# SPEC 5.1a Stage 2 (§5) — page classification: gate evidence

**Recorded:** 2026-08-03 · branch `engine/spec-5-1a` · base `origin/main` = `69b039f`
**[GRADE-CHANGING]** — the delta is reported here, not approved. Approval is §10, in 5.1b.

---

## 1. What shipped

Classification is layered cheapest-first; a page is `content` only if every layer passes, and every
layer records **why** (an exclusion whose cause the user cannot see is indistinguishable from a bug).

| Layer | Rule |
|---|---|
| §5.1 URL rules | 7 ordered rules on **path-segment equality**, first match wins |
| §5.1 CMS overlay | `getAdjustments(cms)` consulted **through** the classifier, not beside it (M8) |
| §5.2 directives | `noindex` from meta robots **or** the `X-Robots-Tag` header |
| §5.3 thin | `mainTextChars < MIN_GRADEABLE_TEXT_CHARS` (80) |
| §5.4 duplicate | 64-bit SimHash, Hamming k=3, representative by canonical URL ASC |

### M9 — the population and the graph are different sets

Owner-ruled, and both halves pull opposite ways:

- excluded pages leave the gradeable **population** — numerator *and* denominator of the orphan, depth
  and anchor statistics;
- excluded pages **stay in the graph** — in-degree, BFS depth and PageRank run over every node.

Drop archives from the graph and a post reachable only through one becomes a false orphan, which is the
defect this spec exists to remove. Leave status stubs in the denominator and a junk-diluted site reads
as well-linked. Both mandated fixtures are pinned, plus the **counterfactual**: the same article *is*
reported as a false orphan when the archive is removed from the graph, so the test shows what the
ruling buys rather than only that the ruling was implemented.

## 2. The grade delta, measured

Panel chosen deliberately: the four sites Stage 1 proved have **stable crawl composition**. That makes
every delta attributable to classification and nothing else — on a site whose sample wanders, an ab
delta cannot be attributed at all (Stage 1 §4).

| URL | base | head | Δ | composition | finding deltas |
|---|---|---|---|---|---|
| racedays.run | B+/80.32 | B+/81.58 | **+1.26** | 419→419 identical | orphan −1, over_optimized_anchor −33 |
| defaultoffice.com | B−/70.61 | B−/70.61 | **+0.00** | 15→15 identical | — |
| quotes.toscrape.com | B/76.09 | B/79.31 | **+3.22** | 214→214 identical | deep_page −35, over_optimized_anchor −168 |
| info.cern.ch | A−/87.04 | A−/87.39 | **+0.35** | 123→123 identical | over_optimized_anchor −9 |

**No letter changed. No delta exceeded ±5. Three of four moved on an identical sample**, which is the
only kind of movement that needs no crawl caveat.

### I predicted this would go DOWN. It went up, and the mechanism matters

Stage 0 argued that shrinking the denominator would make grades **fall** on junk-diluted sites. On this
panel they rose modestly. The finding deltas say why: the dominant effect was not the denominator, it
was the **numerator** — 168 `over_optimized_anchor` and 35 `deep_page` findings on `quotes.toscrape.com`
disappeared, because they were findings *about tag-archive pages*. Those were never advice anyone could
act on; removing them is the honesty improvement, and the score rise is a side effect of it.

**Stated plainly so it is not over-read:** the direction is site-shape-dependent, and this panel does not
contain the shape that should move down. A site with 400 status stubs and 40 real pages — M9 fixture (b),
and the E5 shape from production — has its ratio go from 1/9 to 1/3, and its grade falls. That case is
pinned by unit fixture, not by a live site, because no such site is in the panel. **Do not read "+1 to +3
on four sites" as "classification raises grades".** It raises them where the excluded pages were
generating junk findings, and lowers them where excluded pages were padding the denominator.

## 3. Gate criteria

| Criterion | Status |
|---|---|
| Every rule fixture-pinned | ✅ each rule ships a `sample` it alone must claim and a `counterSample` that must stay content; a test asserts both for every rule, so a shadowed rule fails loudly |
| E5 URLs classify correctly | ✅ `/cp/auth/login` → auth, `/tweets/{id}` → status |
| Contact page and short-but-real article stay content | ✅ pinned at the 80-char boundary, and a degraded extraction keeps the page rather than assuming thinness |
| SimHash determinism pinned | ✅ against an **independently reimplemented** value, not its own output |
| Grade delta measured and reported | ✅ above — reported, not approved |
| Full suite green | ✅ engine 53 files / 713 tests, web 197, inngest 8, scripts 2 |

## 4. Measured finding: k=3 is only meaningful at document length

`k=3` is calibrated for web-scale documents. Measured on this implementation, a one-word edit scores:

| tokens | 10 | 20 | 40 | 80 | 160+ |
|---|---|---|---|---|---|
| distance | 12–13 | 7–12 | 5–10 | 1–4 | 0–2 |

Below ~100 tokens the distance is dominated by how few shingles exist rather than by how similar the
documents are, so a k=3 verdict there means nothing. `simhashForDedup` therefore returns null below 100
tokens and such pages are **never collapsed** — the conservative direction: failing to collapse a
duplicate costs a little accounting, while wrongly collapsing two real pages deletes one from the graph
and manufactures the very orphan we exist to detect. Pinned by test so nobody later "fixes" short text
by loosening k.

## 5. Two pre-existing fixtures were given real body text — flagged, not done quietly

`audit.test.ts` and `reproducibility.test.ts` serve pages with a literally empty `<body>`, which the thin
gate now correctly classifies `thin`, silencing the orphan findings those tests assert. Their subject is
inbound links and BFS depth, not text volume, so adding body text **restores their intent** rather than
accommodating the change. Recorded here because editing a pre-existing test to make one's own change
pass is exactly the move that needs to be visible.

## 6. Mutation verification

Liveness proven first (unconditional throw → 9 failed). `cp` backups throughout, never `git checkout --`.

| # | Mutation | Result |
|---|---|---|
| M13 | denominator reverts to `graph.order` (population split undone) | killed by 3 tests |
| M14 | depth **result** filtered to gradeable | **SURVIVED** — see below |
| M14b | BFS **walks** the gradeable subgraph (the real mutation) | killed by 2 tests |
| M15 | duplicate representative picked by arrival order | killed |
| M16 | in-degree taken over the gradeable subgraph | killed by fixture (a) |

**M14 surviving was a real finding about my own test, not a false alarm.** Filtering the depth *result*
leaves every gradeable page's depth correct, so nothing asserted changed — the mutation did not exercise
the claim. M14b mutates the **walk**, which is what "stays in the graph" actually means, and fixture (a)
kills it immediately. Recorded because a surviving mutation that gets waved away is how false coverage
enters, and the fix was to write a sharper mutation rather than to accept the first result.

## 7. Verification

`pnpm test` 5/5 · `pnpm typecheck` after the final commit · `pnpm lint` clean · `next build` passes.
One pre-existing guard satisfied rather than suppressed: three new char-index cuts inventoried in
`crawled-text-cut-guard`.

## 8. Reproduce

```bash
pnpm backtest -- --mode=ab --base-engine=$PWD/../crawlmouse-base/packages/engine/src/index.ts \
  --urls=https://racedays.run/,https://defaultoffice.com/,https://quotes.toscrape.com/,https://info.cern.ch \
  --pageCap=500 --budget-ms=120000 --out=evidence/backtest-stage2-classification.md
```
