# Go live — the switch-on order and the one-minute rollback

Crawlmouse v2 goes live for everyone, one flag at a time, with no beta (owner decision, 2026-11-13).
Each step below is checked before it and can be undone after it. Nothing here is per account.

Before every step:

```bash
pnpm golive:check -- --step <N>
```

It prints one line per precondition, grouped by the step it gates, and exits non-zero while any line
gating step N or an earlier one is not `pass`. `unknown` is not `pass`: it names the token to add to
`scripts/.env.local`. The boxes it cannot check are listed under [Manual checks](#manual-checks) and
passed to it as `--ticked <id>,<id>` once ticked here.

## How a step is switched on, and off

**On.** Vercel → `crawlmouse-001` → Settings → Environment Variables → Production: add the variable
with the value `1`. Then redeploy production (Deployments → the current production deployment → ⋯ →
Redeploy, without the build cache option changed). A variable reaches only a deployment built after
it is set; the running deployment keeps the environment it was built with. Then resync Inngest (the
command below) and check that Inngest → Apps → crawlmouse lists the function count `golive:check`
prints for the step after this one; after step 5 it is the count the step-5 sync row names.

**Off, in a minute.** Vercel → Deployments → the production deployment from before the step → ⋯ →
_Instant Rollback_. It serves that deployment with the environment it was built with, so the flag is
off again at once. From a shell instead (`docs/ops/incident-plan.md`):

```bash
vercel rollback <the previous production deployment's URL> --scope nahl-technologies-projects
```

Then, in this order:

1. **Resync Inngest**, at once:

   ```bash
   curl -fsS -X PUT https://crawlmouse.com/api/webhooks/inngest
   ```

   (or Inngest → Apps → crawlmouse → Resync). Inngest keeps the function list from its last sync. If it
   calls `crawlmouse.com`, the step's functions fail against a deployment that no longer serves them; if
   it calls the rolled-forward deployment's own URL, that deployment keeps running them, mail and alerts
   included. Either way they run until the resync. Then check the function count matches the one
   `golive:check` lists for the step before.

2. **Unset the variable** in Vercel, so the next deployment agrees with the one now serving.
3. **Undo the rollback once the fix is deployed.** After an Instant Rollback, Vercel stops assigning
   the production domains to new deployments until the rollback is undone (Deployments → the rolled-back
   banner → _Undo rollback_, or promote the fixed deployment). Until then a push to `main` builds but
   does not serve.

What a v2 user sees after a rollback is in [After a rollback](#after-a-rollback).

## Step 0 — the check passes for step 1

`pnpm golive:check -- --step 1` exits 0, with every manual box for step 1 ticked. Step 1's rows are
what must hold before the worker is deployed; what step 1 makes true (the worker answering, its
release, its egress record, the app's worker variables) is checked before step 2.

## Step 1 — the production crawl worker

1. The GitHub environment `worker-production`, the worker's two Fly secrets, the dispatch of
   `worker-production` from `main`, and the egress record: `docs/ops/worker-runbook.md`, _Production_.
2. In Vercel production: `CRAWL_WORKER_URL`, `WORKER_SIGNING_SECRET`,
   `WORKER_JWT_PRIVATE_KEY_PKCS8_B64` (the runbook gives each value's source). Redeploy.

**Smoke** (no flag is on, so a visitor sees v1 throughout):

| #   | Do                                               | Right looks like                            |
| --- | ------------------------------------------------ | ------------------------------------------- |
| 1   | Open `https://crawlmouse-worker.fly.dev/healthz` | `{"ok":true}`                               |
| 2   | `pnpm golive:check -- --step 2`                  | the worker, release and egress lines `pass` |
| 3   | Open `https://crawlmouse.com/`                   | the v1 home, unchanged                      |
| 4   | Run a v1 audit of a small site                   | it completes, as before                     |

**Watch for 30 minutes.** Fly → `crawlmouse-worker` → Monitoring (no restarts), and
`flyctl logs --app crawlmouse-worker`. The worker reports to no Sentry project.

**Rollback.** Nothing in the app calls the worker until step 2. After the first deploy there is no
earlier release to return to: leave the worker running unused. After a later deploy, roll it back to
its previous release (runbook, _Production_ → _Roll back_).

**After a merge.** Vercel deploys the app on every merge to `main`; the worker changes only on a
dispatch. After merging a change to a worker input (`packages/**`, the paths `worker-staging.yml`
lists), dispatch `worker-production`, or make the change work with the running worker first.
`golive:check`'s release row says when the two differ.

## Step 2 — `V2_PIPELINE=1`

Registers the check pipeline's Inngest functions. Nothing a visitor reads changes. **Precondition:**
the Inngest plan (`docs/ops/inngest-budget.md`; the check fails while the plan is Hobby and the
budget is over its line).

**Smoke.**

| #   | Do                                                                                                                               | Right looks like                                                                 |
| --- | -------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| 1   | Inngest → Apps → crawlmouse                                                                                                      | synced after the redeploy; the function count `golive:check` lists for step 2    |
| 2   | Inngest → Functions → `crawlmouse.check.reaper`                                                                                  | a run every ten minutes, each completed                                          |
| 3   | Open `https://crawlmouse.com/`                                                                                                   | the v1 home                                                                      |
| 4   | Run a v1 audit                                                                                                                   | it completes                                                                     |
| 5   | As the owner's v2 account, request one check of a site it holds (`POST /api/sites/<id>/checks`, served with `V2_PIPELINE` alone) | the check finishes on `crawlmouse-worker`; its run in Inngest has no failed step |

**Watch for 30 minutes.** Inngest → Runs, failed only. Inngest → Usage (executions against the plan).
Sentry → Issues with `signal:audit-failed`.

**Rollback.** Instant Rollback to the step-1 deployment, resync Inngest, unset `V2_PIPELINE`.

## Step 3 — `V2_ACCOUNT_DOOR=1`

Serves `/signup`, `/check-email` and the claim route, and runs the first-login hook.

**Smoke.**

| #   | Do                                           | Right looks like                                                   |
| --- | -------------------------------------------- | ------------------------------------------------------------------ |
| 1   | Open `/signup`                               | the v2 sign-up page (200, not 404)                                 |
| 2   | Sign up with a new address of the owner's    | the check-email page; the link arrives from `magic@crawlmouse.com` |
| 3   | Open the link on another device              | signed in                                                          |
| 4   | Sign in with the owner's existing v1 account | signed in; `/dashboard` is v1's dashboard                          |

**Watch for 30 minutes.** Supabase → Auth → Logs (no rate-limit errors). Sentry → Issues.

**Rollback.** Instant Rollback to the step-2 deployment, resync Inngest, unset `V2_ACCOUNT_DOOR`.

## Step 4 — `V2_CHECKS_PUBLIC=1`

The v2 home at `/`, the v2 dashboard at `/dashboard`, the v2 report at `/r/<slug>` (a report minted
by v1 still renders as v1's), the check pages, the mail, the scheduler, alerts and the weekly summary.

**Smoke.**

| #   | Do                                          | Right looks like                                                                 |
| --- | ------------------------------------------- | -------------------------------------------------------------------------------- |
| 1   | Open `/`                                    | the v2 home                                                                      |
| 2   | Start a check of a small site from the home | the live check page; it finishes in minutes                                      |
| 3   | Open a v1 report at `/r/<slug>`             | it renders, as v1's report                                                       |
| 4   | Signed in, open `/dashboard`                | the v2 dashboard with the site just checked                                      |
| 5   | Inngest → the check's run                   | finished; its step count near the typical figure in `docs/ops/inngest-budget.md` |

**Watch for 30 minutes.** Sentry → Issues with `signal:crawl-degraded` and `signal:schedule-claim`.
Inngest → Runs, failed only. Resend → Logs (bounces).

**Rollback.** Instant Rollback to the step-3 deployment, resync Inngest, unset `V2_CHECKS_PUBLIC`.

## Step 5 — `V2_BILLING=1`

Pricing, Developers and For agencies as v2 pages, the v2 checkout, the Agency trial (with its
recorded consent), cancel and portal, the Stripe account webhook, the trial and past-due functions.
**Precondition:** the Stripe live prices pass `golive:check`.

**Smoke.**

| #   | Do                                                                 | Right looks like                                                        |
| --- | ------------------------------------------------------------------ | ----------------------------------------------------------------------- |
| 1   | Open `/pricing`                                                    | the v2 pricing page with the prices in `apps/web/lib/billing/prices.ts` |
| 2   | Signed in, start Pro checkout                                      | Stripe Checkout in live mode at the Pro price; close it unpaid          |
| 3   | Open `/agency-trial`, tick the consent, continue                   | Stripe Checkout for the Agency trial; close it unpaid                   |
| 4   | `curl -si -X POST https://crawlmouse.com/api/billing/agency-trial` | `404`                                                                   |

**Search.** Step 5 rewrites `/pricing` and `/developers` and adds `/agencies` to the sitemap (OPERATING-RULES
§13): record Search Console impressions and the indexed-URL list before it, and run `pnpm indexnow` only
after the 30-minute watch has passed, so a rollback never leaves a just-submitted URL answering 404.

**Watch for 30 minutes.** Stripe → Developers → Webhooks (no failed deliveries). Sentry → Issues
with `signal:billing-*` and `signal:reconcile-drift`.

**Rollback.** Instant Rollback to the step-4 deployment, resync Inngest, unset `V2_BILLING`.

## After a rollback

Proven on a production build against the local Postgres stand-in with every migration applied (CC-35,
2026-11-13): built with the four flags on, a v2 account, its kept site and a finished check seeded beside
a v1 audit and its public report; then built again with the flags off over the same rows.

- **v1 is unchanged.** The home, a v1 audit page, sign-in, a v1 `/r/` report and `/dashboard` render as
  v1's pages, with the v2 rows in the database. The proof's v1 audit has no page rows, so its audit page
  shows v1's loading card rather than figures: what it proves is the route, not the numbers.
- **A person with a v2 account** signs in as before and sees v1's dashboard: their v1 audits if they
  have any, otherwise v1's "No audits yet". Their v2 site and check pages (`/sites/<id>`,
  `/audit/<check id>`) and `/signup` answer 404. Nothing of theirs is deleted: switching the flag on again
  shows the same sites and checks.
- **A link already sent** in v2 mail to a check or a site page answers 404 until the flag is on again
  (the two pages measured above).
- `POST /api/billing/agency-trial` answers 404 with the flags on and off.
- Not in the proof, read from the code: `/check/*` answers 404 with `V2_CHECKS_PUBLIC` off
  (`apps/web/app/check/[question]/page.tsx:49`), `/agencies` with `V2_BILLING` off
  (`apps/web/app/agencies/page.tsx:34`), and the `/r/` page of a report minted by v2 with
  `V2_CHECKS_PUBLIC` off (`apps/web/app/r/[slug]/page.v2-row.test.tsx`); a v1 report is v1's page
  either way. The reaper is registered only with `V2_PIPELINE` on
  (`apps/web/lib/v2/pipeline/functions.ts:133`), so a check left running at that rollback stays
  running until the flag is on again.

The screenshots and the log are kept with the step's notes; the harness is not part of the product.

## Tokens for `golive:check`

Each goes in `scripts/.env.local` (gitignored) and is read by name; the check prints no value, sends
only the requests its outbound list allows (`scripts/golive/http.ts`), and answers `unknown` for a row
whose token is missing.

| Variable                | What to create                                                             | Least it needs                                                                                                                                                        |
| ----------------------- | -------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `VERCEL_TOKEN`          | Vercel → Account Settings → Tokens, scoped to `nahl-technologies-projects` | reads the project and its variables' names; the check never asks for a value                                                                                          |
| `SUPABASE_ACCESS_TOKEN` | Supabase → Account → Access Tokens                                         | used only on the Management API's read-only query                                                                                                                     |
| `STRIPE_LIVE_READ_KEY`  | Stripe, on the Crawlmouse v2 account, live mode → a restricted key         | Prices: Read, nothing else. The check refuses any key not starting `rk_live_`; it cannot see which account a restricted key belongs to, so create it on the right one |
| `RESEND_API_KEY`        | Resend → API Keys                                                          | a key that can list domains                                                                                                                                           |
| `FLY_READ_TOKEN`        | `flyctl tokens create readonly`                                            | reads the production worker's machines                                                                                                                                |

## Manual checks

<!-- golive:manual:start -->

<!-- Rendered by scripts/golive/checklist.ts from scripts/golive/preconditions.ts. Do not edit by hand:
     change the registry and run `pnpm --filter @crawlmouse/scripts exec tsx golive/checklist.ts --write`. -->

### Manual preconditions

The boxes are not ticked in this file. When one is true, pass its id to the check:
`pnpm golive:check -- --step N --ticked id,id`. A manual row counts as not passing until it is passed.

#### Before step 1: production worker deployed, its egress recorded, the worker variables set

- [ ] `worker-github-environment` (owner): GitHub environment `worker-production` holds FLY_API_TOKEN (secret) and FLY_ORG (variable), deployments restricted to main. Why: worker-production.yml takes its Fly credentials from it and nowhere else (CC-35 D1). Source: `docs/ops/worker-runbook.md:11`.
- [ ] `worker-fly-secrets` (owner): Fly app `crawlmouse-worker` has WORKER_SIGNING_SECRET and WORKER_JWT_PUBLIC_KEY set from standard input, pairing the app variables. Why: the worker refuses every batch it cannot verify. Source: `docs/ops/worker-runbook.md:45`.
- [ ] `worker-egress-recorded` (owner): the production worker's egress IPv4 and IPv6 are recorded in the runbook's egress table. Why: sites allow-list the crawler by that address; the table says "not recorded". Source: `docs/ops/worker-runbook.md:304`.
- [ ] `worker-uptime-monitor` (CC-33): a Sentry uptime monitor watches the production worker's /healthz. Why: a worker that stops answering stops every check; nobody is told otherwise. Source: `notes/cc-33/PR.md:121`.
- [ ] `inngest-synced-before-step-1` (owner): Inngest → Apps → crawlmouse (production) was synced after the last redeploy and lists 4 functions. Why: Inngest keeps the function set from its last sync; a stale set fails each tick and still spends executions (plan review B8). Source: `notes/cc-35/questions.md (Q4)`.

#### Before step 2: V2_PIPELINE=1

- [ ] `pipeline-rehearsal` (CTO): the check pipeline has run once end to end against a Supabase branch and an Inngest branch environment, the cancel event carrying checkId. Why: CC-20b's flag-on rehearsal; unit tests do not exercise the deployed function (OPERATING-RULES §6). Source: `notes/cc-20b/PR.md:344`.
- [ ] `sentry-v2-alerts` (CTO): Sentry alert rules exist for the v2 signals each step's 30-minute watch reads. Why: a failing step must be seen within the watch, not reported by a user. Source: `docs/ops/security-baseline.md:39`.
- [ ] `evidence-deletion` (CTO): a check's evidence objects are deleted when the check expires, its site is removed or its account is deleted. Why: CC-20b named it a precondition of V2_PIPELINE=1; CC-22b and CC-27b built parts of it since, and nothing records the whole. Source: `notes/cc-20b/PR.md:343`.
- [ ] `inngest-synced-before-step-2` (owner): Inngest → Apps → crawlmouse (production) was synced after the last redeploy and lists 4 functions. Why: Inngest keeps the function set from its last sync; a stale set fails each tick and still spends executions (plan review B8). Source: `notes/cc-35/questions.md (Q4)`.

#### Before step 3: V2_ACCOUNT_DOOR=1

- [ ] `supabase-auth-config` (owner): supabase/auth-config.ts --apply has been run on production (mailer_otp_exp 900, autoconfirm off, site_url, templates). Why: production read mailer_otp_exp 600 on 2026-11-05 and nothing records the apply. Source: `docs/specs/v2/25-account-door.md:142`.
- [ ] `signin-canary` (CC-33): the Supabase Auth email limit is raised by at least 6 an hour, then SIGNIN_CANARY_TO is set (an internal mailbox) with Resend subscribed to email.delivered. Why: the canary's own links would use up the sign-in mail limit real users need (CC-33 Q4, Q16). Source: `notes/cc-33/PR.md:116`.
- [ ] `cc36-v1-accounts` (CC-36): v1's users, the owner's Pro among them, have v2 accounts (the backfill), and users.pro_until's readers are moved before migration 009 drops it. Why: a user from before migration 001 has no v2 account until the backfill, so the door cannot attach their site (spec 25). Source: `docs/specs/v2/25-account-door.md:157`.
- [ ] `edge-rate-limits` (CTO): infra/vercel/firewall.json is applied at the edge (magic-link, audits/start and claim limits), per docs/ops/edge-firewall.md. Why: the door opens sign-up to everyone; the edge limits are its first line (sec-baseline D9). Source: `docs/specs/v2/sec-baseline.md:388`.
- [ ] `inngest-synced-before-step-3` (owner): Inngest → Apps → crawlmouse (production) was synced after the last redeploy and lists 8 functions. Why: Inngest keeps the function set from its last sync; a stale set fails each tick and still spends executions (plan review B8). Source: `notes/cc-35/questions.md (Q4)`.

#### Before step 4: V2_CHECKS_PUBLIC=1

- [ ] `resend-webhook` (owner): Resend sends email.bounced, email.complained and email.delivered to https://crawlmouse.com/api/webhooks/resend. Why: a hard bounce or a complaint must suppress further mail to the address. Source: `docs/ops/senders.md:21`.
- [ ] `alerts-reply-routing` (owner): Cloudflare Email Routing delivers mail to alerts@crawlmouse.com (a test mail arrives). Why: a reply to an alert, a summary or an account mail bounces otherwise. Source: `docs/ops/senders.md:28`.
- [ ] `public-checks-prerequisites` (CTO): spec 22b's list holds: the privacy page states v2's retention (24 hours, then deleted at the next daily run). Why: the public check stores data the privacy page must describe. Source: `docs/specs/v2/22b-public-checks.md:240`.
- [ ] `report-slug-sweep` (owner): scripts/db/report-slug-sweep.ts has been run read-only against production and found no collision. Why: a v1 report slug a v2 report would also claim breaks one of the two /r/ pages. Source: `notes/cc-29/PR.md:106`.
- [ ] `v2-report-retraction` (owner): the owner has accepted, or a later step has fixed, that no member can retract a v2 report. Why: spec 29 states it as a known gap on a public, indexable page. Source: `docs/specs/v2/29-public-pages.md:81`.
- [ ] `cc33-operations` (CC-33): CC-33's owner list is done: FOUNDER_NOTIFY_TO set, an operator added, the uptime monitors and the founder-notice and sign-in-canary Sentry alerts in place. Why: the operations surfaces watch the public v2 screens. Source: `notes/cc-33/PR.md:109`.
- [ ] `search-console-baseline` (owner): Search Console impressions and the indexed-URL list are recorded before the switch (and again after), and IndexNow is run after the deploy. Why: step 4 rewrites /, /dashboard and /r/:slug, the URLs that earn search traffic (OPERATING-RULES §13). Source: `docs/OPERATING-RULES.md:440`.
- [ ] `cc36-v1-pages` (CC-36): v1's audit and report pages have their v2 replacement or keep serving: no v1 /audit/ or /r/ URL errors once / and /r/:slug are rewritten. Why: indexed URLs are the main thing at risk (brief F2). Source: `docs/specs/v2/v1-audit.md:16`.
- [ ] `cc36-v1-redirects` (CC-36): every v1 URL v2 drops has its permanent redirect or 410 in place: /compare → /, /compare/[a]/[b] → /audit/[a], /top/[platform] 410, /billing → /settings/plan. Why: OPERATING-RULES §13: no indexed URL is removed without a 301 or 308. Source: `docs/specs/v2/v1-audit.md:36`.
- [ ] `cc36-v1-crons` (CC-36): v1's crons are moved: cleanupExpiredAuditsFn becomes crawlmouse.cleanup.daily, still calling prune_rate_limits, and auditFn is retired for checkFn. Why: rate_limits grows without the prune; two pipelines share one Inngest quota. Source: `docs/specs/v2/v1-audit.md:120`.
- [ ] `footer-post-links` (owner): the v2 footer's post links are chosen from Search Console data. Why: CC-22b's switch-on list; the footer is on every public v2 page. Source: `notes/cc-22b/PR.md:57`.
- [ ] `bot-page-copy` (owner): the owner has decided /bot's v1 text and whether v2 screens publish the crawler's IP addresses (CC-29 Q28). Why: v2 screens point readers at /bot to identify the crawler. Source: `notes/cc-29/PR.md:124`.
- [ ] `inngest-synced-before-step-4` (owner): Inngest → Apps → crawlmouse (production) was synced after the last redeploy and lists 8 functions. Why: Inngest keeps the function set from its last sync; a stale set fails each tick and still spends executions (plan review B8). Source: `notes/cc-35/questions.md (Q4)`.

#### Before step 5: V2_BILLING=1

- [ ] `stripe-live-webhook` (owner): the v2 account's live webhook points at /api/webhooks/stripe-account with api_version 2026-05-27.dahlia and the spec's event list, its secret in STRIPE_ACCOUNT_WEBHOOK_SECRET. Why: subscription changes reach the entitlement machine only through it. Source: `docs/specs/v2/03-billing.md:265`.
- [ ] `billing-copy-and-terms` (owner): the owner has settled the Terms' refund sentence, the legal read of the Agency-trial consent wording and the "under your brand" copy. Why: the billing pages quote them to paying customers. Source: `docs/specs/v2/27b-account-wiring.md:71`.
- [ ] `cc36-v1-billing` (CC-36): the owner's v1 Pro subscription (Nahl account) is carried to v2 before V2_BILLING moves v1's checkout and portal routes to the v2 handlers. Why: v1 and v2 share the stripe_events ledger, and the flag changes what the v1 routes do. Source: `docs/specs/v2/03-billing.md:4`.
- [ ] `external-pen-test` (owner): an external penetration test has been done, or the owner has accepted billing without one. Why: sec-baseline lists it as due before the first paid agency. Source: `docs/specs/v2/sec-baseline.md:494`.
- [ ] `inngest-synced-before-step-5` (owner): Inngest → Apps → crawlmouse (production) was synced after the last redeploy and lists 20 functions. Why: Inngest keeps the function set from its last sync; a stale set fails each tick and still spends executions (plan review B8). Source: `notes/cc-35/questions.md (Q4)`.

<!-- golive:manual:end -->
