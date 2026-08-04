# SPEC 5.1a Stage 3b — batch bounding: what it fixed, and the blocker it uncovered

**Recorded:** 2026-08-03 · branch `engine/spec-5-1a`
**Fixes:** `evidence/2026-08-03-stage3b-frontier-throughput-blocker.md` (the open blocker)
**Status: the ruled fix is IMPLEMENTED and PROVEN. The symptom that motivated it is NOT resolved —
a second, independent defect is reported in §5 and has not been touched.**

---

## 1. What was ruled, and what was built

Owner ruling: a **CONSTANT** per-round batch in `constants.ts` with a comment stating why it is
constant; bank progress between rounds; re-select from the remaining frontier each round.

- `FRONTIER_BATCH_SIZE = 25` (`packages/engine/src/constants.ts`). The comment states both halves:
  why a bound exists, and why it is a constant rather than derived from observed throughput — a
  throughput-derived batch makes composition a function of latency, so timing would decide when the
  budget stops and therefore which URLs are eligible next round. That is the §6 nondeterminism
  reintroduced one layer down.
- `runDeterministicLevels` now takes `Math.min(pageCap - admitted.length, FRONTIER_BATCH_SIZE)` per
  round. Everything else in the loop was already correct: it re-selects from the remaining pool each
  round, and rounds that complete are already banked.

The change is one line plus its rationale. That is the whole fix.

## 2. The fixture that closes the gap in my own fixture

`packages/engine/src/crawl-frontier-batch-bounding.test.ts`.

`crawl-frontier-budget.test.ts` could not catch this: it answers every request instantly, so its
batch always completes and the wall clock never fires part-way through one.

The new fixture is a loopback host where **one page never answers** and the budget (5 s) sits far
below the 30 s navigation timeout and far above what the instant pages need — so the deadline lands
in a wide dead zone and what gets banked is decided by **order, not rate**. Every child is a
top-level path, so §6.2 keeps each key literal, each child is its own stratum, and round-robin makes
the selection order exactly `/p00, /p01, …` — decided by the URLs, not by a hash and not by a clock.

**RED on the 3b.1 wiring, for the predicted reason:**

```
AssertionError: expected 54 to be less than or equal to 25
```

`selected = 60`, `banked = 6` (the homepage plus `/p00`–`/p04`): **54 URLs deleted from the pool,
marked visited and charged against the page cap without ever being read.** That is the
`selected=161` vs 24 discrepancy from the blocker, reproduced in a fixture.

### Mutation verification

Harness liveness proven first (an unconditional `throw` in `runDeterministicLevels` → **both** tests
red in 1.2 s), because a mutation reported as "survived" through a broken filter has cost this
project a round before. `cp` from a saved copy was used to restore, never `git checkout --`.

| # | mutation | killed by | result |
|---|---|---|---|
| liveness | unconditional `throw` in `runDeterministicLevels` | both tests | red |
| M1 | restore the unbounded batch (`pageCap - admitted.length`) | *does not consume URLs it never fetched beyond a single bounded batch* | `expected 54 to be less than or equal to 25` |
| M2 | batch size not a pure function of the discovered set (`1 + random·BATCH`) | *banks the same set on every run of the same corpus, seed and budget* | digest `ebcaa84…` ≠ `fe58814…` |

The pair is **discriminating, not redundant**: M1 survives the determinism pin (an unbounded batch is
still perfectly deterministic — which is exactly why no test noticed the original defect), and M2
survives the bound pin (a random-but-bounded batch still bounds the gap). Each defect has exactly one
test that can see it.

## 3. Live confirmation that the fix does what it was ruled to do

Same command as the blocker, same host, same budget, with the loop instrumented per round:

```
ROUND batch=1  fetched=1  took=0.5s    hitBudget=false  pool=0   admitted=1
ROUND batch=1  fetched=1  took=0.4s    hitBudget=false  pool=0   admitted=2
ROUND batch=23 fetched=23 took=5.3s    hitBudget=false  pool=0   admitted=25
ROUND batch=25 fetched=0  took=113.7s  hitBudget=true   pool=111 admitted=50
TOTAL pages=25 ok=24 budgetExhausted=true elapsed=122.2s
FINGERPRINT discovered=161 selected=50 strata=115
```

| | before (3b.1) | after |
|---|---|---|
| `selected` | 161 | **50** |
| pages banked | 24 | 24 |
| URLs consumed but never read | **137** | **25 — exactly one batch** |
| URLs left in the pool | 0 | **111** |

The accounting defect is closed and the bound holds exactly at `FRONTIER_BATCH_SIZE`. The §6.7
fingerprint now describes the crawl instead of overstating it by 5.6×, which matters directly for
Stage 4: `selectedCount` is an input to the coverage story we are about to make honest.

## 4. Full-panel effect

`pnpm backtest --mode=ab`, base `origin/main` vs head, pageCap 500, budget 120 s:

