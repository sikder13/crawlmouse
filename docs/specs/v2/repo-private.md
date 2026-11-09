# CC-REPO — making the repository safe to turn private

`sikder13/crawlmouse` is a personal-account repository on GitHub Pro. It has been public since 2026-08.
The owner turns it private once this step is merged. Three things the repository relies on stop working
on a private Pro repository. This step puts a replacement in place for each one **before** the flip.

| What stops working on the flip                                                                                                                                         | What replaces it                                                                                                                   |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| Environment required reviewers ("only available for public repositories" on Free, Pro and Team). The `production` reviewer was the only approval on a production apply | Only the owner's own dispatch from `main` starts `db-apply-prod.yml` or `db-rollback-prod.yml`; nothing starts on a merge (D1, D2) |
| Code scanning ("works only on public repositories" on Free or Pro), so the `codeql` job                                                                                | Semgrep CE in CI with its own reviewed baseline (D3); CodeQL keeps running until the flip (D4)                                     |
| Free minutes for standard runners                                                                                                                                      | One CI run per commit (D5) and visual tests only when rendering can change (D6), measured (D7). The owner sets a budget            |

On a private Pro repository, GitHub's environments page says environments, environment secrets and
deployment branches stay available. Required reviewers and wait timers do not. The rulesets page read on
2026-11-09 did not state whether `protect-main`'s required checks keep applying to a private
personal-account repository on Pro, so the owner's checklist reads them back after the flip.

Commands below run from the repository root.

## D1 — the owner dispatches production, by hand

`db-apply-prod.yml` and `db-rollback-prod.yml` have one trigger each, `workflow_dispatch`. A merge no
longer starts an apply. Each workflow runs four jobs:

- `authorize` comes first. It has no environment, no secret and `permissions: {}`. Its one step, **Only the
  owner, dispatching from main**, refuses unless all four of these hold:
  - the event is `workflow_dispatch`;
  - `github.actor` is `github.repository_owner`;
  - `github.triggering_actor` is `github.repository_owner`;
  - the ref is `refs/heads/main`.
- Every job that has an environment `needs: authorize`. On a fresh run, a runner gets an environment's
  secrets only after the check has passed.
- The same step, with the same script, is also the first step of each of those jobs, before the
  checkout. **Re-run failed jobs** re-runs a failed job without re-running an `authorize` that passed.
  Only a step inside the re-run job sees who re-ran it, in `triggering_actor`.
- `report` opens an issue on any failure.

`environment: production` stays on the `apply` and `rollback` jobs, which still use what it holds: the
production secrets, and a deployment-branch policy of `main` only. It is no longer called an approval
anywhere. The sha256 gate is unchanged. `db/production.ts plan` refuses any pending file that a passed
dry run of the merged pull request did not apply byte for byte, and `apply` re-checks the manifest and
production's fingerprint (`docs/ops/db-migrations.md` §1). The approval moves from a click on the
environment to the owner's own dispatch: the same person, the same proof, and nothing applies on merge.
`docs/ops/db-migrations.md` §1 and §4 give the exact clicks.

**What the check cannot do.** It tells GitHub accounts apart, not the tools that act for one. Any token
that acts as the owner and can write Actions passes it. That includes the owner's `gh` login on a
build machine. Two things close that gap:

- the rule in `docs/OPERATING-RULES.md` §7: coding sessions never start, re-run or cancel these
  workflows;
- the owner's follow-up below: a fine-grained token for coding sessions, with no Actions write.

**What it does not cover.** The `db-dry-run` environment holds `SUPABASE_ACCESS_TOKEN`, a Management API
token that acts for the Supabase account. The environment has no branch policy, because pull-request
dry runs use it, so a workflow on any pushed branch can read it. The owner check does not cover it and
cannot. The flip does not change this, because that environment never had a reviewer. It is the
accepted risk in `docs/ops/db-migrations.md` §7. The follow-up is a narrower credential for the dry run.

