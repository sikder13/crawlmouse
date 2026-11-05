# Database migrations: from pull request to production

A migration reaches production through three GitHub Actions workflows. The owner approves each
production change in GitHub after seeing the exact files and their sha256. The bytes that run are
the tracked files: `supabase db push` reads `infra/supabase/migrations` in place
(`--workdir infra`), and a rollback runs a file from `infra/supabase/rollbacks`. Nothing is pasted
into the SQL editor.

| Workflow               | Runs when                                                           | Touches                         |
| ---------------------- | ------------------------------------------------------------------- | ------------------------------- |
| `db-dry-run.yml`       | a pull request changes `infra/supabase/**` or the tooling           | a Supabase branch of production |
| `db-apply-prod.yml`    | a push to `main` changes `infra/supabase/migrations/**`, or by hand | production, after approval      |
| `db-rollback-prod.yml` | by hand only, with a rollback file name                             | production, after approval      |

The scripts behind them are in `scripts/db`. Their tests:
`pnpm --filter @crawlmouse/scripts exec vitest run db`.

## 1. A migration, from pull request to production

1. **Write the migration and its rollback.** `infra/supabase/migrations/<version>_<name>.sql` and
   `infra/supabase/rollbacks/<version>_<name>.revert.sql`. The dry run fails on a pending migration
   with no rollback file.
2. **Open the pull request.** `db-dry-run.yml` runs `scripts/db/dry-run.ts` on a Supabase branch
   named `pr-<number>`. The steps, in order:
   1. delete any branch of that name, create it again from production, and wait for it to build;
   2. compare the branch's fingerprint (`infra/supabase/checks/fingerprint.sql`) with
      production's, section by section, and fail on a difference;
   3. read the branch's migration history: fail if it needs the repair in §5, if a pending file
      has no rollback, or if the pull request changes a migration file that is already applied
      (production would never receive the change: add a new migration instead);
   4. `supabase db push`, after checking that the CLI's list equals the pending files;
   5. run the checks in §6;
   6. run each pending file again in its own transaction, and fail if the fingerprint changes;
   7. run the rollbacks in reverse order, and fail unless the fingerprint equals production's;
   8. `supabase db push` again, and fail unless the fingerprint equals the first push's;
   9. if the pull request changes the rollback of an applied migration, revert the migrations
      from that one on, newest first, push them again, and fail if the fingerprint changes.

   The branch is deleted at the end of the run, pass or fail, and again when the pull request
   closes (`db-dry-run-cleanup.yml`). The summary, with the sha256 of each file applied and each
   rollback run, is posted on the pull request and kept as the `db-dry-run-summary` artifact for
   90 days. A pull request opened by Renovate gets no dry run (§7).

3. **Merge.** The push to `main` starts `db-apply-prod.yml`. Its `plan` job needs no approval and
   reads production through the Management API's read-only endpoint. It finds the merged pull
   request and its newest completed dry run, which must have passed, downloads that run's
   summary, and lists production's pending files. It refuses when a pending file is not in that
   dry run, when its sha256 differs from the bytes the dry run applied, or when production's
   fingerprint differs from the one the dry run read
   (`pnpm --filter @crawlmouse/scripts exec vitest run db/production.test.ts`).
4. **Approve.** The `apply` job waits on the `production` environment. Once approved, it checks
   that production's pending files still equal the manifest the `plan` job printed and that
   production's fingerprint still equals the one the `plan` job read, runs
   `supabase db push`, runs the checks, and writes the fingerprint to the job summary. A failure
   opens an issue. The workflow does not retry, and it does not run a rollback.

Migration files are append-only. The `migrations-append-only` job in `ci.yml` runs on every push
and pull request and fails on any change under `infra/supabase/migrations` other than an added
file (a modification, deletion, rename or a file swapped for a symlink), so it can be made a
required check. On a pull request that touches the database, the dry run also refuses an edit to
an applied migration.

A merge that changes no migration file does not start `db-apply-prod.yml`. To apply files whose
pull request was merged earlier, run the workflow by hand from `main` and give `dry_run_pr` the
number of a merged pull request whose passed dry run applied those files.

