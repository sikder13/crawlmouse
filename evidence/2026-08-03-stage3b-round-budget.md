# SPEC 5.1a Stage 3b — the round clock (Direction 1), and the banking re-measurement

**Recorded:** 2026-08-03 · branch `engine/spec-5-1a`
**Follows:** `evidence/2026-08-03-stage3b-stall-economics.md` §5 (where Direction 1 was recommended)
**Conditions on the ruling:** measure `info.cern.ch` before claiming a win; re-measure banking
determinism rather than inheriting the previous magnitude.

---

## 1. What was built

`FRONTIER_ROUND_BUDGET_MS = 30_000`, a constant with the same why-it-is-constant discipline as
`FRONTIER_BATCH_SIZE`. Each round is handed `min(remainingMs, FRONTIER_ROUND_BUDGET_MS)`. **A round
expiry ends the ROUND, not the crawl** — the loop re-selects from the remaining frontier and continues;
only the global wall clock ends the crawl. `politeCrawl` only, because only that path stops gracefully:
on the throw-on-budget path a round expiry would surface as a crawl failure.

A round expiry sets `truncated`, which is returned as `budgetExhausted`. Continuing past a stranded
round must not let the result look complete — the round's URLs were consumed and never read.

### A genuine Crawlee discovery, found by execution

The round-budget fixture failed on its first run with:

```
This crawler instance is already running, you can add more requests to it via `crawler.addRequests()`.
```

**`crawler.teardown()` does not clear Crawlee's internal `running` flag.** That only happens when the
pending `run()` promise settles, so calling `run()` again first throws. This was invisible before —
harmless while a budget stop ended the whole crawl, fatal the moment a round stop is followed by another
round. The fix is to await the abandoned run (settled both ways, so it can never reject) before
returning. It is pinned by mutation M9: removing the await drops the crawl to the homepage alone.

Measured consequence, and the second unknown answered: each round-expiry test completes in ~2.1 s
against a 2 s round budget and a 5 s navigation timeout — so **teardown does abort in-flight requests
promptly.** The round clock is effective, not merely nominal.

## 2. Tests — `packages/engine/src/crawl-round-budget.test.ts`

Exactly one batch worth of stalling paths, sorted first (`/a-stall-NN` vs `/z-fast-N`), so the whole
stalled set lands in the first child round and the fast pages in the round after it. On the previous
wiring that first round is handed the entire remaining budget, burns it, and a whole section of the site
is never requested.

### Mutation verification (liveness proven first: unconditional throw → all three red)

| mutation | killed by | note |
|---|---|---|
| revert the round clock (round gets the whole remaining budget) | tests 1 and 3 | test 2 survives correctly — the global clock still truncates |
| a round expiry ends the crawl | tests 1 and 3 | test 2 survives correctly |
| stranded round no longer marks the crawl truncated | **test 2 only** | isolates the honesty flag from the mechanism |
| **drop the await on the abandoned run** | tests 1 and 3 | pins the Crawlee reuse discovery above |

Engine suite: **60 files / 767 tests green.**

## 3. Live measurement — `info.cern.ch`, pageCap 500, budget 120 s

**The prediction held.** Round trace:

```
ROUND batch=1  fetched=1  took=0.5s   roundExpired=false
ROUND batch=1  fetched=1  took=0.3s   roundExpired=false
ROUND batch=23 fetched=23 took=6.6s   roundExpired=false
ROUND batch=25 fetched=0  took=30.0s  roundExpired=true   pool=111   ← previously ended the crawl
ROUND batch=25 fetched=25 took=7.9s   roundExpired=false             ← the recovery
ROUND batch=25 fetched=4  took=30.0s  roundExpired=true
ROUND batch=25 fetched=25 took=6.8s   roundExpired=false
ROUND batch=25 fetched=25 took=7.2s   roundExpired=false
ROUND batch=25 fetched=25 took=7.6s   roundExpired=false
ROUND batch=25 fetched=0  took=23.1s  roundExpired=true
TOTAL pages=129 ok=100 selected=200 discovered=370 strata=231
```

Three rounds expired; six banked in full. Exactly the predicted mechanism: the loop re-selects and
spends the remaining budget on the 111 URLs that were sitting unfetched in the pool.

| | before D1 | after D1 | base (`origin/main`) |
|---|---|---|---|
| pages fetched OK | 24 | **99–100** | 123 |
| discovered | 161 | **370** | — |
| strata | 115 | **231** | — |
| coverage estimate | 15 % | **27 %** | — |
| grade | A−/88.79 | **B+/81.39** | A−/87.04 |
| Δ vs base | +1.75 | **−5.65** | — |

## 4. §10 GATE — |Δscore| > 5, explained

The panel flags `🚩 explain (sample moved)`. The explanation, and it is the good kind:

**Stage 3b round clock. The crawl now reaches the site's slow, deep sections**, which neither the
incumbent (level-sorted truncation never *selected* them) nor the pre-round-clock head (it never had
*time* to fetch them) had seen. Composition moved −61/+37 against base; the new findings are
`deep_page:+4` — literally the deep pages that were previously invisible. Selection is unchanged in
kind; what changed is that the budget now reaches further into the frontier.

**This is the clearest single validation of the stratified frontier so far, and it is worth stating as
the thesis rather than as a caveat: BETTER COVERAGE PRODUCED A WORSE GRADE.** The old A−/88.79 was 24
*fast* pages. Ninety-nine pages including the slow corners give B+/81.39, and B+ is the honest answer —
the site's deep pages really are poorly linked. Every previous panel result on this branch moved *up*,
and the handoff recorded that "the panel lacks the shape that should fall". This is that shape. It is
the E1 non-monotonicity being corrected rather than exploited: a sampler that scores a site higher for
reaching less of it is the defect, and this is the defect being paid back.