**Another environment the flip changes: `spike`.** It is used by no workflow
(`grep -rn "environment: spike" .github/workflows` prints nothing) and holds `FLY_API_TOKEN`,
`SPIKE_INTERNAL_SIGNING_SECRET` and `SPIKE_WORKER_JWT_SECRET`. Its only protection is a required
reviewer, with no branch policy, so after the flip a workflow on any pushed branch could read them. The
owner deletes it before the flip (checklist, item 0). Until then the D2 test fails any workflow that
binds it.

**Runs created before this change.** A re-run executes the workflow file of the run it repeats. The
push-triggered runs of `db-apply-prod.yml` from before this change carry no owner check, and after the
flip their `production` reviewer no longer applies. Never re-run a production run created before
CC-REPO merged; the checklist has the owner confirm none is waiting.

## D2 — the test that pins D1

```bash
pnpm --filter @crawlmouse/scripts exec vitest run db/production-workflows.test.ts
```

It parses both files with `yaml` (YAML 1.2, so the key `on` stays a string; YAML 1.1 reads it as
`true`) and fails on any of the following:

- a trigger other than `workflow_dispatch`, in any spelling GitHub accepts. Fixtures vary the
  spelling: a string, a list, a map, a quoted key, and the 1.1 `true:` key, plus `workflow_call`,
  `repository_dispatch` and `schedule`;
