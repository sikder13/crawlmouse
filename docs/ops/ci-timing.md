# CI timing checks and the flake register

A red X on a timing check has to mean the code got slower. This file is the rule timing checks
follow, what each kind of check lets through, how to run the strict job yourself, how to read the
nightly trend, and a dated register of the timing failures found to be noise.

## The rule

**Unit suites** (`pnpm test`). A timing assertion goes through `@crawlmouse/timing`
(`packages/timing/src/budget.ts`):

- `expectWithinBudget(name, fn, { budgetMs, setup })` runs `fn` `WARMUP_RUNS` (1) time, then
  `TIMING_RUNS` (5) times, and fails unless the **median** of the five is under the limit. It stops
  once three runs are over the limit, since the median is then over it. Its `values` start with the
  warm-up's, so a test can check the cold call. `setup`, when given, builds each run's input off the
  clock, so a cache keyed on the input object does not turn the measured runs into hits.
- **The default suite reads CPU time and the strict job reads the clock.** Wall-clock measures the
  machine; CPU time measures the code. In the default suite (`pnpm test`, the PR jobs) each run is
  timed by `process.cpuUsage()`, user plus system, and the limit is `DEFAULT_CEILING_FACTOR` (3)
  times the budget. Under `PERF_STRICT=1` each run is timed by the wall clock and the limit is the
  budget itself, because the budget is a promise about how long a reader waits. The reason is
  measured: with every package's suite running at once beside other work (a load average of 41 on
  12 cores), the 2,000-node layout read 6.7 s to 52.6 s on the wall clock against about 2 s on a
  quiet machine. CPU time does not count the time spent waiting for a core, though it does rise
  when cores are shared: about 1.3 s idle to 3.3 s beside twelve CPU busy loops for the same
  layout (the mutation proofs below).
- `process.cpuUsage()` counts every thread of the process, so `clockFor` refuses CPU time inside a
  worker thread. The engine and worker suites run in vitest's default `forks` pool, one test file at
  a time per process.
- `expectWithinRelative(name, { measured, reference }, { limit, rule })` times the two sides in turn,
  five pairs after a warm-up of each, on the same clock, and compares the medians. It has no ceiling
  factor, and records the measured side's samples. Its `setup` builds a fresh input for each side
  of every pair, off the clock, as `expectWithinBudget`'s does.
- A failure message names the clock, and lists every sample and the warm-up. With
  `PERF_SAMPLES_DIR` set, every budget check appends its samples to `samples.jsonl` there, pass or
  fail.

**Visual performance budgets** (`tests/visual/perf.spec.ts`, budgets in `tests/visual/budgets.ts`).
Each window is measured `RUNS` (5) times and each budget is judged on the median of its five
readings. The checks that say a run measured anything (a main thread and tasks in the trace, enough
frames, the phone window spanning its moment) must hold on every run. The planted-long-task control
runs once.

**The visual job on a PR** (`.github/workflows/ci.yml`, shard 1). A runner probe times a fixed CPU
workload (`packages/timing/src/probe.ts`), then `packages/timing/scripts/perf-retry.sh` runs the
budgets and decides what a failure means. Attempt 1 is classified before anything is retried:

| attempt 1         | attempt 2 (`--last-failed`) | runner probe   | outcome                      | job  |
| ----------------- | --------------------------- | -------------- | ---------------------------- | ---- |
| pass              | not run                     | any            | passed                       | pass |
| fail, other       | not run                     | any            | failed: not a budget failure | fail |
| fail, budget only | pass                        | any            | flaky: passed on retry       | pass |
| fail, budget only | fail                        | normal/unknown | failed: reproduced           | fail |
| fail, budget only | fail, other                 | slow           | failed: reproduced           | fail |
| fail, budget only | fail, budget only           | slow           | inconclusive: slow runner    | pass |

"Slow" means the probe's median is over `SLOW_RUNNER_FACTOR` (1.5) times `PROBE_REFERENCE_MS`.
"Budget only" means one reported error per failed test, every one the budget assertion's own
(`Error: medians of 5 runs`, which only a budget test raises). The script asks it of attempt 1
before it retries, and of attempt 2 before an inconclusive pass. Errors
are read with colour codes stripped (Playwright's workers print with `FORCE_COLOR=1`), from the
lines that start with an error's name (`Error:`, `TypeError:`, `TimeoutError:`,
`Error [ERR_...]:`, ...) or with `Test timeout of`. A failed test whose error is not the budget
assertion fails the job on any runner, alone or beside a budget miss, and in attempt 1 it fails
it without a retry: a failed control, a server
that did not start, a failure that names no test, a test timeout, a thrown error, or another
assertion inside a budget test, such as one marked `MEASUREMENT INVALID` (the checks that a run
measured anything) or the explorer's canvas not rendering. A second error inside a test that
already missed its budget fails it too when it starts one of those lines; one that does not (a
thrown value that is not an `Error`) is not read. Each attempt's `[perf]` lines go to the job summary. A flaky or
inconclusive outcome writes a warning annotation and a register row (below). It is the one step
the workflow retries (`grep -n "perf-retry\|--last-failed\|retries" .github/workflows/*.yml` finds
it and the baselines step, which re-draws screenshots and asserts nothing); production checks run
in their own step, without a retry. Because attempt 1 must be budget only, the retry re-runs
budget tests and nothing else: a failed control, an invalid measurement, a timeout or a thrown
error is never given a second attempt. `packages/timing/src/perf-retry.test.ts` runs the script
against stand-in commands for each row; its "attempt 1 is classified before any retry" block plans
a pass for attempt 2 after each non-budget failure, so a script that retried them would exit 0.

