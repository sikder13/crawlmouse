# SPEC 5.1a Stage 3b — stall economics (Direction 2), and the banking-determinism answer

**Recorded:** 2026-08-03 · branch `engine/spec-5-1a`
**Follows:** `evidence/2026-08-03-stage3b-batch-bounding.md` §5 (the blocker this addresses)
**Ruling:** Direction 2 first, measured alone. The banking-determinism question outranks the fix.

---

## 1. What was built

A navigation timeout is a **verdict, not a throttle**, so the retry is suppressed:
`markNoRetryOnTimeout` sets `request.noRetry` from the `politeCrawl` `errorHandler`, reusing the layer
Stage 1 built for robots refusals.

**The matcher was measured, not assumed** — and the obvious implementation would have matched nothing.
Crawlee's timeout arrives as:

```
ctor=TimeoutError  name=Error  code=undefined  msg="request timed out after 1 seconds."
```

`name` is `'Error'`, so matching on `err.name === 'TimeoutError'` is silently vacuous. Crawlee does not
export its `TimeoutError` (checked), and an `instanceof` against a transitively-installed copy is the
exact check that failed for the robots refusal — so the match is on `constructor.name`, which is still a
CLASS rather than prose, plus `code === 'ETIMEDOUT'` for got's own timeout. A torn-down request arrives
as `RequestError` / `ECONNRESET` ("socket hang up") and deliberately does **not** match: that is our own
teardown, and a connection reset is transient in a way a timeout is not.

Scoped to the v2 `politeCrawl` path only — v1 is pinned byte-identical by several tests and is the
backtest's base engine, so changing its retry economics would move the axis the panel is measured
against.

## 2. Tests — `packages/engine/src/crawl-stall-retries.test.ts`

Stalling paths sort BEFORE the fast ones (`/a-stall-*` vs `/z-fast-*`), so §6.2's literal top-level
strata put them first in the selection order and the retry budget is spent before the fast pages are
reached. That is the info.cern.ch shape.

**A first draft of the retry-count test PASSED ON THE BROKEN WIRING**, and the reason is worth
recording: under the 9s budget the other two tests use, the deadline fired before any retry was
attempted, so a count of one meant "we ran out of time", not "we declined to repeat ourselves". The
budget had to be raised until the retries could actually happen. A vacuous pass, caught only because
the RED baseline was run before the fix.

| test | RED on the retrying wiring |
|---|---|
| spends ONE request on a stalled URL | `attempts for /a-stall-0: expected 4 to be 1` |
| still RECORDS a timed-out URL as a failed fetch | `expected [] to have a length of 8` |
| reaches the pages BEHIND the stalled ones, inside the budget | `budgetExhausted: expected true to be false` |

### Mutation verification

Liveness proven first (unconditional `throw` in `markNoRetryOnTimeout` → all three red in 1.2 s).

| mutation | killed by | result |
|---|---|---|
| stop recording failed fetches (`failedRequestHandler`) | *still RECORDS a timed-out URL…* **only** | 1 failed / 2 passed |
| drop the `constructor.name` branch, keep `name`/`ETIMEDOUT` | **all three** | red |

The first is the discriminating one: it proves the mandated recording is pinned **independently** of
the retry suppression, so "not retrying" cannot silently become "not reporting". The second proves the
constructor-name branch is load-bearing — `name === 'TimeoutError'` and `ETIMEDOUT` alone match nothing
here, which is the measured claim in §1 turned into a test result.

Engine suite: **59 files / 764 tests green.**

## 3. Live measurement — Direction 2 alone, `info.cern.ch`, pageCap 500, budget 120 s

| | before D2 | after D2 |
|---|---|---|
| round 4 | `batch=25 fetched=0 took=113.7s` | `batch=25 **fetched=4** took=112.1s` |
| pages | 25 (ok=24) | **29** (ok=24, **recordedDead=4**) |
| crawl-health block rate | **0 %** | **14 %** |
| grade / composition | A−/88.79, 123→24 | A−/88.79, 123→24 |