- anything `guardProblems` (`scripts/db/workflow-file.ts`) reports. Its doc comment lists the
  checks. The test applies the fixtures in `BYPASSES` and `MORE_BYPASSES` to the parsed real files
  and expects each rejected with a named problem (the `describe` block named "bypasses of the
  guard"). The checks:
  - no workflow-level `defaults` or `env`, and no job-level `uses:`;
  - an `authorize` job with no environment, no `secrets` reference, `permissions: {}`, no `needs`,
    no `if:` and one step;
  - at least one job holding an environment or a `secrets` reference (the context and the status
    functions are matched without case, as GitHub's expressions read them); each such job needs
    `authorize`, has no status function (`success(`, `failure(`, `always(`, `cancelled(`) in its
    `if:`, and no `secrets` reference outside its steps;
  - on `authorize` and each such job: no key outside `environment`, `if`, `needs`, `outputs`,
    `permissions`, `runs-on`, `steps` and `timeout-minutes`, spelled as written, so no job-level
    `env`, `defaults`, `continue-on-error`, `container` or `services` in any case; `runs-on: ubuntu-24.04`; step 0 is the guard, with exactly the keys
    `name`, `env` and `run`, the five-line `env:` mapping, and no expression in its script; no step
    has `continue-on-error`, in any case;
  - the same guard script in every copy.

  Why `env` is refused at workflow and job level: it reaches the guard's process. The test runs the
  real script as GitHub runs a bash step (`bash --noprofile --norc -eo pipefail`) and shows that
  `BASH_ENV` pointing at a file holding `exit 0`, or an exported `BASH_FUNC_[%%` replacing `[`, makes
  it pass a non-owner.

The test runs the guard's script with bash and checks it:

- it passes for the owner dispatching from `main`;
- it refuses each of these: another dispatcher, a re-run by another account, another ref, another
  event, an empty owner, an empty value.

Across every workflow in the repository, the test checks these:

- only these two files bind the `production` environment, its name compared without case;
- outside them, no environment name is an expression (`${{`);
- no workflow binds `spike` (below);
- every workflow declares top-level `permissions`, and none grants `actions: write` or `write-all`.

## D3 — Semgrep replaces CodeQL, in CI only

The `semgrep` job in `.github/workflows/ci.yml` runs Semgrep Community Edition from
`semgrep/semgrep:1.182.1`, pinned by digest. The image has no Node, so the job runs it with
`docker run`, like gitleaks. It uses four community registry packs:

- `p/typescript`
- `p/javascript`
- `p/nodejs`
- `p/react`

`p/nextjs` served no rules without a login on 2026-11-09, so it is left out. The packs overlap: 74
distinct rules run. Semgrep writes its text output to the job log and its JSON to an artifact kept for
seven days. Nothing is uploaded to code scanning, and the job has no `security-events` permission. It
is not a required check.

`.github/workflows/scripts/semgrep-gate.mjs` reads the JSON and fails the job on any of these:

- **an ERROR result** (or CRITICAL or HIGH) that `.github/workflows/scripts/semgrep-baseline.json`
  does not accept. Entries are keyed by rule, file and a content fingerprint, each with a verdict, and
  expire on 2026-12-08, like the CodeQL baseline. Semgrep CE writes the fingerprint and the matched
  lines as `"requires login"`, so the gate computes the fingerprint itself: the sha256 of the rule id
  and the matched source lines read from the file, with whitespace collapsed. It follows the lines'
  content, not their numbers, and matching counts duplicates;
- an unknown severity, or a result whose lines cannot be read;
- a non-zero Semgrep exit code (it exits 0 on findings without `--error`, and 7 when a pack fails to
  load);
- a scan error of level `error`;
- an empty `paths.scanned`;
- fewer than 50 rules run (`--time` lists them);
- an unusable or expired baseline.

```bash
pnpm --filter @crawlmouse/web exec vitest run __tests__/security/semgrep-gate.test.ts
```

Semgrep's built-in ignore list, which it uses when the repository has no `.semgrepignore`, skips every
`build/` directory. One of those, `packages/engine/src/v2/build`, is engine source. So the job writes a
`.semgrepignore` with no pattern before the scan. An ERROR result planted there failed the gate with the
file written and passed it without (`~/crawlmouse-plan/notes/cc-repo/semgrep-triage.md`).

**The first run, 2026-11-09:** 74 rules on 979 files, 0 results of any severity. The baseline ships
with no entries.

**What Semgrep does not replace.** CodeQL's run on `main` on 2026-11-08 reported 21 high-severity
results outside tests, all listed in its baseline (the entries' counts sum to 21:
`node -e "const b=require('./.github/workflows/scripts/codeql-baseline.json'); console.log(b.entries.reduce((n,e)=>n+(e.count??1),0))"`). Semgrep reports none: its community rules are pattern rules with no cross-file data flow. The
three CodeQL results that are real hardening are tracked as CC-SEC-2 in `sec-baseline.md`'s follow-ups,
not by either scanner. The registry packs are fetched at run time and are not pinned, so a rule added
upstream can fail a branch that changed nothing. The baseline takes it in, and the job is not required.
The log's rule count shows when the packs change.

## D4 — CodeQL until the flip

The `codeql` job carries `if: ${{ !github.event.repository.private }}`. It runs, gated as before, until
the flip, and after the flip it is skipped rather than failed. `codeql-baseline.json` and
`sarif-gate.mjs` stay until the baseline expires on 2026-12-08, for reference.

## D5 — one CI run per commit

`ci.yml` triggers on `push` to every branch only. A pull request's required checks are the ones its
head commit's push run reported: status checks attach to a commit, not to an event. The ruleset
requires a branch to be up to date with `main`, so the head that was tested carries `main`'s tree.

The `prettier` and `migrations-append-only` jobs lost their `pull_request` branches. Their comparison
base is the merge-base with `origin/main` on a branch, and the push's `before` on `main`.
`db-dry-run.yml` keeps its own `pull_request` trigger.

A pull request from a fork gets no CI, so it cannot meet the required checks. After the flip, only
collaborators can fork.

## D6 — visual tests when something that can affect rendering changed

Three jobs run only when the `changes` job finds a change that can affect rendering:

- the six `visual-shard` jobs (about 30 minutes each);
- `security-browser`;
- `zap-baseline`.

The `changes` job checks out the full history and lists every file the branch changed against its
merge-base with `origin/main` (`--no-renames`, so a moved file is listed under its old path as well).
It compares the whole branch, not the last push, because the required `visual` check attaches to the
head commit. A docs-only commit on top of a rendering change still runs the visuals. On `main`
everything runs. When there is no merge-base, everything runs and the job logs a warning.
`.github/workflows/scripts/changes.mjs` decides, using no third-party action.

The decision is a skip list, not a list of rendering paths. The previews import widely: `apps/web/lib`,
`packages/engine`, `packages/types`, `inngest` through the API routes, and the specs read
`docs/design/v2/screens`. A list of rendering paths would silently miss the next import. Read the lists:

```bash
sed -n '/^export const SKIP/,/^];/p;/^export const KEEP/,/^];/p' .github/workflows/scripts/changes.mjs
```

The jobs are skipped only when every changed file is on `SKIP` and none is on `KEEP`. `KEEP` holds all
of `apps/web/app` and `apps/web/components`, test files included, because Tailwind's `content` globs scan
them for class names, a reading the import walker does not see. An empty change
list runs them.

The test walks the import closure of several roots and fails if any file in it is skippable:

- every non-test file under `apps/web/app`;
- the root configuration;
- `tests/visual`;
- the security-browser specs;
- `docs/design/v2/screens`.

It also fails if the walk reaches too few files to mean anything. The walk follows static and dynamic
imports, re-exports, `require`, `new URL(…, import.meta.url)` and CSS `@import`.

The required `visual` job passes in two cases:

- every shard passed;
- the shards were skipped and `changes` passed with `visual=false`.

A pass on a skipped branch says nothing about `main`'s own visual state: the branch is compared with
`main`, so if `main`'s own run failed its shards, a docs-only branch still passes `visual`. `main`'s
red run is where that shows.

It fails in every other case. Among them is the one a "skipped means passed" rule gets wrong: shards
skipped because `changes` itself failed. The test runs the job's script for every combination of
results:

```bash
pnpm --filter @crawlmouse/web exec vitest run __tests__/security/ci-workflow.test.ts
```

## D7 — measured, not estimated

The billable minutes per run, the 7-day projection and the measurement method are in the pull request
description. The `/timing` endpoint reports 0 while the repository is public, so minutes are taken from
each job's start and end, rounded up per job as GitHub bills them.

## D8, D9

The docs updated in this step:

- `PROJECT_OVERVIEW.md` §9 and the ⚠ block after §10;
- `docs/ops/db-migrations.md`;
- `docs/ops/security-baseline.md`;
- `docs/specs/v2/sec-baseline.md`;
- `docs/OPERATING-RULES.md` §7.

Out of this step:

- the flip itself;
- the showcase repository;
- moving to an organisation;
- self-hosted runners;
- the coding-session token;
- any product code.

## The owner's checklist

0. **Before the flip:**
   - Settings → Environments → `spike` → Delete environment (no workflow uses it; it would lose its
     only protection).
   - Settings → Environments → `production` → remove `SUPABASE_SERVICE_ROLE_KEY`, which no workflow
     reads (`grep -rn SUPABASE_SERVICE_ROLE_KEY .github` prints nothing).
   - Actions → **DB apply to production** and **DB rollback on production**: no run is waiting. Never
     re-run a run created before CC-REPO merged.
1. **After merging:** Settings → General → Danger Zone → Change repository visibility → Private.
2. **Check, after the flip:**
   - CI runs on the next push, `codeql` shows as skipped and `semgrep` passes;
   - the Vercel production deploy still builds from `main`;
   - the Fly staging deploy (`worker-staging.yml`) still runs on a push to `main`;
   - the required checks still apply to `main`. This must list the eleven contexts:
     `gh api repos/sikder13/crawlmouse/rules/branches/main --jq '.[] | select(.type=="required_status_checks") | .parameters.required_status_checks[].context'`.
     If it lists nothing, `main` has lost its required checks: say so before anything else merges;
   - the owner check refuses a run that is not the owner's own dispatch from `main`. That is
     shown by the D2 test; do not dispatch production to check it.
3. **Budget:** Settings → Billing and licensing → Budgets and alerts → an Actions budget, starting at
   $50 a month with "stop usage" on, sized from D7's numbers.
4. **Actions defaults:** Settings → Actions → General → Workflow permissions → **Read repository
   contents**, and untick **Allow GitHub Actions to create and approve pull requests**. Every workflow
   here declares its own permissions, so this changes nothing today. It sets the default for a
   workflow that forgets to.
5. **Recommended:** a fine-grained token for coding sessions, scoped to this repository with these
   permissions and no Actions write, so a session cannot dispatch a workflow:
   - Contents: read/write;
   - Pull requests: read;
   - Actions: read;
   - Commit statuses: read;
   - Metadata: read.
6. **Recommended:** a narrower credential for the dry run than an account-wide Supabase token (D1,
   "What it does not cover").