## 2. What the owner sees before approving

In the run of `db-apply-prod.yml`, before the **Review deployments** button:

- the `plan` job's summary: a table of the pending files with the sha256 of each, then the dry
  run's own summary: its steps, its commit, and the sha256 of each file it applied. Matching
  hashes in both tables are what the gate already checked.
- the link to the dry run, in the `plan` job's log (`pull request #N, dry run <url>`).

To check a hash against the repository yourself:
`git show <commit>:infra/supabase/migrations/<file> | sha256sum`.

## 3. Reading a failed dry run

The pull request comment names the failed step. The job log has the full output.

- **Branch fingerprint equals the production fingerprint** failed. The branch Supabase built from
  production's migration history does not match production in what `fingerprint.sql` reads (its
  header lists that, and what it leaves out). The comment names each differing section and counts
  its lines; the job log lists the lines, `+` on the branch only, `-` on production only, with
  definitions shown as md5s. Likely causes:
  - a change made to production outside a migration;
  - a history row whose statements do not hold what production ran;
  - something Supabase sets up differently on a new branch than on production (an owner, a
    platform role's setting). This shows as the same lines on every pull request, whatever it
    changes.

  The months of the monthly partitions are not a cause: the fingerprint normalises them. Do not
  apply over a difference. Report the sections. Bringing production back in line is a migration of
  its own, with its own pull request; a platform difference is reported, and the fingerprint is
  changed in a reviewed pull request only if the difference is shown to be the platform's.

- **History is clean and each pending file has a rollback** failed. Either production's history
  needs the repair in §5, or a pending migration has no rollback file.
- **supabase db push** failed. The CLI's error is in the log. A file that fails to apply leaves
  the files before it applied on the branch, which is discarded.
- **Checks** failed. Each finding names an object and what is wrong with it (§6).
- **Each file runs again and changes nothing** failed. A migration is not re-runnable: the second
  run errored, or it changed the catalog.
- **Rollbacks in reverse order restore the production fingerprint** failed. A rollback errored, or
  left a difference from production, named by section as above.

A pull request from a fork gets no secrets, so its dry run fails at the first step that needs the
access token.

## 4. Rolling back on production

Run **DB rollback on production** (`db-rollback-prod.yml`) from `main`, with the rollback's file
name, for example `20261102000003_v2_007_storage.revert.sql`. Its `plan` job, before the
approval, shows the rollback file's sha256 and its migration's, and refuses a rollback that is not
of the newest migration production records. The `rollback` job waits on the same `production`
approval, requires the planned sha256, runs the file's bytes and deletes the migration's history
row in one transaction, then runs the checks and writes the fingerprint to the job summary.

- It refuses a name that is not a file in `infra/supabase/rollbacks` with a matching migration,
  a migration the history does not record as applied, and any but the newest recorded migration,
  so rollbacks run newest first, one per run. The order is checked by the plan and again inside the
  rollback's transaction, after it locks the history table, so an apply approved in between is
  seen (`pnpm --filter @crawlmouse/scripts exec vitest run db/production.test.ts db/rollback.test.ts`).
- A rollback changed in a pull request is run on the branch by the dry run's step 9 before it
  merges. Check its comment before dispatching. Step 9 reverts every migration from the changed
  one on, so it fails when one of them has no rollback file: adding a rollback for an old v1
  migration needs rollbacks for the migrations after it too.
- Rollback and apply runs queue in separate groups: a push that queues an apply does not cancel a
  queued rollback. The two can run at the same time, but not overlap: the apply holds an advisory lock for the
  whole of `supabase db push`, and the rollback waits for it before it locks the history table and
  checks the order, so it sees any migration the push recorded.
- 007's rollback refuses while the `evidence` or `reports` bucket holds objects, and gives the
  count per bucket. Empty them through the Storage API first. It sets
  `storage.allow_delete_query` for its own transaction, which `storage.protect_delete()` requires.
- 003's rollback drops its tables with their rows. Take a `pg_dump` of `public` first.

## 5. Repairing the migration history (once, before the first automated apply)

Supabase builds a branch by replaying the `statements` recorded in production's
`supabase_migrations.schema_migrations`, and `supabase db push` refuses to run while a history row
names a version with no file. Production's history was written by hand and does not meet either
need, so the dry run fails at its "history" step until the owner runs the repair once.

`scripts/db/history.ts` prints the difference between the files and the history:

- rows recorded under another version (the time they were applied): `--repair` renames them to
  their file's version and keeps their statements, which are what production ran;
- rows with no executable statement (empty, or only a comment): `--repair` adds the file's bytes,
  after any comment the row holds;
- rows with no file: each must be named with `--drop-orphan <version>`, which deletes it;
- files with no row: `--repair` inserts each one up to `--applied-through` with the file's bytes.
  Files after it stay unrecorded, for `supabase db push`.

The repair writes only to the history table, through four fixed statements with the file bytes as
bound parameters, in one transaction that re-reads the history and rolls back unless the result is
what the plan promised (`pnpm --filter @crawlmouse/scripts exec vitest run db/history.test.ts`).
It refuses production without `--yes-production`.

**Read production first.** With a Supabase access token (Account → Access Tokens) in the
environment:

```bash
cd scripts
read -rs SUPABASE_ACCESS_TOKEN && export SUPABASE_ACCESS_TOKEN
pnpm exec tsx db/history.ts --project-ref ezspnfeyzwsisymytssm --yes-production
```

<!-- history:start -->
<!-- history:end -->

The row with no file, `20260601174823 harden_handle_new_user_grants`, holds one statement:
`revoke all on function public.handle_new_user() from public, anon, authenticated;`. The same line
is in `infra/supabase/migrations/20260601000004_user_provisioning.sql` and in
`infra/supabase/migrations/20261101000001_v2_001_entitlement_tables.sql`
(`grep -n 'revoke all on function public.handle_new_user' infra/supabase/migrations/*.sql`), so
deleting the row loses nothing a replay needs.

**Then repair.** The connection string is the session pooler's, from the dashboard's **Connect**
dialog, with the database password:

```bash
cd scripts
read -rs DB_URL && export DB_URL
pnpm exec tsx db/history.ts --db-url-env DB_URL --yes-production \
  --repair --applied-through 20261103000001 --drop-orphan 20260601174823
```

Afterwards the read above prints no renamed, empty or orphan rows, and no files without a row.
Then re-run the pull request's dry run.

## 6. The checks

Each file in `infra/supabase/checks` named `NN-<name>.sql` returns rows only when something is
wrong; no rows is a pass. `scripts/db/check.ts` runs them against a target and fails on any row.
`pnpm --filter @crawlmouse/scripts exec vitest run db/check.test.ts` shows each one failing on
what it guards. The list below is rendered from the files' leading comments, and
`scripts/db/docs.test.ts` fails when it differs from them.

<!-- checks:start -->

- **`01-client-table-privileges.sql`**: Client roles hold exactly the declared privileges on the v2 tables. anon holds nothing on any v2 table or partition. authenticated and crawl_worker hold exactly the grants in this file's `declared` list, at the table or column level: a privilege held but not listed, or listed on an existing table and column but not held, is a finding. The v2 tables are the ones in its `v2_tables` list, every relation in the research and partitions schemas, and every partition, in any schema, of a table in those schemas or public. A table, column or role that does not exist yet (a migration not applied) is skipped; scripts/db/check.test.ts requires every listed table to exist once the migrations have run. A migration that changes these grants changes this list in the same pull request.
- **`02-partitions-rls-owner-only.sql`**: Every partition has row-level security on and an owner-only ACL. Every relation in the partitions schema, and every partition (in any schema) of a table in public, research or partitions, must have RLS enabled, and its ACL may name only the table's owner: no client role, no PUBLIC, no other role. Supabase's own partitioned tables are left out.
- **`03-worker-roles-no-login.sql`**: crawl_worker and research_retention cannot log in, bypass row-level security, or reach a role that can. Neither role may log in, bypass RLS, be a superuser, create roles or databases, or replicate, and neither may be a member (directly or through other roles) of a role that bypasses RLS or is a superuser. Both are meant to be assumed through SET ROLE or a signed token. A role that does not exist yet (its migration not applied) is skipped.
- **`04-private-schemas.sql`**: The research and partitions schemas grant no USAGE or CREATE to client roles. anon and authenticated (and PUBLIC, which both inherit) may not use or create objects in either schema. A schema that does not exist yet is skipped.
- **`05-private-buckets.sql`**: The evidence and reports buckets are private. A bucket that does not exist yet is skipped.
- **`06-client-functions.sql`**: In public, research and partitions, authenticated may execute exactly is_member, member_role, is_member_for_site and usage_counts. anon may execute none of their functions, and authenticated only the four listed in `declared`. An existing listed function authenticated cannot execute is also a finding. Functions that belong to an extension are left out.
- **`07-partition-triggers.sql`**: Every partition holds each trigger its parent table holds. For each partition of a table in public, research or partitions, each trigger on its parent must exist on the partition under the same name, calling the same function. Postgres copies row triggers to a new partition, but not statement triggers: the append-only TRUNCATE guards are created per partition by v2_premake_month_partitions. The fingerprint merges the lines of a table's partitions, so a trigger missing from one partition shows only here.

<!-- checks:end -->

`fingerprint.sql` is not a check: it returns an md5, a count and the lines of each catalog section,
so two databases can be compared section by section.

## 7. Secrets and environments

| Where                           | Name                    | Used by                                                        |
| ------------------------------- | ----------------------- | -------------------------------------------------------------- |
| GitHub environment `db-dry-run` | `SUPABASE_ACCESS_TOKEN` | the dry run, the branch clean-up, and the read-only `plan` job |
| GitHub environment `production` | `SUPABASE_ACCESS_TOKEN` | the `apply` and `rollback` jobs (pooler lookup, read-only)     |
| GitHub environment `production` | `SUPABASE_DB_PASSWORD`  | the `apply` and `rollback` jobs                                |

A branch's database password comes from the Management API at run time and is masked in the log
before use. `production` has a required reviewer (the owner) and accepts deployments from `main`
only.

**What the access token can do.** A Supabase access token acts for the whole account, including
writing to production through the Management API. The dry run needs one to create branches, so a
workflow or script changed on a pull request branch runs with it. This is accepted: the owner is
the repository's only writer, pull requests from forks receive no secrets, and the dry-run job
does not run on pull requests opened by Renovate, which would otherwise run updated third-party
code with the token before review.

**What the dry-run summary proves.** It is written by the pull request's own workflow and scripts,
so a pull request that changes them can write any summary. The gate in `db-apply-prod.yml` checks
the bytes against that summary; review of the pull request and the `production` approval are what
stand behind the summary itself.

## 8. What this replaced

Until 2026-11-05 the owner applied each v2 migration by pasting it into the SQL editor, while a
reviewer ran catalog checks by eye. On 2026-11-04 that process found three defects:

1. **The dry-run branch was not a copy of production.** Supabase builds a branch from production's
   recorded history, which lacked migrations: read on 2026-11-05, eight files had no row and five
   rows had no statements. The dry run now compares fingerprints first and stops on a difference.
2. **The 007 rollback could not run on current Supabase.** `storage.protect_delete()` refuses
   `delete from storage.buckets` unless `storage.allow_delete_query` is set. The rollback now sets
   it for its own transaction, and refuses while a bucket holds objects.
3. **Production recorded 001 under a version that is not its file name.** Eighteen v1 migrations
   were recorded the same way. The repair in §5 renames them.

On 2026-11-05 a fourth turned up. The rows recorded for 003, 005, 007 and 006b after the owner
applied them hold only a comment naming each file and its sha256, so a branch would replay none of
them. The diff counts such a row as having no statements, and the repair adds the file's bytes
after the comment.
