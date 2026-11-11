# CC-COST — CI that costs little once the repository is private

The repository turns private at go-live, on GitHub Pro: 3,000 included Actions minutes a month, then
$0.006 a minute. CC-REPO measured about 75,700 minutes a month with the visual set (six visual
shards, `security-browser`, `zap-baseline`) at 77% of them, run on nearly every push. This step
changes **when** the visual set runs. What must be green to merge is unchanged.

Commands run from the repository root. The workflow rules below are pinned by:

```bash
pnpm --filter @crawlmouse/web exec vitest run __tests__/security/ci-workflow.test.ts __tests__/security/workflow-concurrency.test.ts
```

## D1 — the visual set runs when a branch is up for merge

`ci.yml`'s `changes` job decides a `gate` (`.github/workflows/ci.yml`, step "Is the commit up for
merge…"). It is `open` when:

- (a) the ref is `main`, whatever the event;
- (b) the event is a push, or a dispatch without `visual: true`, and GitHub lists an open pull
  request whose head is the branch (`GET /repos/{repo}/pulls?state=open&head={owner}:{branch}`;
  the job has `pull-requests: read`). A draft is an open pull request, so pushes to a draft run the
  visual set;
- (c) the event is `pull_request`, which `ci.yml` receives only for `opened`, `reopened` and
  `ready_for_review`;
- (d) the event is a `workflow_dispatch` with the input `visual: true`.

When GitHub cannot be asked, or answers something that is not a count, the gate opens with a
warning: the run then costs what it did before this step, and nothing is skipped by mistake.

Otherwise the gate is `deferred`: the visual set is skipped and the `visual` job is renamed
`visual (deferred: no open pull request)`. The ruleset requires a check named exactly `visual`; on a
deferred push no check of that name is reported for the commit, so the requirement stays unmet and
the branch cannot merge on that run. Only an explicit `deferred` renames the job: when `changes`
fails, the job keeps the name `visual` and fails.

A pull request event runs **every** job, not only the visual set. A job skipped by a condition
reports success, and a skipped twin of a required check on the head commit could stand in for one
that failed; GitHub does not document which of two same-named check runs a ruleset reads. The
pull request run tests GitHub's merge commit for the pull request; its checks attach to the head
commit. A pull request merges only when up to date with `main`, and then the two trees are the same.

What a branch costs, in order:

1. Each push before the pull request opens: the cheap jobs, and `visual` reported under its
   deferred name.
2. Opening the pull request: one full run.
3. Each push after that: a full run (or the cheap jobs and a passing `visual` when the path filter
   finds nothing that renders, D2).

How this was proven on this branch's own pull request is in its description.

## D2 — the path filter still decides inside an open gate

Unchanged from CC-REPO (`docs/specs/v2/repo-private.md`, D6): inside an open gate the shards are
skipped, and `visual` passes, when every file the branch changed is on the reviewed skip list in
`.github/workflows/scripts/changes.mjs`. A docs-only or CI-only branch with an open pull request
therefore costs the cheap jobs only.

## D3 — the crawl screen's budget measures work, not the refresh rate

See `tests/visual/perf.spec.ts`. The three crawl-screen windows were judged on the 95th-percentile
interval between `requestAnimationFrame` callbacks. On a runner that renders at 30 fps every
interval is 33.3 ms, so the window failed with its work unchanged (run of `b23d4ca6`: 33.3 ms in
all five runs against 17.5 ms), and passed on re-run.

The windows are now judged on the main thread's busy time in each 16.7 ms slice of the traced
window (`packages/timing/src/busy.ts`; its tests pin the arithmetic against sums computed without
slices). The slices are fixed in time, so the reading is the page's work whatever refresh rate the
runner manages. Judged on the median of five runs, as before:

- `meanWorkMs`, the mean busy time per slice, at most `BUDGET.meanWorkMs`;
- `p95WorkMs`, its 95th percentile (the bursts), at most `BUDGET.p95WorkMs`;
- `maxFrameMs`, no frame interval over 100 ms (a stall at any refresh rate), unchanged.

