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
   2. wait for Supabase's replay of production's history onto the branch to finish (every step of
      the branch's latest workflow run ended, on two polls in a row), and fail unless the branch
      recorded every migration production records. The failure names the first missing migration
      and its error: the run log's first error line when Supabase kept a log, otherwise the error
      its recorded statements raise on the branch, run in a transaction that is rolled back. The
      branch reports healthy before its replay has run, so this step comes before any comparison;
   3. compare the branch's fingerprint (`infra/supabase/checks/fingerprint.sql`) with
      production's, section by section, and fail on a difference;
   4. read the branch's migration history: fail if it needs the repair in §5, if a pending file
      has no rollback, or if the pull request changes a migration file that is already applied
      (production would never receive the change: add a new migration instead). A changed file
      whose history row holds exactly its bytes, as one statement, passes: it was applied before
      the merge, as in §9;
   5. `supabase db push`, after checking that the CLI's list equals the pending files;
   6. run the checks in §6;
   7. run each pending file again in its own transaction, and fail if the fingerprint changes;
   8. run the rollbacks in reverse order, and fail unless the fingerprint equals production's;
   9. `supabase db push` again, and fail unless the fingerprint equals the first push's;
   10. if the pull request changes the rollback of an applied migration, revert the migrations
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
  queued rollback. The two can run at the same time, but not overlap: the apply takes an advisory lock before its
  checks and holds it to the end of `supabase db push`, and the rollback waits for it (two minutes
  at most, then it fails) before it locks the history table and checks the order, so it sees any
  migration the push recorded. A rollback that commits first is seen by the apply's checks.
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

Production on 2026-11-05, after the owner recorded 003, 005, 007 and 006b, as the command above
printed it (unedited):

```text
target: ezspnfeyzwsisymytssm (read-only)
43 migration files, 36 history rows
recorded under the file's version, with statements: 7
recorded under another version (--repair renames): 19
  20260526055250 rls_rate_limits -> 20260526000001
  20260526055318 function_search_path -> 20260526000002
  20260601093225 stripe_events -> 20260601000001
  20260601093243 audits_ttl -> 20260601000002
  20260601093247 email_events -> 20260601000003
  20260601173159 user_provisioning -> 20260601000004
  20260601174725 rls_perf_hardening -> 20260601000005
  20260601182311 audits_anon_session_idx -> 20260601000006
  20260601190311 public_reports_denormalize -> 20260601000007
  20260601190332 embed_view_increment -> 20260601000008
  20260601190334 takedown_rls_lockdown -> 20260601000009
  20260601190840 share_fns_invoker -> 20260601000010
  20260601192720 share_security_followups -> 20260601000011
  20260601194136 rate_limit_fn_grants -> 20260601000012
  20260602054456 harden_users_entitlement_grants -> 20260602000013
  20260603184443 waitlist -> 20260603000014
  20260614094249 audit_canceled -> 20260614000001
  20260617204256 engine_v2_crawl_health -> 20260617000001
  20261103220014 v2_001_entitlement_tables -> 20261101000001
recorded with no executable statement (--repair adds the file's bytes): 9
  20260707000001 audit_progress_notify
  20260707000002 public_reports_visibility
  20260707000003 spec04_column_privilege_hardening
  20260707000004 public_reports_client_insert_revoke
  20260707000005 domain_verifications_client_write_revoke
  20261102000001 v2_003_sites_checks
  20261102000002 v2_005_sharing_columns
  20261102000003 v2_007_storage
  20261103000001 v2_006b_ledger_usage
rows with no file (--repair --drop-orphan <version> deletes): 1
  20260601174823 harden_handle_new_user_grants
    statement md5 e5480a18f72bc2a3c61027b38a8a1d12
files with no row: 8
  20260629000001 spec02_conversion_core
  20260629000002 fixes_service_role_only
  20260708000001 spec05_ai_readiness
  20260727000001 spec05_pages_ai_signals_privilege
  20260804000001 spec51a_stage4_refusal_coverage_fingerprint
  20260805000001 spec51a_stage5_frontier_checkpoint
  20260806000001 spec51a_stage6_frontier_functions
  20260806000002 spec51a_stage6_settle_frontier_batch
```

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

**The dry run before the repair.** Run by hand on 2026-11-06 from commit `5cf0740d`, with
`pnpm exec tsx db/dry-run.ts --branch cc-db-ops-live`. Its summary, unedited:

```text
### Migration dry run: FAILED

Commit `5cf0740d`, Supabase branch `cc-db-ops-live`, finished 2026-11-06T01:25:54.798Z.

| Step | Result |
| --- | --- |
| Create the branch from production | branch uibsaranofpyfaowdjhl |
| Branch fingerprint equals the production fingerprint | FAILED: sections differ: acls (0 only on the branch, 1033 only on production), buckets (0 only on the branch, 3 only on production), columns (1 only on the branch, 456 only on production), constraints (1 only on the branch, 314 only on production), default_acls (0 only on the branch, 24 only on production), functions (1 only on the branch, 36 only on production), indexes (0 only on the branch, 110 only on production), policies (0 only on the branch, 22 only on production), relations (0 only on the branch, 30 only on production), rls (0 only on the branch, 30 only on production), roles (3 only on the branch, 5 only on production), schemas (0 only on the branch, 2 only on production), triggers (0 only on the branch, 24 only on production); the lines are in the job log |

Files applied, with the sha256 of the bytes production will receive:

_No migration files were pending._

Rollback files run:

_No rollback file was run._
```

This is defect 1 in §8 showing itself. The lines that differ are v2 objects production holds and
the branch lacks, and three lines the branch holds and production does not, traced to history
rows the branch did not replay:

- `public.public_reports.audit_id uuid not null` and its foreign key: the row for
  `20260707000002_public_reports_visibility.sql`, which drops the `not null`, is empty;
- the older `public.apply_entitlement_transition(...)`: the row for 006b, which replaces it, holds
  only a comment.

The `roles` section also held three lines that no history row explains, and that the repair would
not have cleared. The branch held three memberships production did not:

```text
+ supabase_realtime_admin member of anon admin=f inherit=f set=t
+ supabase_realtime_admin member of authenticated admin=f inherit=f set=t
+ supabase_realtime_admin member of service_role admin=f inherit=f set=t
```

Supabase granted them when it created the branch. On production this query returned no rows
(2026-11-06 UTC); run it on production and on a branch to re-measure:

```sql
select m.rolname as member, r.rolname as role, a.admin_option, a.inherit_option, a.set_option
from pg_auth_members a
join pg_roles m on m.oid = a.member
join pg_roles r on r.oid = a.roleid
where m.rolname = 'supabase_realtime_admin'
order by r.rolname;
```

`fingerprint.sql` now leaves out exactly those three memberships, through `SUPABASE_MANAGED_MEMBERS`:
a list of entries, each a role, a member and the admin, inherit and set options as the branch held
them, matched exactly
(`grep -n -A4 'supabase_managed_members(role_name' infra/supabase/checks/fingerprint.sql`). The
`roles` section reads every membership whose member is named in that list, including memberships
of roles it does not otherwise watch (`postgres`, `pg_*`, other `supabase_*` roles), and leaves out
only the listed entries. The tests show a membership by `supabase_realtime_admin` changing the
section when it is of `crawl_worker`, `research_retention`, `authenticator`, `postgres`,
`pg_read_all_data`, `pg_write_all_data` or another Supabase role; of `service_role` with the admin
option, with inherit, or without set; or of a role whose name is near one of the three. They also
show `supabase_realtime_admin` owning a table or function, or holding a grant on one, in `public`
(`pnpm --filter @crawlmouse/scripts exec vitest run db/fingerprint.test.ts -t SUPABASE_MANAGED_MEMBERS`).
`supabase_realtime_admin` granted _to_ a role is read as any membership is: when that role is one
the section watches (`grep -n -A6 'watched_roles as' infra/supabase/checks/fingerprint.sql`).

If Supabase changes what it grants a new branch, the dry run fails on the `roles` section and
names the lines. An entry is added only on the evidence above: no rows on production, rows on a
fresh branch.

On 2026-11-06 production was read through the read-only endpoint with the file as this change
leaves it, and with the ones at `796199b6` and `13875535` (`readFingerprint` with each file's
text, then `compareFingerprints`); no section differed.

**The dry run again, with the first list.** That list left out every membership by
`supabase_realtime_admin`, matched by name alone; it has since been narrowed as above. On a new
branch, from commit `a085de0c`, with
`pnpm exec tsx db/dry-run.ts --branch cc-db-ops-live-2`. Its summary, unedited:

```text
### Migration dry run: FAILED

Commit `a085de0c`, Supabase branch `cc-db-ops-live-2`, finished 2026-11-06T02:27:51.587Z.

| Step | Result |
| --- | --- |
| Create the branch from production | branch pywmdmterbvdisgghzxr |
| Branch fingerprint equals the production fingerprint | FAILED: sections differ: acls (0 only on the branch, 1033 only on production), buckets (0 only on the branch, 3 only on production), columns (1 only on the branch, 456 only on production), constraints (1 only on the branch, 314 only on production), default_acls (0 only on the branch, 24 only on production), functions (1 only on the branch, 36 only on production), indexes (0 only on the branch, 110 only on production), policies (0 only on the branch, 22 only on production), relations (0 only on the branch, 30 only on production), rls (0 only on the branch, 30 only on production), roles (0 only on the branch, 5 only on production), schemas (0 only on the branch, 2 only on production), triggers (0 only on the branch, 24 only on production); the lines are in the job log |

Files applied, with the sha256 of the bytes production will receive:

_No migration files were pending._

Rollback files run:

_No rollback file was run._
```

The `roles` section now holds no line only on the branch. Its five lines only on production are
`crawl_worker` and `research_retention` with their memberships, which 007 and 006b create and whose
history rows hold only a comment. The other sections' counts match the first run's summary above.

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
- **`07-partition-triggers.sql`**: Every partition holds each row and TRUNCATE trigger its parent table holds. For each partition of a table in public, research or partitions, each row trigger and each TRUNCATE trigger on its parent must exist on the partition under the same name, calling the same function. Postgres copies row triggers to a new partition; it copies no statement trigger, and v2_premake_month_partitions creates the TRUNCATE guards per partition. Other statement triggers stay on the parent and are not required here. The fingerprint merges the lines of a table's partitions, so a trigger missing from one partition shows only here.

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

## 9. Parity and v1 hardening (applied once, by the owner)

A branch built from production differs from it in three catalog sections after its replay has
finished: `acls`, `default_acls` and `buckets`. Supabase creates a branch without default
privileges on the public schema, production has 24 of them, and the v1 tables and functions got
grants from them on production that a replay does not give. `report-logos` was made by hand. The
measured lines are in `scripts/db/fixtures/2026-11-06-settled-branch-vs-production.json`. Two
migrations close the difference, so the dry run can pass:

- **P1**, `20261106000001_service_role_parity.sql`, writes down the `service_role` lines and the
  bucket. Production already holds them, so its fingerprint must not change. Its rollback does
  nothing, on purpose: see the file.
- **P2**, `20261106000002_v1_client_grant_hardening.sql`, revokes everything `anon` and
  `authenticated` hold on the 18 v1 tables and 2 v1 functions, and their default privileges in
  `public`, then grants back what code running as a signed-in user reads: `users (id, pro_until,
stripe_customer_id)`, nine columns of `audits` for the dashboard, and six of
  `domain_verifications` for the verify page. `anon` keeps nothing on them. The file names the
  caller of each grant. It changes production: the lines it removes and adds are in
  `scripts/db/fixtures/20261106000002-expected-change.json`. Approved by the owner on 2026-11-06,
  with one reader left without grants: the tRPC procedures `audits.getById` and `audits.listMine`
  (`apps/web/lib/trpc/router.ts`) have no caller, and answer `query_failed` after P2
  (`scripts/db/hardening.test.ts` runs their queries and expects the refusal).

**After P2, tables created in `public` get no client privileges by default.** Production then
behaves as a branch does. Each migration grants `anon` and `authenticated` what it needs,
explicitly; the dry run shows a missing grant, because the branch has no default privileges
either. A migration must sort after `20261106000002`, or the CLI refuses to push it once P2 is
recorded.

Neither can pass a dry run while pending: the branch would lack production's lines at the
fingerprint step. Each reaches production once, by `supabase db push` from this repository's
checkout, which applies the file's bytes and records its history row. Not the SQL editor.

**Applied on 2026-11-06 through the Supabase MCP, not `supabase db push`:** each file ran as one
transaction with its history row inserted from its exact bytes (sha256 `560af38b…77050c7` and
`2ecba08d…fc81e27`; 45 history rows). Checked: P1 left all 15 fingerprint sections unchanged; P2
removed exactly the fixture's 359 lines and added its 9, the other 13 sections' md5 unchanged;
`anon` is refused on `audits`, `users` and `public_reports`; `authenticated` reads
`users.pro_until`, the dashboard's `audits` query and `domain_verifications`; the Postgres logs show
no permission-denied error.

**P1.** From the `build/cc-db-ops` checkout at commit `6de90b21`, which has P1 and not P2, with
Node 22, `pnpm install` done, Supabase CLI 2.84.2 on the path (`supabase --version`), and the
session pooler's connection string from the dashboard's **Connect** dialog. `~/db-apply` holds the
fingerprints and, for P2, a dump of production's rows: keep it out of any synced folder. Run each
block from the repository root. The sha256 must read
`560af38b00fe6e692e8c0595a76792ad4569beb260c52b0d66bca6bab77050c7`, the bytes reviewed; if not, stop.

```bash
git checkout --detach 6de90b21
sha256sum infra/supabase/migrations/20261106000001_service_role_parity.sql
cd scripts
read -rs DB_URL && export DB_URL
install -d -m 700 ~/db-apply
pnpm exec tsx db/fingerprint.ts --db-url-env DB_URL --yes-production --out ~/db-apply/p1-before.json
cd ..
supabase --workdir infra db push --db-url "$DB_URL" --dry-run
```

The listing must name exactly one file, `20261106000001_service_role_parity.sql`. If it names any
other, stop. Then:

```bash
supabase --workdir infra db push --db-url "$DB_URL"
cd scripts
pnpm exec tsx db/fingerprint.ts --db-url-env DB_URL --yes-production --out ~/db-apply/p1-after.json
pnpm exec tsx db/fingerprint.ts --before ~/db-apply/p1-before.json --after ~/db-apply/p1-after.json
pnpm exec tsx db/history.ts --db-url-env DB_URL --yes-production
pnpm exec tsx db/check.ts --db-url-env DB_URL --yes-production
```

The comparison must print `no change, as expected`. The history read must show every file recorded
under its own version, with nothing renamed, empty, orphaned or unrecorded. The checks must pass.
Any other result: stop and report it; P1 has no rollback that would change production.

**P2**, after P1 has been applied and checked. From the same checkout at the head of
`build/cc-db-ops`, with the same setup. Take the dump first; it holds every row of `public`, so it
stays in `~/db-apply` and is deleted when this section ends, whichever way it ends. The sha256 must
read `2ecba08d2551dd9ce4ead8d7193cf993a1b9f3e48bf6e3557a4d7dab0fc81e27`, the bytes reviewed and
approved; if not, stop:

```bash
git checkout build/cc-db-ops
sha256sum infra/supabase/migrations/20261106000002_v1_client_grant_hardening.sql
cd scripts
read -rs DB_URL && export DB_URL
umask 077
pg_dump "$DB_URL" --schema=public --format=custom --file ~/db-apply/public-before-p2.dump
pg_restore --list ~/db-apply/public-before-p2.dump | head -5
pnpm exec tsx db/fingerprint.ts --db-url-env DB_URL --yes-production --out ~/db-apply/p2-before.json
pnpm exec tsx db/fingerprint.ts --before ~/db-apply/p1-after.json --after ~/db-apply/p2-before.json
cd ..
supabase --workdir infra db push --db-url "$DB_URL" --dry-run
```

`pg_restore --list` must print the dump's table of contents. The second comparison must print `no
change, as expected`: production has not moved since P1. The listing must name exactly one file,
`20261106000002_v1_client_grant_hardening.sql`. Then:

```bash
supabase --workdir infra db push --db-url "$DB_URL"
cd scripts
pnpm exec tsx db/fingerprint.ts --db-url-env DB_URL --yes-production --out ~/db-apply/p2-after.json
pnpm exec tsx db/fingerprint.ts --before ~/db-apply/p2-before.json --after ~/db-apply/p2-after.json --expect db/fixtures/20261106000002-expected-change.json
pnpm exec tsx db/history.ts --db-url-env DB_URL --yes-production
pnpm exec tsx db/check.ts --db-url-env DB_URL --yes-production
```

The comparison must print `exactly as db/fixtures/20261106000002-expected-change.json lists`. If
it prints anything else, P2 is already recorded: revert it with the commands below, then report the
printed lines; do not push it again. Otherwise take the live smoke on https://crawlmouse.com, each
step in a fresh private window:

1. Sign in by magic link at `/login`: the emailed link lands you signed in.
2. Start an audit from the home page on a small site: it runs to a grade.
3. Open a public report, `/r/<slug>` (one from a `/top/` leaderboard): it renders with its grade.
4. Load an embed badge, `/embed/<domain>` for that report's domain: the badge renders.
5. Open `/dashboard` while signed in: your audits are listed and the plan shows.
6. Open `/verify/<id>` for a domain verification you started (from a report's verify flow): the
   page shows the domain and its token.
7. Signed in as a Pro account, open `/api/billing/status`: it returns `{"pro":true}`. Then `/billing`
   opens the Stripe portal. The Pro check returns false rather than an error when it cannot read
   `users.pro_until`, so a non-Pro account would not show that grant missing.

Each must work, and Sentry must show no new `permission denied` error from these minutes. If any
step fails, revert P2 and take the smoke again:

```bash
cd scripts
pnpm exec tsx db/rollback.ts --db-url-env DB_URL --file 20261106000002_v1_client_grant_hardening.revert.sql --yes-production
pnpm exec tsx db/fingerprint.ts --db-url-env DB_URL --yes-production --out ~/db-apply/p2-reverted.json
pnpm exec tsx db/fingerprint.ts --before ~/db-apply/p2-before.json --after ~/db-apply/p2-reverted.json
```

The rollback runs in one transaction, removes P2's history row, and runs the checks; the comparison
must print `no change, as expected`. Last, on every path (smoke passed, smoke failed and P2
reverted, or a mismatch reported): `rm ~/db-apply/public-before-p2.dump`. Once both are applied and checked, re-run the pull request's
dry run: it must pass, and that run is the merge gate.