**The strict nightly job** (`.github/workflows/nightly.yml`, `perf-strict`). Every absolute budget
at its real threshold: the unit budgets under `PERF_STRICT=1`, one test file at a time, then the
visual budgets on the production build. The same median-of-five rule, with no retry and no
slow-runner pass. It uploads the samples as the `perf-samples` artifact; `perf-trend` writes the
trend into the job summary.

## What a PR can let through, and why

- **A unit regression whose CPU-time median lands between its budget and three times it passes the
  PR suite.** The strict nightly job fails on it. On a loaded machine the ceiling is stricter, not
  looser: shared cores raise CPU time too (the mutation proofs below have the numbers).
- **A visual regression that shows only on slow runners passes the PR as "inconclusive".** It is
  caught by the strict nightly job, not per PR. The trade: #49 failed on a runner where all three of
  its samples were slow, and passed when the job was re-run with no change, and a check that fails whenever
  GitHub hands out a slow machine teaches reviewers to re-run red jobs. On a runner the probe rates
  normal, a reproduced failure still fails the PR.
- **A function that blocks without working passes the PR suite.** CPU time does not count a
  synchronous wait (`Atomics.wait`, a blocking read): in review, a 2,000 ms wait put in
  `computePageAiSignals`, eight times its budget, passed the default suite and failed the strict one
  (2,006 ms against 250 ms).
- **A historical regression can sit close to the ceiling.** With the noscript scan's cap removed
  (the `683ef5b` fix undone), the review read a CPU-time median of 3,270 ms against that check's
  3,000 ms ceiling on one workstation: red by 9%, so a faster runner could pass it per PR. The
  strict job read 3,251 ms against 1,000 ms. The llms.txt ReDoS, undone the same way, read 109,374 ms
  against 1,500 ms.
- **A cache keyed on a value, not an object, still hides a cold path.** `setup` gives each run (or
  each pair, in a relative check) a new input object; the robots and llms.txt checks take a string, and a memo keyed on an equal string
  still hits.
- **A budget regression that fails about half the time can pass as "flaky: passed on retry".**
  The retry cannot tell a marginal regression from noise; it is only offered when every failure in
  attempt 1 was a budget assertion. The row it writes goes into the register, where a
  reviewer reads it, and the strict nightly holds the budget.
- **The nightly runs after merge.** A regression the PR let through is reported the next morning,
  against the last seven nightlies, not before it merges.

## Running the strict job locally

```bash
pnpm perf:strict
```

Runs each workspace package's `*.test.ts` and `*.test.tsx` files that import `@crawlmouse/timing`
directly with `PERF_STRICT=1`, one file at a time (`packages/timing/scripts/run-strict.sh`;
`--list` prints them). A test that reaches the helper only through another file of its own is not
found, so import it in the test file. Add `PERF_SAMPLES_DIR=/some/dir` to keep the
samples. On a busy machine a strict run can fail on noise; that is what the default ceiling is for,
so read a strict failure on a quiet machine.

The visual budgets need the production build:

```bash
cd apps/web && set -a && . ./.env.ci && set +a && pnpm exec next build
VISUAL_PERF=1 VISUAL_SERVER=start pnpm exec playwright test -c ../../tests/visual/playwright.config.ts perf.spec.ts --workers=1
```

## `pnpm test` on a busy machine

Three things keep a busy machine from failing `pnpm test` on noise:

- **CPU time** for every helper check (above): a thread waiting for a core does not advance it.
  In the mutation runs below, the unmutated case of each converted check passed beside twelve CPU
  busy loops.
