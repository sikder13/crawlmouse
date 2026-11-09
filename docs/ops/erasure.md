# Erasing a person's data

How to act on a request to delete someone's data (CC-V1FIX B-F2). The database part is
`scripts/ops/erase-account.ts`; the rest is done by hand in the services listed below.

Tests: `pnpm --filter @crawlmouse/scripts exec vitest run ops/erase-account.test.ts` (PGlite with
the repository's migrations) and, for the cascade the script relies on,
`pnpm --filter @crawlmouse/web exec vitest run __tests__/users-auth-cascade.test.ts`.

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
the command line):

```bash
pnpm --filter @crawlmouse/scripts exec tsx ops/erase-account.ts --db-url-env DB_URL --email person@example.com --yes-production
```

`--user-id <uuid>` instead of `--email` when the address names more than one user. The dry run
changes nothing and prints:

- per table, the rows `--yes` deletes or changes, including what cascades from the person's
  accounts;
- what is kept (§5);
- the storage objects to delete in §4;
- the reasons it refuses, if any. **Refused: other people are seated on it** means the person owns
  an account with other active members: ownership has to be transferred to one of them first.

## 4. Storage objects

SQL cannot delete Storage objects (Supabase's `protect_objects_delete` trigger), so they go
through the Storage API, before `--yes` removes the rows that name them. For each line
`<bucket>/<path>` the dry run printed: Supabase dashboard → Storage → the bucket → select the
object → Delete, or the Storage API's remove call with the service-role key. Run the dry run again:
the list is read from `storage.objects`, so it is empty once they are gone.

## 5. Erase

```bash
NEXT_PUBLIC_SUPABASE_URL=https://ezspnfeyzwsisymytssm.supabase.co SUPABASE_SERVICE_ROLE_KEY=… pnpm --filter @crawlmouse/scripts exec tsx ops/erase-account.ts --db-url-env DB_URL --email person@example.com --yes --yes-production
```

In one transaction it nulls or deletes the rows that hold the address or the user id elsewhere
(other people's audits' `notify_email`, `email_events`, `waitlist`, invitations on other accounts,
rate-limit keys ending in `:<address>` or `:<user id>`, closed takedown requests' address), and
deletes the accounts on which the person is the only active member, with what cascades from them.
Then it deletes the auth user through the Auth admin API, which deletes `public.users` and what
cascades from it. It prints the counts again; the changed and cascaded rows read 0. A failure
after the transaction (the Auth call) leaves the user in place: run the same command again.

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
- **Inngest, Vercel and Supabase logs and backups** expire on their own retention; say so in the
  reply rather than promising an immediate purge.

## 7. Reply

> We have deleted your Crawlmouse account and the data linked to it: your profile, your audits
> and sites, your sign-in records and the places your address was stored. A few things are kept:
> a one-way fingerprint of your address used only to stop a second
> free trial, any takedown request of yours that is still open, and public reports you published,
> which no longer name you. Copies in our providers' logs and backups are deleted on their normal
> schedules. Payment records that Stripe must keep by law stay with Stripe.

Keep a note of the request date, the dry-run counts and the date of `--yes` with the request.
