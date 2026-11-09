# Incident plan

Written before an incident, so the first ten minutes are a checklist and not a design session. Each
command says where to run it. Commands that need a credential read it without echoing it.

## Who is paged, and how

- **Sentry** emails the owner: the alert rules on project `crawlmouse` (org `nahl-technologies-inc`),
  the uptime monitors in `docs/ops/security-baseline.md`, and `security.refused` spikes.
- **Reports from outside** arrive at `abuse@crawlmouse.com`, `takedown@crawlmouse.com` and
  `support@crawlmouse.com` (Cloudflare Email Routing to the owner).
- The owner declares the incident, picks the severity, and is its lead until they hand it over in
  writing (a line in the incident note).

## Severity

| Level | Meaning                                                                      | Examples                                                                                               | Response                                              |
| ----- | ---------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ | ----------------------------------------------------- |
| SEV-1 | Customer data or money is exposed or wrong, or the site is down for everyone | a leaked service key; a cross-account read; Stripe entitlements granted wrongly; `/api/health` failing | Now, whatever the hour. Contain first, explain later. |
| SEV-2 | One feature is broken or abused, with no data exposure                       | crawls failing; an abuse flood the edge does not stop; sign-in emails not arriving                     | The same day.                                         |
| SEV-3 | Degraded, or a weakness with no sign of use                                  | a scanner finding; a noisy alert                                                                       | The next working day, as an issue.                    |

## The first ten minutes

1. **Write the time down** and open an incident note (template below). Every action goes in it.
2. **Stop new damage.** Use the narrowest switch that stops it:
   - _Crawls are the problem_ (abuse, cost, a crawler bug): pause them. Set `CRAWL_PAUSED=1` in Vercel
     (project `crawlmouse-001` → Settings → Environment Variables → Production) and redeploy. A
     deployment keeps the environment it was built with, so the redeploy is what applies it. New audit
     starts and re-audits then answer 503 `code: "paused"`, and a queued audit is failed instead of
     crawled (`PROJECT_OVERVIEW.md` §6). For the staging worker, from any shell with `flyctl` signed in:

     ```bash
     flyctl secrets set --app crawlmouse-worker-staging CRAWL_PAUSED=1
     ```

   - _The last deployment is the problem_: roll back to the one before it. From `apps/web` with the
     Vercel CLI signed in:

     ```bash
     vercel ls crawlmouse-001 --prod --scope nahl-technologies-projects
     ```

     ```bash
     vercel rollback <the previous production deployment's URL> --scope nahl-technologies-projects
     ```

     An instant rollback serves the old build with the old build's environment.

   - _The last migration is the problem_: run its rollback through the pipeline. From the repository
     root with `gh` signed in, then approve the `production` environment in GitHub:

     ```bash
     gh workflow run db-rollback-prod.yml -f file=<version>_<name>.revert.sql
     ```

     It runs one file, newest first, and refuses a file that is not the latest applied
     (`docs/ops/db-migrations.md`).

   - _A credential is exposed_: rotate it (next section) before anything else.

3. **Keep the evidence.** Do not delete logs or rows. Note the Sentry issue links, the Vercel deployment
   id (`curl -s https://crawlmouse.com/api/health` prints its commit), and the time window.
4. **Say something.** Post the status note (template below) when users are affected.

## Rotating credentials

In this order: the ones that open the most come first. For each, create the new value, put it where it
lives, redeploy or restart, check the feature, and only then revoke the old value.

| #   | Credential                                           | Where it lives                                              | Where to rotate                                                         |
| --- | ---------------------------------------------------- | ----------------------------------------------------------- | ----------------------------------------------------------------------- |
| 1   | `SUPABASE_SERVICE_ROLE_KEY`                          | Vercel env (Production, Preview)                            | Supabase → project `ezspnfeyzwsisymytssm` → Settings → API Keys         |
| 2   | `SUPABASE_ACCESS_TOKEN`, `SUPABASE_DB_PASSWORD`      | GitHub environments `production`, `db-dry-run`              | Supabase → Account → Access Tokens; Database → Settings → password      |
| 3   | `STRIPE_SECRET_KEY`                                  | Vercel env                                                  | Stripe → Developers → API keys → roll                                   |
| 4   | `STRIPE_WEBHOOK_SECRET`                              | Vercel env                                                  | Stripe → Webhooks → `we_1ThBIfJp0NUyqKK7HieIGRUw` → roll signing secret |
| 5   | `ADMIN_SECRET`                                       | Vercel env                                                  | Generate: `openssl rand -base64 48`                                     |
| 6   | `WORKER_SIGNING_SECRET` (and the batch-JWT key pair) | Vercel env, and Fly app `crawlmouse-worker-staging` secrets | Generate; set both sides before revoking (`docs/ops/worker-runbook.md`) |
| 7   | `INNGEST_SIGNING_KEY`, `INNGEST_EVENT_KEY`           | Vercel env                                                  | Inngest → app → Manage → keys                                           |
| 8   | `RESEND_API_KEY`, `RESEND_WEBHOOK_SECRET`            | Vercel env                                                  | Resend → API Keys; Webhooks → signing secret                            |
| 9   | `TURNSTILE_SECRET_KEY`                               | Vercel env                                                  | Cloudflare → Turnstile → widget → rotate secret                         |
| 10  | `SENTRY_AUTH_TOKEN`                                  | Vercel env (build only)                                     | Sentry → Settings → Auth Tokens                                         |
| 11  | `FLY_API_TOKEN`                                      | GitHub environment `staging`                                | `flyctl tokens create deploy --app crawlmouse-worker-staging`           |
| 12  | Vercel tokens                                        | Each operator's machine                                     | Vercel → Account Settings → Tokens                                      |

`TRIAL_LEDGER_PEPPER` is not on the list on purpose: rotating it unlinks every trial-ledger hash from
the ones before, which reopens the free trial to everyone. Rotate it only if it leaked, and say so in
the incident note.

To replace a Vercel variable from `apps/web`, with the CLI signed in and the project linked
(`vercel link --yes --project crawlmouse-001 --scope nahl-technologies-projects`):

```bash
vercel env rm STRIPE_SECRET_KEY production --yes --scope nahl-technologies-projects
```

```bash
read -rs NEW && printf '%s' "$NEW" | vercel env add STRIPE_SECRET_KEY production --scope nahl-technologies-projects; unset NEW
```

Then redeploy production from the Vercel dashboard (Deployments → the current production deployment →
Redeploy), because a running deployment keeps the environment it was built with.

## Status note (template)

> **[Investigating | Identified | Monitoring | Resolved] — <one line on what users see>.** Since
> <time, UTC>. <What is affected and what is not.> <What we did, in one sentence.> Next update by
> <time, UTC>.

## Post-incident write-up (template)

Write it within five working days, without blame, in `evidence/<date>-incident-<slug>.md`.

1. **Summary**: what happened, in three sentences.
2. **Timeline** (UTC): detection, each action, containment, resolution.
3. **Impact**: who and what was affected, for how long, what data, and whether anyone must be told
   (customers, the payment processor, a regulator).
4. **Cause**: the chain, ending at the first thing we control.
5. **What went well, what did not.**
6. **Actions**: each with an owner and a date, as issues.