- **Two package suites at a time.** The root `test` script is `turbo run test --concurrency=2`.
  Turbo's default runs every package's suite at once, each with its own pool of workers. CI is
  unchanged: each package has its own job and runs its script through `pnpm --filter`, which does
  not go through turbo. The nightly's `pnpm test` step takes the cap. The cost, measured with
  `turbo run test --force --continue` on the 12-core workstation, which other sessions kept busy,
  so it was not quiet (a one-minute load average of 13.7 to 15.4 at the starts and ends of the two
  runs, and five-minute averages of 23.7 to 29.9): 683 s at the default concurrency
  (three packages failed: an engine and a web test past vitest's 5 s timeout, and the worker load
  test's event-loop bound below), against 625 s at concurrency 2, with every package passing.
- **The two crawl fixtures wait on timers, so CPU time does not help them, and they run in a
  vitest run of their own.** `crawl-stall-retries` (a 22 s crawl budget, 1 s navigation timeouts)
  and `crawl-round-budget` (2 s rounds, a 12 s crawl, 5 s navigation timeouts) keep their budgets.
  The deep-chain audit check (the inventory below) joined them by a later ruling.
  The engine's `test` script runs the rest of the engine suite with these files left out, then
  `test:timers` runs them one after the other (`--no-file-parallelism`), so no other engine file
  shares the machine with them. A failure in either run fails `test`. Arguments to `test`
  (`pnpm --filter @crawlmouse/engine test -- <filter>`) go to the main run; the serial run always
  runs all of its files. `packages/engine/src/test-timers-split.test.ts` runs in the serial run, named
  on its command line (vitest picks the order; with no results cache it runs the largest file first), so an edit that narrows the main run cannot deselect it, and the PR's
  `test (engine)` job runs it. It runs the `test` line with a stand-in vitest. It pins the
  two vitest command lines the line runs, that those exact command lines select every engine test
  file once between them (read with the real `vitest list`), the exit status for each pair of run
  results, and where appended arguments go. Taking the guard off the serial line would switch it off, and
  nothing can see that from inside it; that edit is to the line it pins. So would excluding the
  guard alone in `vitest.config.ts`. A config edit that leaves the serial run no file fails it,
  because the serial line sets `--passWithNoTests=false` (the engine config passes with none).
  - _Why not a longer navigation timeout._ Before this split, stall-retries' first test failed
    inside the capped suite having reached no stalled path, which a 1 s timeout expiring on the
    fixture's own home page would explain. Raising it to 5 s was tried first, at `611f487`, with
    the file run alone, and two of its three tests failed: "still RECORDS a timed-out URL as a
    failed fetch" recorded 5 of the 8 stalled paths inside the 22 s budget, and "reaches the pages
    BEHIND the stalled ones" ended with the budget exhausted. The first test, with 60 s, took 35.2 s
    to give its 8 stalled paths one request each, about 4.4 s a path, so at 5 s a path the 22 s
    budget does not reach all 8. The same 5 of 8 came back in both of the author's runs (the first at a one-minute load
    average of 2) and in review at 5.7 and 11.4, so it does not follow load. The timeout went back to 1 s,
    and the cause of the earlier failures stays unconfirmed. round-budget already had 5 s.
  - _The record before the split._ Run alone beside twelve CPU busy loops, both passed three runs
    in a row (stall-retries' tests 7.3 s to 8.0 s, round-budget's 2.2 s to 3.1 s). Inside the
    capped suite, the register below has four runs with a failure without a load harness, and one
    beside twelve busy loops. A capped run without a harness at `2adc31e` passed; the other passing runs
    were not recorded, so no failure rate is given.
  - _With the split:_ three capped full runs in a row at `3cf6fae`
    (`turbo run test --force --continue --concurrency=2`, no harness) passed in every package:

    | run | time  | one-minute load, start → end | stall-retries file | round-budget file |
    | --- | ----- | ---------------------------- | ------------------ | ----------------- |
    | 1   | 383 s | 2.8 → 8.8                    | 21.6 s             | 6.5 s             |
    | 2   | 431 s | 8.8 → 9.4                    | 21.6 s             | 6.6 s             |
    | 3   | 429 s | 9.4 → 8.8                    | 21.7 s             | 6.7 s             |

    Five-minute averages at the ends were 12.0, 15.6 and 16.5, from other sessions. The run beside
    twelve busy loops was not repeated.

    **The split does not cover heavy outside load.** In review at `81180a3`, `test:timers` run on
    its own at a one-minute load average of 18.6 from other sessions failed once: stall-retries
    reached no stalled path, its file taking 16.7 s. Straight after, it passed twice alone (22.6 s
    and 22.4 s, at 23.2 and 20.7) and once inside the full engine run. One failure in three runs is
    not a rate. The budgets and the 1 s timeout are unchanged, and the owner accepted
    this as registered, with no further serialisation.

## Reading the trend

The nightly `perf-trend` job summary has one line per budgeted metric:

```
- force layout, 2,000 nodes: 1412 ms (limit 2000) · last 7 nightlies: median 1410, range 1380–1460 · +0.1%
```

Tonight's median, its limit (`OVER` when it failed), and the median and range of the same metric
over the last seven nightly runs on `main` that uploaded samples, with tonight's change against that
median. A metric the latest nightly measured and tonight did not gets a "not measured tonight" line.
The runner probe's reading heads the summary: read a slow night against it.

## The inventory

Every test and CI step that asserts wall-clock time, a frame rate or a performance budget, by what
it now follows. Found by searching the test files for `performance.now`, `Date.now`, `hrtime` and
budget constants; a `Date.now()` used only to make a fixture date is not listed.

**Absolute budgets, on the shared rule** (`expectWithinBudget`): a median of five, in CPU time
against three times the budget in `pnpm test`, and on the wall clock against the budget under
`PERF_STRICT=1`.

- `packages/engine/src/v2/layout/force-layout.test.ts`: the 2,000-node layout, 2 s. It was the
  fastest of three runs; it failed on PR #46 and under three parallel sessions locally.
- The eight single-run bounds the table below marks "median of 5": each had less than ten times its
  loaded maximum as headroom.
- `tests/visual/perf.spec.ts`: the three crawl-screen windows and the explorer, on the medians of
  five runs (the visual budgets are always held at their real thresholds; the PR job's retry and
  the slow-runner rule are above).

**Relative costs, on the shared rule** (`expectWithinRelative`), each side the median of five
interleaved runs, against the same limits as before:

- `packages/engine/src/analysis/ai-readiness/main-content.test.ts`: flat siblings against the same
  nodes nested (under 5×), and extraction against its parse at depth 8,000 (under 1×).
- `packages/worker/src/rows/links.test.ts`: 500 nested links against one, for six subtree shapes, and
  a page with no body against the same inside one (each under 3× plus 150 ms).

**Correctness with a timeout, kept as they are:** a vitest per-test timeout; the Playwright timeout
on the crawl screen's perf tests, which grows with `RUNS` (60 s a run: five runs of "the crawl, the
map growing" took 154.8 s on CI run 41754514564 and 155.0 s in the nightly, against the 180 s it
was until the run count rose from three to five; a hang in each of the four budget tests on both
attempts would take 40 minutes, so the job's 60-minute limit, not the summary, would report it);
the 15 s settle bound in
`crawl-settlement.test.ts`; the Crawl-delay lower bounds and hang bounds in
`reproducibility.test.ts`; the date arithmetic in `crawl-politeness.test.ts`; the lower bounds on
request gaps in the worker's `rate.test.ts` and the fake clock in `limiter.test.ts`; the fake clock in
`tests/visual/motion.spec.ts`; the 5 s observation window in `tests/visual/a11y.spec.ts`; and
`scripts/research/cf-panel/fetcher.test.ts`, which checks a resolved promise returns before a 60 s
deadline. The load test's memory bounds in `packages/worker` are correctness bounds and out of
scope here.

