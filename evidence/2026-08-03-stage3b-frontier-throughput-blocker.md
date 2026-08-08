# SPEC 5.1a Stage 3b — BLOCKER inside the frontier wiring, reported before fixing

**Recorded:** 2026-08-03 · branch `engine/spec-5-1a` · commit under investigation: `594ba57`
**Status: BLOCKER. Reported, not fixed**, per the standing rule — a defect found inside my own prior
fix gets reported before it is patched, because that pattern cost SPEC 05 four extra rounds and the
remedy is to change approach rather than iterate.

---

## 1. What the live measurement showed

`--mode=ab`, base `origin/main` vs head, pageCap 500, 120 s budget:

| URL | base | head | Δ | composition |
|---|---|---|---|---|
| racedays.run | B+/80.32 | B+/80.68 | +0.36 | 419 → **499** pages |
| defaultoffice.com | B−/70.61 | B−/70.61 | +0.00 | 15 → 15 identical |
| quotes.toscrape.com | B/76.09 | B/79.31 | +3.22 | 214 → 214 identical |
| **info.cern.ch** | A−/87.04 | A−/88.79 | +1.75 | **123 → 24 pages** |

Three rows are healthy — `racedays.run` even *gained* 80 pages, which is the budget being spent
better. **`info.cern.ch` lost 99 of 123 pages.** A score that rises while the crawl reaches a fifth as
much of the site is not an improvement; it is the coverage problem this spec exists to fix, arriving
from the other direction.

## 2. Reproduced, not inferred

Same site, same 120 s budget, each engine run directly:

```
HEAD:  pages=25  ok=24   budgetExhausted=true  elapsed=122.7s
       fingerprint: discovered=161  selected=161  strata=115
BASE:  pages=144 ok=123  budgetExhausted=true  elapsed=122.7s
```

**The fingerprint is what identified it.** `selected=161` against 24 pages actually fetched says the
selector admitted 161 URLs and the crawl banked almost none of them — a discrepancy invisible without
the §6.7 instrument, and exactly the class of question it was built to answer.

## 3. Root cause, measured per round

Instrumented the batch loop (probe reverted afterwards), 60 s budget:

```
ROUND batch=1    fetched=1    took=0.5s    hitBudget=false
ROUND batch=1    fetched=1    took=0.4s    hitBudget=false
ROUND batch=23   fetched=23   took=7.2s    hitBudget=false     (~3 pages/s)
ROUND batch=136  fetched=0    took=51.9s   hitBudget=true      ← 52 s, ZERO pages banked
```

**The defect is the unbounded batch.** `runDeterministicLevels` now selects up to the entire remaining
budget and hands that whole set to a single `runWithWallClock` call. On a slow host the wall clock
fires part-way through, `runWithWallClock` tears the crawler down, and the loop returns immediately —
so everything still in flight or queued in that batch is discarded. Fifty-two seconds of crawl budget
produced nothing.

The incumbent's level-by-level structure was accidentally protective here: its batches were bounded by
the width of one BFS level, so it made small commitments and **banked progress between deadline
checks**. Replacing it with one large commitment removed that property without anyone noticing,
because the loop is still perfectly deterministic — it just reaches less.

Two aggravating factors, both consistent with the numbers but not yet isolated:

- `info.cern.ch` is a 1990s server with many slow or hanging paths. At `navigationTimeoutSecs` 30 and
  `MAX_REQUEST_RETRIES` 4 under `politeCrawl`, a batch full of hangs blocks its slots for a long time.
- Crawlee recreates the autoscaled pool on every `run()`, so AIMD concurrency resets to its start
  value (2) each round. With few, large rounds there are fewer opportunities to ramp.

## 4. Why this is a blocker and not a tuning note

The stratified selection itself is sound — `racedays.run` gained 80 pages and the M5 fixture passes.
The defect is in **how the selection is handed to the crawler**, which is my own 3b.1 wiring, and it
regresses coverage on exactly the class of site (slow, deep, partial) where SPEC 5.1's honesty claims
matter most. `info.cern.ch` had `low` confidence and 15 % coverage at 24 pages; shipping this would
make the "we reached X of an estimated Y pages" story worse while the score went up.

## 5. Proposed direction — for approval, not yet implemented

Bound the batch so the crawl makes incremental, bankable progress and re-selects between batches:

1. **Cap the per-round batch** at a constant (e.g. `FRONTIER_BATCH_SIZE`), independent of the remaining
   budget. Selection stays stratified and pure — it is applied to the same pool, just taken a bounded
   slice at a time — so §6.6 determinism is unaffected and the M5 fixture should stay green.
2. **Bank progress between rounds.** Because each round is small, a wall-clock stop discards at most
   one bounded batch instead of the entire remainder.
3. **Re-select each round** from the updated pool, which is already what the loop does. A smaller batch
   also means newly discovered strata enter the rotation sooner rather than after one giant commitment.

Open question worth a decision rather than a guess: whether the batch cap should be a constant or
derived from observed throughput. A throughput-derived value would adapt to slow hosts but would make
batch composition depend on timing — and while that does not change *which* URLs are eligible, it does
change *when* the budget stops, which is already the one place live determinism cannot be guaranteed. A
constant is the conservative choice and I would default to it.

## 6. What is unaffected

- The selector and its B6 gate (`analysis/frontier.test.ts`) — pure, and untouched by this.
- The M5 budget-truncated crawl fixture — passes; its fixture is a fast loopback server, so it never
  exercises the stall. **That is a gap in the fixture, and worth fixing alongside**: a slow-host variant
  would have caught this before the live panel did.
- Stage 1 and Stage 2, which are independent of the frontier wiring.
- `racedays.run`, `defaultoffice.com` and `quotes.toscrape.com`, all of which behaved correctly.

## 7. Reproduce

```bash
pnpm backtest -- --mode=ab --base-engine=$PWD/../crawlmouse-base/packages/engine/src/index.ts \
  --urls=http://info.cern.ch --pageCap=500 --budget-ms=120000
```