**The honest reading: Direction 2 bought HONESTY, not COVERAGE.**

- **What it fixed.** Four URLs now reach a terminal outcome and are **recorded as failed fetches**
  where previously they vanished mid-retry. The crawl-health block rate goes 0 % → 14 %: the crawl now
  says "an eighth of what we attempted did not answer" instead of quietly reporting a clean 24-page
  read. That is precisely the evidence Stage 4's coverage accounting is built on, and it did not exist
  before.
- **What it did not fix.** Still 123 → 24 pages, identical grade. The arithmetic says why: the retry
  suppression cuts the cost of a dead URL from 150 s to 30 s, but **30 s is still enormous against a
  120 s budget**. A round of ~25 dead URLs costs ~25 × 30 / concurrency ≈ 150–375 s — more than the
  whole prod budget of 240 s. Only 4 of 25 could be retired in 112 s.

## 4. THE DEEPER FINDING — is the BANKED set deterministic? **No.**

Measured against a fixed local corpus (61 pages, one literal top-level stratum each, so the selection
order is decided by the URLs) with **per-URL latency that is a property of the URL** (20–419 ms).

**Instrument proven first:** with a budget large enough to finish, 3 runs produced **1 distinct banked
set, symmetric difference 0**. The measurement can detect equality, so a difference below means a real
difference.

| variant | distinct banked sets (of 5) | banked sizes | symmetric difference | `selected` |
|---|---|---|---|---|
| control — budget completes | **1** | 61 ×5 | 0 | 61 |
| fixed latency, conc 4, budget 2000 ms | 1 | 20 ×5 | 0 | 26 (stable) |
| fixed latency, conc 4, budget 2500 ms | **2** | 21, 22, 22, 21, 21 | 1 | 26 (stable) |
| fixed latency, **conc 1**, budget 2500 ms | **3** | 11, 11, 13, 12, 12 | 2 | 26 (stable) |
| **jittered** latency, conc 4, budget 2500 ms | **3** | 21, 27, 21, 30, 21 | **9** | **26 or 51** |

**Stated plainly, as instructed: determinism is guaranteed for SELECTION and NOT for BANKING.**

Three things follow from the numbers rather than from argument:

1. **It is the clock, not concurrency.** The serial (conc 1) run varies too — 3 distinct sets. So this
   cannot be engineered away by serialising; a wall-clock cut lands wherever ordinary scheduling noise
   puts it.
2. **`selected` is stable while `banked` is not.** In every fixed-latency variant `selected = 26` on all
   five runs. Selection is exactly as pure as §6.6 claims; the variance enters strictly *after* it.
3. **Under jitter the ROUND COUNT itself moves** (`selected` 26 vs 51 — one run completed an entire
   extra round). So the variance is not confined to "which N of the final batch"; it is "which N of the
   final batch, where the number of completed batches is itself latency-dependent."

### The magnitude, stated honestly

The incumbent's composition variance was **which 500 of ~7 000 discovered URLs** — E1: duskroute.com,
ten runs, every one at exactly 500 pages, F/32.88 → A−/88.89. A 56-point, six-letter swing with the
page count held constant.

After stratification the variance is **bounded by roughly one batch** — 25 pages, or **5 % of a
500-page sample** — because selection is fixed and only the interrupted round's completions can move.
In the measurements above the largest symmetric difference was 9 pages, within that bound even in the
run that completed an extra round.

**That is an order-of-magnitude improvement, not perfection**, and the bound is empirical rather than
proved: a host whose latency varies enough to change *several* round boundaries could exceed one batch.
The §6.7 fingerprint is what keeps this visible instead of hidden — `digest` + `selectedCount` name the
selected set exactly, so "the site changed", "we sampled differently" and "we banked differently" stay
three distinguishable statements. This belongs in the product's methodology, not just here.

**A correction to my own Stage 3b work.** The test committed in `f38f83c` was named *"banks the same
set on every run of the same corpus, seed and budget"*, which reads as a general guarantee it does not
have. It holds only because that fixture is engineered so completion ORDER cannot matter (instant pages,
a 30 s stall against a 5 s budget, so the deadline never lands near a page boundary). It has been
renamed and its comment now says so.