**Crawl fixtures with a wall-clock budget, timer-based:** `crawl-stall-retries.test.ts` gives its
crawl 22 s (it was 9 s), and `crawl-round-budget.test.ts` keeps its 2 s rounds and 12 s crawl. Both
run in the engine's `test:timers` run, after the rest of the engine suite. The section on busy
machines above has their numbers. Found in review, the same class and given the same handling (owner ruling, 2026-11-05):
"certifies a budget-exhausted deep-chain crawl as low-confidence" gives a crawl of a chain whose
pages each answer after 150 ms a 2 s budget, and asserts it fetched at least `MIN_COVERAGE_PAGES`
(5) pages. It moved unchanged from `reproducibility.test.ts` to
`reproducibility-deep-chain.test.ts`, a file of its own because the serial run selects whole files,
and runs in `test:timers` with the two crawl fixtures. Its one failure, before the move, is in the
register.

**Found late, out of scope:** `packages/worker/src/load.test.ts:175` (`expectLoopFree`) holds the
event loop's longest stall under 1,000 ms and its utilisation under 0.5 while the load test reads
pages, measured in the probe's child process (which is why a search of the test files for
`performance.now` missed it). It is in the worker load test, which this change leaves alone. It
read a 4,538 ms stall once, in the uncached run at turbo's default concurrency beside other
sessions' load, and passed at concurrency 2.

