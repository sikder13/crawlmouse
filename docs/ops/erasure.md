# Erasing a person's data

How to act on a request to delete someone's data (CC-V1FIX B-F2). The database part is
`scripts/ops/erase-account.ts`; the rest is done by hand in the services listed below.

The rules are SQL functions in migration `20261112000002` section B (`erase_person_plan`,
`erase_person_apply`, `erase_auth_audit_log`, `erase_person_counts`, with one row per rule in
`erase_rules`), and the sequence around them is `apps/web/lib/v2/account/erase.ts`. The script and the
in-app purge (§8) both run that sequence, so a rule changed in one place changes for both.

Tests: `pnpm --filter @crawlmouse/scripts exec vitest run ops/erase-account.test.ts` (PGlite with
the repository's migrations), `pnpm --filter @crawlmouse/web exec vitest run lib/v2/account/erase.test.ts
lib/v2/account/deletion-purge.test.ts __tests__/v2-027b-b-deletion.test.ts` and, for the cascade the
erasure relies on, `pnpm --filter @crawlmouse/web exec vitest run __tests__/users-auth-cascade.test.ts`.

## 1. Confirm who is asking

Act only on a request sent from the address being erased, or confirmed by a reply from it. Note
the request's date; the reply in §6 goes back to that address.

## 2. Billing first

The script refuses while `users.pro_until` is in the future or the person's account has a
subscription whose status is not `canceled` or `incomplete_expired`. In the Stripe dashboard:

1. cancel the subscription immediately (not at period end), and refund if that was agreed;
2. delete the Stripe customer. Stripe keeps what it must for tax and fraud law; that is Stripe's
   record, not ours.

Then run the dry run (§3) again: it names any refusal still standing, so it shows when the
webhook has caught up.

## 3. Dry run

From a checkout of `main`, with the production database URL in an environment variable (never on
the command line), and `TRIAL_LEDGER_PEPPER` set to production's value: the mail ledger names a
person by a hash of their address under it (CC-28), and without it the plan refuses with
`mail_pepper` rather than leave those rows behind:

```bash
pnpm --filter @crawlmouse/scripts exec tsx ops/erase-account.ts --db-url-env DB_URL --email person@example.com --yes-production
```

`--user-id <uuid>` instead of `--email` when the address names more than one user. The dry run
changes nothing and prints:

- by table, the rows `--yes` deletes or changes, and, of what cascades from the accounts it
  deletes, the sites, checks and reports;
- what is kept (§5);
- the storage objects to delete in §4;
- the reasons it refuses, if any. **Other people are seated on it** means the person owns an
  account with other active members: ownership has to be transferred to one of them first.
  **Storage objects are still stored** means §4 is not done yet.

## 4. Storage objects

SQL cannot delete Storage objects (Supabase's `protect_objects_delete` trigger), so they go
through the Storage API, before `--yes` removes the rows that name them. For each line
`<bucket>/<path>` the dry run printed: Supabase dashboard → Storage → the bucket → select the
object → Delete, or the Storage API's remove call with the service-role key. Run the dry run again:
the list is read from `storage.objects`, so it is empty, and that refusal gone, once they are.

## 5. Erase

```bash
NEXT_PUBLIC_SUPABASE_URL=https://ezspnfeyzwsisymytssm.supabase.co SUPABASE_SERVICE_ROLE_KEY=… pnpm --filter @crawlmouse/scripts exec tsx ops/erase-account.ts --db-url-env DB_URL --email person@example.com --yes --yes-production
```

In one transaction it nulls or deletes the rows that hold the address or the user id outside the
person's own rows: the Auth audit log's entries, `notify_email` on audits that are not theirs and on
checks of sites outside their accounts, `email_events`, `waitlist`, the address in another user's
`users.previous_emails`, invitations on other accounts, report recipients and client contacts on
other accounts, `fix_email_requests` outside their accounts that one of their seats made or that are
addressed to them, rate-limit keys ending in `:<address>` or `:<user id>`, and closed takedown
requests' address. The addresses are the one given, the user's own, and `users.previous_emails`
(the addresses an email change moved away from), less any previous address another person now signs
in with: that one is theirs, and the dry run counts it under "kept". It deletes the accounts on which the person is the only active member, with
what cascades from them. Each change must touch the rows the dry run counted, or the transaction
is rolled back and nothing changes. Then it deletes the auth user through the Auth admin API, which
deletes `public.users` and what cascades from it. It prints every count again, read with the same
user id, addresses and accounts, and the storage objects still listed; each reads 0 when the
erasure is complete (`scripts/ops/erase-account.test.ts`). A failure after the transaction (the
Auth call) leaves the user in place: run the same command again.

Kept, by the owner's ruling (CC-V1FIX Q5), and printed under "kept":

- `trial_ledger` rows: peppered hashes, not addresses, kept so a second free trial can be refused;
  their account reference is set null.
- takedown requests the person filed that are still open; a closed one keeps the request with the
  address replaced by `redacted@erased.invalid` (the column cannot be null).
- public reports the person minted: a report is about a domain, so it stays with `minted_by` set
  null. Removing one is the takedown flow's.

## 6. Outside the database

- **PostHog** (project 448922): Persons → find by the user id → Delete person, with its events.
- **Resend**: remove the address from any audience and suppression list it appears in.
- **Sentry**: events may carry the user id; delete by searching for it if any are found.
- **Inngest, Vercel and Supabase logs (the Auth logs in Supabase's log explorer among them) and
  backups** expire on their own retention; say so in the reply rather than promising an immediate
  purge.

## 7. Reply

> We have deleted your Crawlmouse account and the data linked to it: your profile, your audits
> and sites, your sign-in records and the places your address was stored. A few things are kept:
> one-way fingerprints (of your address, and of the device, network and card used for a trial),
> used only to stop a second free trial, any takedown request of yours that is still open, and public reports you published,
> which no longer name you. Copies in our providers' logs and backups are deleted on their normal
> schedules. Payment records that Stripe must keep by law stay with Stripe.

Keep a note of the request date, the dry-run counts and the date of `--yes` with the request.

## 8. The in-app deletion (CC-27b D4)

An owner can delete their account from Settings without this runbook. What happens, and where:

1. **Request** (`DELETE /api/account`, `request_account_deletion`): the owner re-types the primary
   site's host (the sign-in address with no site). Refused while another person is seated, while
   `users.pro_until` is in the future, or while an email change is in flight. One email goes to the
   sign-in address with a confirmation link (24 hours) and a restore link.
2. **Confirm** (the link's page, then `POST /api/account/delete/confirm`, `confirm_account_deletion`):
   every account the person alone holds is marked (`accounts.deletion_confirmed_at`, `purge_after`
   seven days on), the person is queued in `pending_erasures`, their sessions end and the Auth user is
   banned. Nothing is deleted. `deletionCancelFn` sets an `active` or `trialing` plan to end at its
   period's end (CC-03's cancel) and records in `deletion_cancellations` whether it did; a past-due,
   unpaid or paused plan is left for the purge to cancel at once, so a restore never finds a plan the
   deletion ended.
3. **Restore** (`POST /api/account/restore`, `restore_account`), inside the seven days: the marks and
   the queue row are cleared, the ban is lifted, and `deletionResumeFn` continues a plan the deletion
   set to end (not one the person had already set to end, or one Stripe ended at once).
4. **Purge** (`purgeDeletedAccountsFn`, daily at 03:30 UTC, registered only with
   `V2_CHECKS_PUBLIC=1`): for each person past the window it bans again, cancels any live
   subscription at once with no proration, and runs the erasure above with the Storage objects removed
   through the Storage API and `p_require_due` (the apply locks the queue row and refuses inside the
   window). The queue row goes only after the Auth user is gone (`finish_erasure` refuses before).
   A refusal is retried the next day and reported to Sentry with the user id only; on the run that
   has just cancelled a subscription it is not reported, because the erasure refuses until Stripe's
   webhook has recorded the cancellation.

With `V2_CHECKS_PUBLIC` unset the link routes answer 404 and the purge is not registered: nothing is
erased and nothing can be restored until the flag returns.

**What the owner checks on the migration's dry-run branch** (PGlite cannot show these):

- that `postgres`, which owns `end_user_sessions`, may delete from `auth.sessions` and
  `auth.refresh_tokens`: call it for a test user on the branch and count the rows after;
- that `postgres` may delete from `auth.audit_log_entries` (`erase_auth_audit_log`);
- that no client role holds a privilege on `vault.secrets` or `vault.decrypted_secrets`;
- that `erase_person_plan` runs on the branch for a test user (it reads `auth.users` and
  `storage.objects` as `postgres`).

Read-only on production, 2026-11-11 (the owner): `postgres` may delete `auth.sessions` and `auth.refresh_tokens`;
`supabase_vault` is installed; `anon` and `authenticated` hold no table privilege in schema `vault`;
`auth.refresh_tokens` → `auth.sessions` is `on delete cascade`. The audit-log delete and the plan's run are the
branch's to show.