The 95th-percentile interval and the share of intervals over 34 ms are printed and recorded for the
nightly trend, not judged (`ADVISORY` in `tests/visual/budgets.ts`). A run must draw more than 20
frames a second to count as measured; it was 50, which failed a 30 fps runner as "measurement
invalid", an error the retry never excuses.

Read the limits: `sed -n '/^export const BUDGET/,/^};/p' tests/visual/budgets.ts`.

**Measured on the production build, the crawl window, five runs each** (a workstation, 2026-11-11;
logs beside the PR notes). This machine draws about 50 frames a second, so the old rule failed it
with nothing changed:

| run                                                 | mean work / slice (median) | p95 work / slice | p95 frame interval | old rule | new rule |
| --------------------------------------------------- | -------------------------- | ---------------- | ------------------ | -------- | -------- |
| the page as it is                                   | 2.195 ms                   | 5.61 ms          | 33.4 ms            | red      | green    |
| every `requestAnimationFrame` callback held a frame | 2.094 ms                   | 5.37 ms          | 50.1 ms            | red      | green    |
| the map rendered and animated twice (a hidden twin) | 2.93 ms                    | 7.5 ms           | 33.4 ms            | red      | **red**  |

The twin map (a second `MapSvg` with its own `useFlip`, invisible) is the mutation for "the map does
twice the work per frame": the page's work rises by about a third (2.195 to 2.93 ms), because the map is part of it, and the
mean crosses its limit. The 95th percentile moves less, which is why the mean is the budget held
closely. Held callbacks model the CI symptom (frame intervals of two vsyncs or more); they slow the
page's own callbacks, not the browser's compositor.

**The limits are absolute milliseconds**, so a slower CPU reads more work. That is what the runner
probe and the one retry in `packages/timing/scripts/perf-retry.sh` already handle
(`docs/ops/ci-timing.md`): a budget-only failure that repeats on a runner the probe rates slow passes
as inconclusive. The limit was set on one workstation; the PR records the CI run's readings of all
three windows against it, and the nightly trend
shows how close each night runs to it.

## D4 — superseded runs are cancelled

Every workflow has a concurrency group, pinned per file by `workflow-concurrency.test.ts`, which
also fails when a workflow file is added without an entry.

| workflow                 | group                                      | cancels an older run                           |
| ------------------------ | ------------------------------------------ | ---------------------------------------------- |
| `ci.yml`                 | the ref; on `main`, the ref and the run id | yes, never on `main`                           |
| `nightly.yml`            | the ref; on `main`, the ref and the run id | yes, never on `main`                           |
| `db-apply-prod.yml`      | `db-production`                            | no: production                                 |
| `db-rollback-prod.yml`   | `db-production-rollback`                   | no: production                                 |
| `db-dry-run.yml`         | the pull request                           | no: a cancelled run leaves its Supabase branch |
| `db-dry-run-cleanup.yml` | the pull request                           | no: same reason                                |
| `worker-staging.yml`     | `worker-staging`                           | no: a cancelled deploy is half a deploy        |

On `main` each run has its own group (the run id, where it used to be the commit), so a dispatch or
the nightly run of the same commit never cancels a push run. A pull request event's ref is
`refs/pull/<n>/merge`, so it never cancels a push run of its branch.

## D5 — the nightly run covers what a push no longer does

`ci.yml` runs at 03:00 UTC (`schedule`), on `main`: every job, the visual set included. It lives in
`ci.yml` rather than `nightly.yml` because the visual set is `ci.yml`'s jobs; a copy, or a reusable
workflow, would rename the required `visual` check. `codeql` is skipped on the nightly run:
`main`'s push runs scanned the same commits, and its visibility test reads the event's `repository`.
`migrations-append-only` compares a nightly or dispatched run on `main` with the first parent, having
no push `before`.

**A failure is red in the Actions tab**, on the CI workflow's scheduled run, and GitHub emails the
user who last edited the schedule. Not a Sentry event: CI holds no DSN, and adding one is a secret
and a code path to report what GitHub already reports.

## D6 — measured

Method: CC-REPO's (`~/crawlmouse-plan/notes/cc-repo/minutes.sh`): each job's billable minutes are its
start-to-end time rounded up to the whole minute, every attempt counted. The replay
(`~/crawlmouse-plan/notes/cc-cost/replay.py`) takes every CI run of the last 7 days
(2026-11-04 19:02 to 2026-11-11 19:02 UTC, 170 runs) and asks what the new rules would have billed:

- a run on `main`: what it cost;
- a push to a branch with a pull request open at the run's start: what it cost;
- a push with none open: what it cost, less its visual-set jobs;
- a `pull_request` run of the old trigger (before CC-REPO): nothing, since the opening is counted next;
- each pull request opened in the window (18): one more run, costed as the branch's last run before
  it opened;
- seven nightly runs at the median cost of a `main` run (162 minutes);
- the other workflows (46 runs, 288 minutes): as measured.

**The assumption about pushes after a pull request opens is the week's own record:** 11 of 126
branch pushes came with a pull request already open.

| per week                                       | runs | minutes    |
| ---------------------------------------------- | ---- | ---------- |
| pushes, no pull request open (cheap jobs only) | 115  | 4,320      |
| pushes, a pull request open                    | 11   | 1,692      |
| pushes to `main`                               | 18   | 3,414      |
| pull requests opened (one full run each)       | 18   | 3,600      |
| nightly                                        | 7    | 1,134      |
| other workflows                                | 46   | 288        |
| **total**                                      |      | **14,448** |

|                                          | a month (×30/7) | over 3,000 at $0.006 |
| ---------------------------------------- | --------------- | -------------------- |
| this week, CC-REPO's rules (pushes only) | 107,194         | $625                 |
| CC-REPO's own week (2026-11-02 to 11-09) | 75,700          | $436                 |
| **this week, CC-COST's rules**           | **61,920**      | **$354**             |

**The target of 10,000 a month is not met.** The next levers, measured on the same week:

1. **The cheap jobs on every push: 4,320 a week, about 18,500 a month on their own.** Each of
   those jobs pays a checkout, a `pnpm install` and a rounded-up minute. Folding them into a few
   jobs, or deferring them like the visual set (sessions run them locally before pushing), is the
   largest single lever.
2. **The visual set once per pull request and again on its merge to `main`** (3,600 + 3,414 a week).
   A `main` push re-tests the tree its up-to-date pull request head already passed. Skipping the
   visual set there, with the nightly run as the daily full check, saves 2,752 a week, about 11,800
   a month, leaving about 50,100.
3. The nightly run skipping the visual set on a day `main` already ran it saves 889 a week, about
   3,800 a month, leaving about 58,100. It overlaps 2.

Even with 1 and 2, eighteen pull requests a week at about 200 minutes for one visual run each is
about 15,000 a month: under 10,000 needs fewer, cheaper visual runs (fewer shards, or the screenshots
only where the change can reach), not only fewer triggers.

## D7 — docs

- Production: the owner dispatches the workflow from `main`, then approves the `production`
  environment, whose required reviewer is the owner while the repository is public
  (`docs/specs/v2/repo-private.md`, D1, with the command that reads it back). Updated here:
  `repo-private.md`, the comments in `db-apply-prod.yml` and `db-rollback-prod.yml`, and
  `docs/ops/incident-plan.md`, which already said "then approve" and now says when that applies,
  and `docs/ops/db-migrations.md` §1 (step 5 and the paragraph after the steps) and §7 (by owner
  ruling). The two sentences it withdrew are registered in
  `apps/web/__tests__/docs-withdrawn-claims.test.ts`, which fails if either returns:
  `pnpm --filter @crawlmouse/web exec vitest run __tests__/docs-withdrawn-claims.test.ts`.
- `PROJECT_OVERVIEW.md` §9 and `docs/specs/v2/repo-private.md` (D5, D6) point here for the triggers.

## `test (web)` in three shards (added by owner ruling)

The web suite outgrew one job: 13 min 25 s on run 43056751031 (job start to end), and cancelled at
its 15-minute limit on run 43073710281. It now runs as `test-web-shard`, three jobs of
`vitest run --shard=N/3`, each with 25 minutes. The required check `test (web)` is the job
`test-web`, which passes only when every shard passed, so `protect-main` is unchanged. A test
checks that each of the eleven required check names is reported by exactly one job of `ci.yml`.
Wall time after the change is in the PR, read from this branch's CI run.