**New on `main` at the merge of `ab34589` (CC-12d, the worker's batch and access facts).** Its new
worker tests run on a fake clock (`InstantClock`), with three exceptions on the real one:

- `packages/worker/src/fetch/timing.test.ts` › "keeps concurrent requests apart: each gets its own
  first-byte time" asserts a request answered at once has its first byte inside 150 ms, beside one
  held for 250 ms. A single-run wall-clock upper bound, left as it is: it checks that the two
  requests' timings are kept apart, not how fast the code is, so the CPU rule does not fit it.
  Measured on `ab34589` with a log line added and removed, ten runs each: 7 to 19 ms at a
  one-minute load average of 6 to 8, and 4 to 35 ms beside twelve CPU busy loops (load 11 to 30),
  so 4.3 times headroom at worst, under the 10 times that keeps a budget single-run. Every run passed: the ten at
  the lower load ran that test alone, and the ten beside the loops ran the whole file of seven
  tests. It is a candidate for the serial treatment if it fails; no ruling
  covers it yet.
- `packages/worker/src/server.test.ts`: the 3 s deadline in `partialPost` is a hang bound around a
  refusal answered before the body is read, and "gives a signed-looking body … to arrive" waits for
  the server's own body deadline with 5 s of test timeout beyond it. Both are hang bounds.

**Single-run bounds, measured.** These were measured on the wall clock, before the CPU rule, and
the ones kept stay single wall-clock readings. The time each assertion's own clock read, with log lines added
for the measurement and removed after it: three runs of each file with no extra load, and three
beside twelve CPU busy loops on a 12-core workstation (other sessions were also running on it).
An assertion inside `it.each` or a helper reads more than once per run. A bound with ten times its
loaded maximum or more stays a single run. Two under ten stay as hang guards, because what they
guard against is a stall of many seconds, not a slower read: `hostile-page.test.ts` (a hostile page
that held the reader thread for about 57 s on a VM and 14.5 s on a workstation before its fix) and `thread-reader.test.ts` (a hung reader thread, whose
bound includes the 300 ms deadline it waits out). The two in `main-content.test.ts` say so in their
comments: they guard a hang, not a budget.

| assertion (file:line at `cba7b62`)                                   | bound             | idle, max | 12-process load, max | readings each | headroom under load | rule now                           |
| -------------------------------------------------------------------- | ----------------- | --------- | -------------------- | ------------- | ------------------- | ---------------------------------- |
| `packages/engine/src/analysis/ai-readiness/classify.test.ts:85`      | 1000 ms           | 110.3 ms  | 304.4 ms             | 3             | 3x                  | median of 5 (`expectWithinBudget`) |
| `packages/worker/src/reader/hostile-page.test.ts:82`                 | 2000 ms           | 104.0 ms  | 238.1 ms             | 3             | 8x                  | kept: hang guard                   |
| `packages/engine/src/v2/detectors/hreflang-gaps.test.ts:225`         | 5000 ms           | 553.8 ms  | 1514.8 ms            | 3             | 3x                  | median of 5 (`expectWithinBudget`) |
| `packages/worker/src/rows/links.test.ts:209`                         | 500 ms            | 114.4 ms  | 258.1 ms             | 3             | 2x                  | median of 5 (`expectWithinBudget`) |
| `packages/engine/src/analysis/ai-readiness/llms-txt.test.ts:39`      | 500 ms            | 34.3 ms   | 124.7 ms             | 3             | 4x                  | median of 5 (`expectWithinBudget`) |
| `packages/engine/src/analysis/ai-readiness/main-content.test.ts:113` | 20000 ms          | 16.0 ms   | 30.1 ms              | 3             | 664x                | kept: hang guard                   |
| `packages/engine/src/analysis/ai-readiness/main-content.test.ts:131` | 20000 ms          | 183.1 ms  | 325.8 ms             | 3             | 61x                 | kept: hang guard                   |
| `packages/engine/src/analysis/ai-readiness/page-signals.test.ts:73`  | 250 ms            | 23.3 ms   | 67.2 ms              | 3             | 4x                  | median of 5 (`expectWithinBudget`) |
| `packages/engine/src/v2/diff/robots-diff.test.ts:62`                 | 500 ms            | 1.0 ms    | 9.7 ms               | 3             | 52x                 | kept: single run, 10× or more      |
| `packages/engine/src/robots.test.ts:130`                             | 50 ms             | 0.1 ms    | 0.1 ms               | 3             | 500x                | kept: single run, 10× or more      |
| `packages/worker/src/politeness/robots.test.ts:139`                  | 2000 ms           | 75.0 ms   | 145.0 ms             | 3             | 14x                 | kept: single run, 10× or more      |
| `packages/worker/src/politeness/robots.test.ts:256`                  | 1000 ms           | 10.8 ms   | 17.0 ms              | 12            | 59x                 | kept: single run, 10× or more      |
| `packages/engine/src/robots.test.ts:455`                             | 200 ms (32 KiB)   | 0.3 ms    | 0.8 ms               | 21            | 250x                | kept: single run, 10× or more      |
| `packages/engine/src/robots.test.ts:455`                             | 2000 ms (500 KiB) | 4.2 ms    | 14.2 ms              | 21            | 141x                | kept: single run, 10× or more      |
| `packages/engine/src/robots.test.ts:527`                             | 2000 ms           | 45.8 ms   | 131.3 ms             | 3             | 15x                 | kept: single run, 10× or more      |
| `packages/engine/src/robots.test.ts:541`                             | 2000 ms           | 21.4 ms   | 130.1 ms             | 3             | 15x                 | kept: single run, 10× or more      |
| `packages/engine/src/robots.test.ts:565`                             | 1000 ms           | 96.9 ms   | 317.0 ms             | 3             | 3x                  | median of 5 (`expectWithinBudget`) |
| `packages/engine/src/robots.test.ts:584`                             | 1000 ms           | 69.5 ms   | 194.0 ms             | 3             | 5x                  | median of 5 (`expectWithinBudget`) |
| `packages/worker/src/rows/text.test.ts:63`                           | 500 ms            | 4.3 ms    | 12.2 ms              | 3             | 41x                 | kept: single run, 10× or more      |
| `packages/worker/src/rows/text.test.ts:74`                           | 3000 ms           | 486.6 ms  | 1360.9 ms            | 3             | 2x                  | median of 5 (`expectWithinBudget`) |
| `packages/worker/src/rows/text.test.ts:88`                           | 5000 ms           | 2.0 ms    | 5.0 ms               | 3             | 1000x               | kept: single run, 10× or more      |
| `packages/worker/src/reader/thread-reader.test.ts:149`               | 5000 ms           | 407.6 ms  | 806.1 ms             | 3             | 6x                  | kept: hang guard                   |

`packages/engine/src/text-safety.test.ts:164` (500 ms) is not in the table: its assertion passes a
message to `expect`, which the measuring script missed. The whole test took 4 ms idle and 21 ms
under the load (vitest's own durations), so its bound has over 20 times its loaded maximum.

## Mutation proofs

Measured at `88056e9`, before the later fixes to the helper (a fresh input per run, the cold
call's value kept, stopping at a majority), which their own tests and the review's mutations cover.
Each converted check was run against an injected regression under the CPU rule, once on an idle
machine and once beside twelve CPU busy loops (one-minute load average 9.3 at the start of the idle run and 4.7 at its end; 4.7 to 16.0 across the
loaded run). The product file was backed up with `cp` and
restored after each case. An absolute budget gets a loop that burns a fixed CPU time per call, 3.5
and 1.5 times the budget: red at 3.5× under the default ceiling, green at 1.5× (the band a PR lets
through, which the nightly holds), and red at 1.5× under `PERF_STRICT=1`. A relative check gets the
regression its comment names, where the history has one: the pre-`f8ffa5a` `.find()` over the body
for width, the pre-`be0cbcc` selector for the canonical, link text read per link for nesting, and the
per-agent list check the robots bound was tightened for. The injected work is CPU, not a wait on the
clock, because a wait on the clock does less work on a loaded machine.

Absolute budgets: a loop that burns the stated CPU time at the top of the measured function.

| check                             | budget  | +3.5× default (idle / loaded)                 | +1.5× default (idle / loaded) | +1.5× `PERF_STRICT=1` (idle / loaded)                      | unmutated (idle / loaded) |
| --------------------------------- | ------- | --------------------------------------------- | ----------------------------- | ---------------------------------------------------------- | ------------------------- |
| force layout                      | 2000 ms | RED (8276.33 ms CPU) / RED (10327.82 ms CPU)  | GREEN / RED (6274.75 ms CPU)  | RED (4149.64 ms wall-clock) / RED (8638.54 ms wall-clock)  | GREEN / GREEN             |
| noscript scan                     | 1000 ms | RED (3510.44 ms CPU) / RED (3528.38 ms CPU)   | GREEN / GREEN                 | RED (1510.73 ms wall-clock) / RED (1956.99 ms wall-clock)  | GREEN / GREEN             |
| llms.txt parse                    | 500 ms  | RED (1759.44 ms CPU) / RED (1775.94 ms CPU)   | GREEN / GREEN                 | RED (774.5 ms wall-clock) / RED (894.54 ms wall-clock)     | GREEN / GREEN             |
| page AI signals                   | 250 ms  | RED (881.01 ms CPU) / RED (882.79 ms CPU)     | GREEN / GREEN                 | RED (374.62 ms wall-clock) / RED (745.38 ms wall-clock)    | GREEN / GREEN             |
| hreflang clusters                 | 5000 ms | RED (17854.75 ms CPU) / RED (18296.9 ms CPU)  | GREEN / GREEN                 | RED (8511.11 ms wall-clock) / RED (29837.53 ms wall-clock) | GREEN / GREEN             |
| robots, 30,000+ agents            | 1000 ms | RED (3532.79 ms CPU) / RED (3567.61 ms CPU)   | GREEN / GREEN                 | RED (1531.64 ms wall-clock) / RED (2382.86 ms wall-clock)  | GREEN / GREEN             |
| robots, every agent in two groups | 1000 ms | RED (3530.9 ms CPU) / RED (3566.06 ms CPU)    | GREEN / GREEN                 | RED (1525.57 ms wall-clock) / RED (2360.66 ms wall-clock)  | GREEN / GREEN             |
| readHtml stray close tags         | 3000 ms | RED (10825.91 ms CPU) / RED (11153.46 ms CPU) | GREEN / GREEN                 | RED (4824.38 ms wall-clock) / RED (8363.87 ms wall-clock)  | GREEN / GREEN             |
| readLinks 2,000 nested            | 500 ms  | RED (1829.76 ms CPU) / RED (1985.4 ms CPU)    | GREEN / GREEN                 | RED (827.05 ms wall-clock) / RED (1308.52 ms wall-clock)   | GREEN / GREEN             |

Relative checks, each against the regression named.

| check and regression                                        | mutated, default (idle / loaded)             | mutated, `PERF_STRICT=1` (idle / loaded)                   | unmutated (idle / loaded) |
| ----------------------------------------------------------- | -------------------------------------------- | ---------------------------------------------------------- | ------------------------- |
| main content width (the pre-f8ffa5a .find over the body)    | RED (637.15 ms CPU) / RED (2025.54 ms CPU)   | RED (641.04 ms wall-clock) / RED (2127.09 ms wall-clock)   | GREEN / GREEN             |
| main content depth (an ancestor walk per node)              | RED (1322.6 ms CPU) / RED (4805.26 ms CPU)   | RED (1295.22 ms wall-clock) / RED (6322.61 ms wall-clock)  | GREEN / GREEN             |
| readLinks nested (100 links each read their subtree)        | RED (4441.59 ms CPU) / RED (10399.28 ms CPU) | RED (4419.99 ms wall-clock) / RED (11974.5 ms wall-clock)  | GREEN / GREEN             |
| readLinks with no body (the pre-be0cbcc canonical selector) | RED (4501.15 ms CPU) / RED (6783.74 ms CPU)  | RED (3149.58 ms wall-clock) / RED (7965.68 ms wall-clock)  | GREEN / GREEN             |
| robots, 30,000+ agents: a list check per agent              | RED (5462.95 ms CPU) / RED (10415.58 ms CPU) | RED (4946.51 ms wall-clock) / RED (12946.19 ms wall-clock) | GREEN / GREEN             |

Liveness, first in each run: an unconditional throw where the delays go turned the force-layout test RED idle and RED loaded.

**One row is not as designed under load.** Force layout's +1.5× case went red beside the twelve
loops (6.27 s of CPU against the 6 s ceiling), where it is green idle. CPU time rises too when cores
are shared, if far less than the clock: each 3.5× row's median less its injected CPU gives the
check's own cost, force layout 1276 ms idle and 3328 ms loaded; hreflang clusters 355 ms idle and 797 ms loaded; readHtml stray close tags 326 ms idle and 653 ms loaded; readLinks 2,000 nested 80 ms idle and 235 ms loaded. So a loaded machine makes the PR ceiling stricter, not looser; every
unmutated check passed there.

The robots regression that combines every agent at parse, the other shape that bound was tightened
for, was not rerun under the CPU rule: in the wall-clock run before it, the vitest worker exited
before reporting (most likely out of memory), which fails the test, though not as a timing reading.

**The visual job's decision, on a real regression.** A 40 ms busy loop in the crawl screen's render
(`apps/web/components/v2/screens/crawl/CrawlScreen.tsx`, restored after), a production build, and
`perf-retry.sh` on a workstation the probe rated normal (100.1 ms; the reference was then a 100 ms
placeholder and is 105 ms now, normal either way) on
"the crawl, the map growing". Attempt 1: median p95 33.4 ms and a slow share of 0.0333 against
0.01. Attempt 2 (`--last-failed`): 33.4 ms and 0.0309. The script exited 1 with "Failed on both
attempts". Without the loop, a production build of the branch passed all five perf tests on the same
machine (8.3 minutes).

## The runner probe

`packages/timing/src/probe.ts` fills an array of 1,000,000 numbers from a fixed generator and sorts
it: one warm-up, then five timed runs, and the median. `PROBE_REFERENCE_MS` is 105, the median of
three readings on the GitHub-hosted runner in the Playwright image, rounded to a whole millisecond.
`SLOW_RUNNER_FACTOR` is 1.5, so a runner is rated slow above 157.5 ms.

| reading   | run                                                                                                                      | job                              |
| --------- | ------------------------------------------------------------------------------------------------------------------------ | -------------------------------- |
| 96.86 ms  | [CI 41751410735](https://github.com/sikder13/crawlmouse/actions/runs/41751410735), push of `1878d29`                     | `visual-shard (1)`, 126317111732 |
| 104.79 ms | [CI 41754514564](https://github.com/sikder13/crawlmouse/actions/runs/41754514564), push of `5c27b61`                     | `visual-shard (1)`, 126327362656 |
| 104.88 ms | [Nightly 41751423557](https://github.com/sikder13/crawlmouse/actions/runs/41751423557), `workflow_dispatch` on `1878d29` | `perf-strict`, 126317157693      |

The same probe read 100.1 ms on the 12-core workstation the mutation proofs ran on. A probe times
the CPU; a runner that is slow for another reason (its GPU or compositor, or the disk) can read
normal and still fail the frame budgets, and then the job fails, as on a normal runner.

## Flake register

Add a row whenever a timing check fails and a re-run or the retry shows it was noise. The visual
job writes the row for you (job summary, and the `flake-entry-<run>-<attempt>` artifact); commit it
in the PR that saw it.

The crawl-fixture rows carry the label the owner ruled for them, "Timer-based: load-sensitive
under outside load; CI unaffected". Outside load is other work on the same machine, such as other
sessions on a workstation. "CI unaffected" means CI runners, which are not shared with other
sessions; the nightly `test` job runs `pnpm test` at the cap, so there the serial run can share its
runner with another package's suite. The owner accepted the failure inside the serial run under
outside load as registered, with no further serialisation (ruling of 2026-11-05).

| date       | test                                                                                                                            | run                                                                                                                                                                                                        | what decided it was noise                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| ---------- | ------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 2026-10-29 | #43, `perf.spec.ts` › the crawl, the map growing: within the budget (React development build)                                   | [run 40933573326](https://github.com/sikder13/crawlmouse/actions/runs/40933573326), job 123658091490, `00fae50`                                                                                            | The same commit read differently on its push run, below: p95 33.3 ms here (7.2% of intervals late) and 16.8 ms there.                                                                                                                                                                                                                                                                                                                                                                                                            |
| 2026-10-29 | #43, `perf.spec.ts` › the crawl, the map growing: within the budget (React development build)                                   | [run 40933566313](https://github.com/sikder13/crawlmouse/actions/runs/40933566313), attempt 1, job 123658243359, `00fae50`                                                                                 | Same commit as the row above, which failed on p95 instead; here 11 slow frames against a limit of 6.8. Two runs of one commit, two different misses.                                                                                                                                                                                                                                                                                                                                                                             |
| 2026-10-29 | #43, `perf.spec.ts` › the crawl, the map growing: within the budget                                                             | [run 40845184557](https://github.com/sikder13/crawlmouse/actions/runs/40845184557), job 123350820950, `f16fc38`                                                                                            | **Probably noise, not proven.** p95 33.3 ms; the perf step passed at the next pushed commit, `d538a56`. Between them the measured page changed (CSS in `CrawlScreen.module.css`, a parameter default in `LiveMap.tsx`), so the pass does not isolate the runner.                                                                                                                                                                                                                                                                 |
| 2026-11-01 | #46, `force-layout.test.ts` › the layout of a 2,000-node graph                                                                  | [run 41330936019](https://github.com/sikder13/crawlmouse/actions/runs/41330936019), job 124920701273, `3737d8e`                                                                                            | A single run read 2,054.96 ms against 2,000 ms; the push run on the same commit, [41318855237](https://github.com/sikder13/crawlmouse/actions/runs/41318855237), passed.                                                                                                                                                                                                                                                                                                                                                         |
| 2026-11-02 | #49, `perf.spec.ts` › the crawl, the map growing: within the budget                                                             | [run 41382509465](https://github.com/sikder13/crawlmouse/actions/runs/41382509465), attempt 1, job 125076161252, `0366d8b`                                                                                 | Attempt 2 of the same run, same commit, passed. All three samples of attempt 1 were slow (p95 33.3 ms; 9.2%, 8.9% and 9.5% of intervals late): the whole runner, not one sample.                                                                                                                                                                                                                                                                                                                                                 |
| 2026-11-03 | `force-layout.test.ts` › the layout of a 2,000-node graph                                                                       | local, `turbo run test --force` at default concurrency, load average up to 41, `5c27b61` plus the merge of `ef232a3`                                                                                       | Five samples of 6.7 s to 52.6 s against about 2 s quiet; the engine suite alone straight after passed (1,821 of 1,821). The wall clock was measuring the queue for a core, which is why the default suite now reads CPU time.                                                                                                                                                                                                                                                                                                    |
| 2026-11-03 | `crawl-round-budget.test.ts` › moves on to the next round and reaches the sections behind the stalled one                       | local, the same run, and again at `--concurrency=2` with load averages of 30 to 38 from other sessions                                                                                                     | **Timer-based: load-sensitive under outside load; CI unaffected.** Passed alone beside twelve CPU busy loops, three runs in a row (2.2 s to 3.1 s).                                                                                                                                                                                                                                                                                                                                                                              |
| 2026-11-03 | `crawl-stall-retries.test.ts` › spends ONE request on a stalled URL, not the whole retry budget                                 | local, the same run; and `--concurrency=2` beside twelve CPU busy loops, `88056e9`                                                                                                                         | **Timer-based: load-sensitive under outside load; CI unaffected.** "No stalled path was reached", its file taking 17.1 s; passed alone beside the same loads, three runs in a row (7.3 s to 8.0 s).                                                                                                                                                                                                                                                                                                                              |
| 2026-11-04 | `crawl-stall-retries.test.ts` › spends ONE request on a stalled URL, not the whole retry budget                                 | local, `turbo run test --force --continue --concurrency=2`, no harness, one-minute load average 7.6 at the end from other sessions, `d21500e`                                                              | **Timer-based: load-sensitive under outside load; CI unaffected.** The same "no stalled path was reached", its file taking 17.5 s against about 22 s when it passes: the crawl ended early, not at its 60 s budget. Probable cause, not confirmed: the fixture's 1 s navigation timeout expiring on its own home page. Not changed without a ruling.                                                                                                                                                                             |
| 2026-11-04 | `crawl-round-budget.test.ts` and `crawl-stall-retries.test.ts`, one test each (as in the rows above)                            | local, `turbo run test --force --continue --concurrency=2`, no harness, one-minute load average 5.3 at the end from other sessions, `788584a`                                                              | **Timer-based: load-sensitive under outside load; CI unaffected.** Both failed in the same capped run: round-budget missed `/z-fast-0`, stall-retries reached no stalled path. With the earlier rows, one or both failed in three of the last four capped full runs; the engine suite run alone passed. Not changed without a ruling.                                                                                                                                                                                            |
| 2026-11-05 | `crawl-stall-retries.test.ts` › spends ONE request on a stalled URL, not the whole retry budget                                 | local, `turbo run test --force --continue --concurrency=2`, no harness, `611f487`                                                                                                                          | **Timer-based: load-sensitive under outside load; CI unaffected.** The same "no stalled path was reached", the last failure before the two fixtures moved to a serial run of their own (`test:timers`). Three capped runs at `3cf6fae` then passed (the busy-machine section above).                                                                                                                                                                                                                                             |
| 2026-11-05 | `reproducibility.test.ts` › certifies a budget-exhausted deep-chain crawl as low-confidence + caveated                          | local, review, `pnpm --filter @crawlmouse/engine test`, one-minute load average 26 at the start and a five-minute average of 44.6 after, from other sessions, `4f55a41`                                    | **Timer-based, wall-clock lower bound.** `expected 4 to be greater than or equal to 5` pages inside the 2 s budget; the same run logged a vitest worker RPC timeout. Run alone straight after (`-t "deep-chain"`), it passed in 2.3 s. Moved to the serial run afterwards (owner ruling), as `reproducibility-deep-chain.test.ts`.                                                                                                                                                                                               |
| 2026-11-05 | `crawl-stall-retries.test.ts` › spends ONE request on a stalled URL, not the whole retry budget                                 | local, the gate on the merge of `main`, `2c57558`, `turbo run test --force --continue --concurrency=2`, one-minute load average 13.8 at the start and 16.1 at the end from other sessions                  | **Timer-based: load-sensitive under outside load; CI unaffected.** "No stalled path was reached", the test taking 2.0 s, with the web suite running beside the serial run. `test:timers` then passed three times alone (stall-retries 23.0 s, 22.6 s, 21.8 s). Accepted as registered (owner ruling).                                                                                                                                                                                                                            |
| 2026-11-05 | `apps/web/__tests__/v2/preview-guard.test.ts` › 404s every page by itself in production, before rendering anything              | local, the same gate run, and three runs of the file alone straight after at a one-minute load average of 11 to 13, `2c57558`                                                                              | **Vitest's default 5 s test timeout, under outside load.** A correctness test from `main`, which this branch does not change. It timed out at 5.0 s in all four; on clean `main` (`ab34589`) at a load of 8 to 10 it took 2.1 to 2.2 s, and on `2c57558` afterwards, at loads of about 4 to 8, it took 1.9 to 2.7 s in six runs. Not changed: it is not a timing assertion of this inventory.                                                                                                                                    |
| 2026-11-05 | `crawl-stall-retries.test.ts` › spends ONE request on a stalled URL, not the whole retry budget                                 | local, review, `pnpm run test:timers` alone in `packages/engine`, one-minute load average 18.6 from other sessions, `81180a3`                                                                              | **Timer-based: load-sensitive under outside load; CI unaffected.** The first failure inside the serial run: "no stalled path was reached", its file taking 16.7 s against about 22 s. Passed alone twice straight after (22.6 s and 22.4 s) and inside the full engine run that followed. Not changed without a ruling.                                                                                                                                                                                                          |
| 2026-11-05 | #58, `perf.spec.ts` › the crawl, the map growing: within the budget                                                             | [run 42129310897](https://github.com/sikder13/crawlmouse/actions/runs/42129310897), attempts 1 and 2 of the step's retry, job 127601570797, `ec7a7b5`                                                      | The next run, [42139162938](https://github.com/sikder13/crawlmouse/actions/runs/42139162938) (job 127634789102, `2f31c8b`), passed on attempt 1: p95 16.8 ms, 0.28% of frames slow. Between the two commits only screenshot baselines changed (`git diff --name-only ec7a7b5 2f31c8b`), so the page measured was the same code. Both failing attempts read p95 33.3 ms in all five samples, the whole runner; attempt 2 was also 1.22% slow against 1%. The retry did not clear it: the pass was on the next run, not the retry. |
| 2026-11-05 | `packages/worker/src/load.test.ts` › memory under load › 4 crawl batches of 50 URLs on 10 MB brotli pages finish within 640 MiB | local, the gate on the merge of `main`, `9442ef5`, `turbo run test --filter=@crawlmouse/worker --concurrency=1 --force`, one-minute load average 3.1 at the start                                          | **Not proven noise; cause not found.** The event loop stalled for 4,154 ms against a limit of 1,000 ms (`loop_delay_max_ms`). The worker suite passed in full at the next commit, `c7bdb69`, whose only change is an engine test file (`git diff --name-only 9442ef5 c7bdb69`), at a one-minute load average of 14.5 from other sessions.                                                                                                                                                                                        |
| 2026-11-05 | `reproducibility-deep-chain.test.ts` › certifies a budget-exhausted deep-chain crawl as low-confidence + caveated               | local, the gate on `c7bdb69`, the engine's `test:timers` inside `turbo run test --filter=@crawlmouse/engine --concurrency=1 --force`, one-minute load average 4.8 and five-minute 17.2 from other sessions | **Timer-based, wall-clock lower bound.** `expected 4 to be greater than or equal to 5` pages inside the 2 s budget, as in the row of `4f55a41`. `pnpm run test:timers` then passed three times alone (deep-chain 2.38 s, 2.22 s, 2.21 s).                                                                                                                                                                                                                                                                                        |