## 5. Direction 1 — recommendation: **still needed, and now the binding constraint**

**Recommend proceeding with Direction 1.** The evidence:

- One round consumed **112.1 s of a 120 s budget and returned 4 pages, all of them dead.** Every round
  is still handed the entire remaining budget, so one unlucky round ends the crawl.
- The cost is **per URL, not per batch**: ~`NAVIGATION_TIMEOUT_SECS` per dead URL. Bounding the batch
  cannot bound it, and Direction 2 only divided it by five.
- **Shrinking `FRONTIER_BATCH_SIZE` is not a substitute.** To cap a round at ~30 s at concurrency 2 the
  batch would have to be ~2, which means ~250 `crawler.run()` restarts at a 500-page cap. A round wall
  clock is the right lever precisely because it **decouples round SIZE from round TIME** — the one
  cannot bound the other.
- The pool held **111 unfetched URLs** when the crawl ended. Those are different strata, some of them
  presumably fast. A bounded round would let the loop re-select and spend the remaining ~80 s on them
  instead of on one stalled draw. That expectation is a **prediction and should be measured**, not
  believed — the prediction record on this branch is poor.

Suggested shape, for a ruling rather than for implementation: hand each round
`min(remainingMs, FRONTIER_ROUND_BUDGET_MS)`, and on a round-level expiry **continue the loop** instead
of ending the crawl (the crawl still ends on the global deadline). A constant round budget is exactly as
deterministic as a constant batch size — and per §4 it changes nothing about banking determinism, which
is already latency-dependent.

## 6. Carry into Stage 4 — two things that must not be lost

### 6.1 A higher page count is NOT better coverage

**The incumbent's 123 pages were not 123 representative pages — they were 123 FAST pages.**
Level-sorted truncation drains alphabetically-early URLs and never selected the slow corners at all. The
stratified frontier selects them on purpose. So **"123 vs 24" compares two different things**, and the
comparison flatters the incumbent for a reason that has nothing to do with coverage quality.

**Stage 4's coverage accounting must therefore never treat a higher page count as better coverage.**
That is the E1 non-monotonicity in another costume: E1 was exactly a case where the page count was held
constant at 500 while the grade swung 56 points, because *composition*, not *count*, decides what a
crawl means. A count-based coverage metric would reintroduce the same error one layer up — and would
score the honest crawl worse than the flattering one.

### 6.2 Known residual: latency is a systematic sampling bias against slow sections

**Not corrected in 5.1a, by instruction. Recorded with its mechanism so it is not rediscovered as a
surprise.**

Slow sections cost more budget per page than fast ones. Under a fixed wall-clock budget, a page's
probability of being banked therefore falls with its server's response time — so the sample is biased
*against* slow sections of a site even after stratified selection makes the *selection* unbiased.
Stratification fixes which URLs are offered; it cannot fix which of them the clock allows to finish.

Concretely: on info.cern.ch the stratified selector chose 50 URLs across 115 strata and banked the fast
ones. The slow strata are systematically under-represented in the result, and nothing in the current
design corrects for it. Any future coverage-quality claim must be read with that bias in mind, and any
correction (per-stratum time budgets, latency-weighted accounting) is post-5.1a work.

## 7. Reproduce

```bash
nvm use 22
cd packages/engine && pnpm vitest run src/crawl-stall-retries.test.ts

pnpm backtest -- --mode=ab --base-engine=$PWD/../crawlmouse-base/packages/engine/src/index.ts \
  --urls=http://info.cern.ch --pageCap=500 --budget-ms=120000
```

The §3 round trace came from a temporary `process.stderr.write` after the `runWithWallClock` call in
`runDeterministicLevels`, with a throwaway driver calling `crawlForAudit`. The §4 table came from a
throwaway script serving a fixed 61-page loopback corpus with per-URL delays, run 5× per variant.
Neither is committed; both are described here in enough detail to rebuild.
