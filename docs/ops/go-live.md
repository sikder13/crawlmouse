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