## 5. REGRESSION, reported not fixed: the round clock cancels Direction 2's honesty gain

| | after D2 | after D1 |
|---|---|---|
| crawl-health block rate | **14 %** | **0 %** |
| URLs recorded as dead | 4 | **0** |

**`FRONTIER_ROUND_BUDGET_MS` (30 s) equals `NAVIGATION_TIMEOUT_SECS` (30 s), so the two race and the
round clock wins.** A stalled URL is torn down by the round expiry at exactly the moment it would
otherwise have timed out and been recorded as a failed fetch. Direction 2's measured win — dead paths
becoming visible evidence instead of vanishing mid-retry — is undone by Direction 1 in the case where
both apply.

The effect on the product is that the block rate now **understates** how much of the host did not
answer, and Stage 4's refusal triggers read exactly those counts (`fetchedOk`, block rate). This is
therefore a Stage 4 calibration hazard, not a cosmetic one.

**Not fixed here**, per the standing rule and the instruction not to iterate a third mechanism. The
obvious remedy is a constant relationship rather than a coincidence — a round budget strictly greater
than one navigation timeout, so a stalled request can always reach its terminal outcome and be recorded
before its round is cut. That is a one-value change and it wants a ruling, not a guess, because it
trades round-clock tightness against evidence completeness.

## 6. THE MANDATED RE-MEASUREMENT — banking determinism after the round clock

### The first attempt was confounded, and saying so is the point

An initial re-run used a 500 ms round budget on the old 60-page corpus and appeared to show variance
*shrinking*. **The instrument control refuted it:** with a 60 s budget — enough to finish several times
over — the crawl still reported `banked=19 of 61, exhausted=true`. Every round was expiring. The round
clock was not reducing variance, it was reducing the **sample**, and a smaller sample has less room to
vary. Reporting that as an improvement would have been a false claim built on a broken fixture.

The corpus was rebuilt to the **production shape**: 200 pages, most fast enough that a round finishes
well inside the round budget (~0.4 s against 2 s), plus one contiguous slow section whose round cannot
fit — which is what `info.cern.ch` actually looks like (healthy rounds ~7 s, slow rounds expiring at
30 s).

**Instrument proven first:** fast-only corpus, generous budget, round clock active → 3 runs,
`banked=201/201`, `exhausted=false`, **1 distinct set, symmetric difference 0.** The measurement detects
equality, and the round clock does not fire on healthy rounds.

### Results — 5 runs per configuration

| corpus | conc | round clock | distinct sets | banked sizes | symmetric difference |
|---|---|---|---|---|---|
| fixed | 4 | **ON** | **3 / 5** | 153, 155, 158, 158, 158 | **5** |
| fixed | 4 | off | 1 / 5 | 54 ×5 | 0 |
| fixed | **1** | **ON** | **4 / 5** | 52, 55, 56, 58, 58 | **6** |
| fixed | **1** | off | 1 / 5 | 52 ×5 | 0 |
| jitter | 4 | **ON** | **5 / 5** | 151, 156, 158, 157, 160 | **9** |
| jitter | 4 | off | 2 / 5 | 53, 53, 54, 54, 54 | 1 |

### **VARIANCE GREW. Stated plainly, as instructed.**

Distinct banked sets rose from 1/5 to 3/5 (fixed, conc 4), 1/5 to 4/5 (serial) and 2/5 to 5/5 (jitter).
Pages differing rose from 0–1 to **5–9**. Adding round boundaries added places where a clock decides
eligibility, exactly as predicted.

**But the comparison arm is not what it looks like, and the honest reading matters more than the
headline.** With the round clock off the crawl banks ~54 pages; with it on, ~158. The off arm is
reproducible **because it dies on the same slow section every single run** — determinism by not trying.
It is the defect, reproducing itself faithfully. Trading that for a crawl that reaches three times as
much of the site at 5–9 pages of variance is the right trade, but it must be reported as a trade.

As a fraction of the sample: **0 % → 3.2 %** (fixed, conc 4) and **1.9 % → 5.6 %** (jitter).

### What this does to the promise

The **"roughly one batch" bound survives**: the largest difference measured is 9 pages against
`FRONTIER_BATCH_SIZE = 25`. So the claim in `docs/METHODOLOGY.md` stands — *bounded in practice by
roughly one batch, about 5 % of a 500-page crawl, empirical rather than proved* — but it is now
supported by measurements taken **with** the round clock rather than inherited from measurements taken
without it, and the accompanying text says that variance grew and why.

The serial result is worth keeping in view: **conc 1 has MORE distinct sets than conc 4** (4/5 vs 3/5).
Concurrency is not the mechanism and this cannot be serialised away.

## 7. Reproduce

```bash
nvm use 22
cd packages/engine && pnpm vitest run src/crawl-round-budget.test.ts

pnpm backtest -- --mode=ab --base-engine=$PWD/../crawlmouse-base/packages/engine/src/index.ts \
  --urls=http://info.cern.ch --pageCap=500 --budget-ms=120000
```

The §3 round trace came from a temporary `process.stderr.write` after the `runWithWallClock` call in
`runDeterministicLevels`, with a throwaway driver calling `crawlForAudit`. The §6 table came from a
throwaway script serving a 200-page loopback corpus — per-URL latency a function of the URL, one
contiguous slow section from `/p050`, `frontierRoundBudgetMsForTesting` toggling the round clock — run
5× per configuration. Neither is committed; both are described in enough detail to rebuild.