| URL | base | head | Δ | composition |
|---|---|---|---|---|
| info.cern.ch | A−/87.04 | A−/88.79 | +1.75 | 123 → 24 pages |

Unchanged from the pre-fix panel, to two decimal places — as §5 explains.

Engine suite: **58 files / 761 tests green** (was 57 / 759). `tsc --noEmit` clean.

## 5. BLOCKER — reported, not fixed: one dead URL can cost more than the whole crawl budget

**Per the standing rule, this is reported before it is touched.** It is not inside the batch-bounding
fix; the fix uncovered it by removing the noise that was hiding it.

**`info.cern.ch` is still 123 → 24 pages.** Bounding the batch did not move it, and the round trace
says why:

> **Round 4 ran 25 URLs for 113.7 seconds and banked ZERO pages.**

A 25-URL round stalls exactly as completely as a 136-URL round did, so batch size was never the
mechanism behind the coverage loss — only behind the over-counting.

**The mechanism, from the numbers.** `fetched=0` counts additions to the pages map, and
`failedRequestHandler` adds a page (status 0) when a request finally dies. **Zero additions in 113.7 s
therefore means not one of the 25 URLs reached a terminal outcome — not a success, and not even a
recorded failure.** With `NAVIGATION_TIMEOUT_SECS = 30` and `MAX_REQUEST_RETRIES = 4` under
`politeCrawl`, one stalled URL needs up to **30 × 5 = 150 s** before it is declared dead. That single
number exceeds this crawl's entire 120 s budget, and at AIMD's start concurrency of 2 a round can
retire at most a couple of URLs in that time.

**So: the per-URL stall ceiling (150 s) is larger than the whole crawl budget (120 s here, 240 s in
prod), and each round is handed the entire remaining budget.** A round that draws two stalled URLs
consumes everything left and returns nothing. Bounding the batch bounds the *loss*; it cannot bound
the *time*.

**Why base does not hit it, which is the uncomfortable part.** Base reaches 123 pages because
level-sorted truncation drains alphabetically-early URLs and never selects these paths at all. The
stratified frontier spreads across 115 strata and therefore *deliberately visits the slow corners of
the site the incumbent skipped*. On this host that is representativeness working as designed and
being punished by the stall economics. This is a trade the owner should rule on explicitly, not a
bug to be tuned away quietly.

### Directions, for a ruling — none implemented

1. **Bound how long one round may block** (`min(remainingMs, ROUND_BUDGET)`), and let the loop
   continue to the next round instead of ending the crawl. Converts "one stalled round kills the
   crawl" into "one stalled round costs one round". A constant round budget is as deterministic as a
   constant batch size; *which* rounds complete still depends on latency, exactly as it does today.
2. **Stop retrying stalls.** A navigation timeout is not a transient throttle, and retrying it four
   times spends 150 s to learn what the first 30 s already established. Stage 1 already built the
   mechanism for "do not repeat a decision that cannot change" (`request.noRetry` from
   `errorHandler`, matched by walking `error.cause`) for robots refusals; timeout-class errors are
   the same shape.
3. Lowering `NAVIGATION_TIMEOUT_SECS` is **not** proposed — it is pinned deliberately by SPEC 01 §5.

(1) and (2) are independent and compose. (2) looks like the larger win for the smaller change, but
that is a prediction, and this branch's record on predictions is poor — it should be measured before
it is believed.

## 6. What this fix does and does not claim

- **Does:** bound to one round the URLs a wall-clock stop can consume without reading; keep the
  remaining frontier in the pool; make `fingerprint.selectedCount` describe the crawl; keep every
  round boundary a pure function of the discovered set.
- **Does not:** recover pages on a slow host. It is not a throughput fix and was never ruled to be
  one. §5 is the throughput blocker, unaddressed.
- **Costs:** at pageCap 500 the crawl now makes ~20 `crawler.run()` calls instead of a handful, and
  Crawlee rebuilds its autoscaled pool on each. On the loopback fixtures this is unmeasurable
  (`crawl-frontier-budget.test.ts` runs in 1.2 s, unchanged) and on the live panel it is invisible
  beside §5, but it is a real cost and the reason the constant is 25 rather than something small.

## 7. Reproduce

```bash
nvm use 22
# the fixture (RED on the unbounded batch, green here)
cd packages/engine && pnpm vitest run src/crawl-frontier-batch-bounding.test.ts

# the live panel
pnpm backtest -- --mode=ab --base-engine=$PWD/../crawlmouse-base/packages/engine/src/index.ts \
  --urls=http://info.cern.ch --pageCap=500 --budget-ms=120000
```

The per-round trace in §3 and §5 came from a temporary `process.stderr.write` after the
`runWithWallClock` call in `runDeterministicLevels`, plus a throwaway driver calling `crawlForAudit`
with `{ engineV2: true, maxCrawlMsForTesting: 120000 }`. Both were removed; neither is committed.
