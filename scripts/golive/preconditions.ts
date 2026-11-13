/**
 * The go-live preconditions (CC-35 D3a, D6). One row per thing that must be true before a switch-on
 * step, built from the switch-on and owner-action lines in docs/specs/v2/*.md and the sessions'
 * PR.md files; `notes/cc-35/preconditions-inventory.md` maps each such line to a row here.
 *
 * `source` is a tracked `file:line` where one records the precondition, otherwise the session notes'
 * `notes/cc-NN/PR.md:line` (outside the repository; preconditions.test.ts checks tracked sources only).
 * `gates` is the earliest step that needs it (steps.ts). An `auto` row is decided by a probe; a
 * `manual` row is a box the owner ticks in docs/ops/go-live.md and passes to the check as `--ticked`.
 */
import { functionCountAfter } from './inngest-sync';
import { PAID_PLAN_TICK } from './probes/inngest';
import type { ProbeId } from './probes/index';
import type { Step } from './steps';

export type Owner = 'done' | 'CTO' | 'owner' | 'CC-33' | 'CC-36';

export type Check = { kind: 'auto'; probe: ProbeId } | { kind: 'manual' };

export interface Precondition {
  id: string;
  mustBeTrue: string;
  why: string;
  source: string;
  gates: Step;
  owner: Owner;
  check: Check;
}

const auto = (probe: ProbeId): Check => ({ kind: 'auto', probe });
const manual: Check = { kind: 'manual' };

/** The sync row for a step: Inngest shows the function count of the flags already on. */
const syncRow = (step: Step): Precondition => {
  const before = (step === 1 ? 1 : step - 1) as Step;
  return {
    id: `inngest-synced-before-step-${step}`,
    mustBeTrue: `Inngest → Apps → crawlmouse (production) was synced after the last redeploy and lists ${functionCountAfter(before)} functions`,
    why: 'Inngest keeps the function set from its last sync; a stale set fails each tick and still spends executions (plan review B8)',
    source: 'notes/cc-35/questions.md (Q4)',
    gates: step,
    owner: 'owner',
    check: manual,
  };
};

export const PRECONDITIONS: readonly Precondition[] = [
  // ── step 1: the production worker ──
  {
    id: 'worker-github-environment',
    mustBeTrue:
      'GitHub environment `worker-production` holds FLY_API_TOKEN (secret) and FLY_ORG (variable), deployments restricted to main',
    why: 'worker-production.yml takes its Fly credentials from it and nowhere else (CC-35 D1)',
    source: 'docs/ops/worker-runbook.md:11',
    gates: 1,
    owner: 'owner',
    check: manual,
  },
  {
    id: 'worker-fly-secrets',
    mustBeTrue:
      'Fly app `crawlmouse-worker` has WORKER_SIGNING_SECRET and WORKER_JWT_PUBLIC_KEY set from standard input, pairing the app variables',
    why: 'the worker refuses every batch it cannot verify',
    source: 'docs/ops/worker-runbook.md:45',
    gates: 1,
    owner: 'owner',
    check: manual,
  },
  {
    id: 'worker-healthz',
    mustBeTrue: 'https://crawlmouse-worker.fly.dev/healthz answers 200 {"ok":true}',
    why: 'the app posts every batch to that worker',
    source: 'packages/worker/src/server.ts:274',
    gates: 1,
    owner: 'owner',
    check: auto('worker-healthz'),
  },
  {
    id: 'worker-release',
    mustBeTrue:
      'the production machines run an image labelled with a commit from which no worker input changed up to origin/main',
    why: 'a worker older than the app it serves reads batches the app no longer sends (CC-32)',
    source: '.github/workflows/worker-staging.yml:15',
    gates: 1,
    owner: 'owner',
    check: auto('worker-release'),
  },
  {
    id: 'worker-egress-recorded',
    mustBeTrue:
      "the production worker's egress IPv4 and IPv6 are recorded in the runbook's egress table",
    why: 'sites allow-list the crawler by that address; the table says "not recorded"',
    source: 'docs/ops/worker-runbook.md:304',
    gates: 1,
    owner: 'owner',
    check: manual,
  },
  {
    id: 'worker-uptime-monitor',
    mustBeTrue: "a Sentry uptime monitor watches the production worker's /healthz",
    why: 'a worker that stops answering stops every check; nobody is told otherwise',
    source: 'notes/cc-33/PR.md:121',
    gates: 1,
    owner: 'CC-33',
    check: manual,
  },
  {
    id: 'vercel-env-step-1',
    mustBeTrue:
      "Vercel Production has every name REQUIRED_ENV[1] lists (the worker's three among them), none set after the live deployment, and no INNGEST_DEV",
    why: 'a deployment keeps the environment it was built with (brief F7)',
    source: 'apps/web/lib/worker-client/client.ts:19',
    gates: 1,
    owner: 'owner',
    check: auto('vercel-env-1'),
  },
  syncRow(1),
  // ── step 2: V2_PIPELINE ──
  {
    id: 'migrations-applied',
    mustBeTrue:
      "every file in infra/supabase/migrations is in production's supabase_migrations.schema_migrations",
    why: 'v2 reads tables and functions those migrations create',
    source: 'PROJECT_OVERVIEW.md:200',
    gates: 2,
    owner: 'owner',
    check: auto('migrations'),
  },
  {
    id: 'inngest-plan',
    mustBeTrue: `the Inngest plan holds the floor plus 1,000 checks a month under the D2 line, or the paid plan is ticked (${PAID_PLAN_TICK})`,
    why: 'on Hobby, running out stops every audit and every mail until the next month (D2)',
    source: 'docs/ops/inngest-budget.md:1',
    gates: 2,
    owner: 'owner',
    check: auto('inngest-budget'),
  },
  {
    id: 'vercel-env-step-2',
    mustBeTrue: 'Vercel Production has every name REQUIRED_ENV[2] lists',
    why: 'a deployment keeps the environment it was built with (brief F7)',
    source: 'apps/web/lib/auth/flags.ts:25',
    gates: 2,
    owner: 'owner',
    check: auto('vercel-env-2'),
  },
  {
    id: 'pipeline-rehearsal',
    mustBeTrue:
      'the check pipeline has run once end to end against a Supabase branch and an Inngest branch environment, the cancel event carrying checkId',
    why: "CC-20b's flag-on rehearsal; unit tests do not exercise the deployed function (OPERATING-RULES §6)",
    source: 'notes/cc-20b/PR.md:344',
    gates: 2,
    owner: 'CTO',
    check: manual,
  },
  {
    id: 'sentry-v2-alerts',
    mustBeTrue: "Sentry alert rules exist for the v2 signals each step's 30-minute watch reads",
    why: 'a failing step must be seen within the watch, not reported by a user',
    source: 'docs/ops/security-baseline.md:39',
    gates: 2,
    owner: 'CTO',
    check: manual,
  },
  {
    id: 'evidence-deletion',
    mustBeTrue:
      "a check's evidence objects are deleted when the check expires, its site is removed or its account is deleted",
    why: 'CC-20b named it a precondition of V2_PIPELINE=1; CC-22b and CC-27b built parts of it since, and nothing records the whole',
    source: 'notes/cc-20b/PR.md:343',
    gates: 2,
    owner: 'CTO',
    check: manual,
  },
  syncRow(2),
  // ── step 3: V2_ACCOUNT_DOOR ──
  {
    id: 'vercel-env-step-3',
    mustBeTrue:
      'Vercel Production has TRIAL_LEDGER_PEPPER (REQUIRED_ENV[3]), at least 32 characters, never rotated',
    why: 'without it a first login silently gets no trial',
    source: 'docs/specs/v2/25-account-door.md:141',
    gates: 3,
    owner: 'owner',
    check: auto('vercel-env-3'),
  },
  {
    id: 'supabase-auth-config',
    mustBeTrue:
      'supabase/auth-config.ts --apply has been run on production (mailer_otp_exp 900, autoconfirm off, site_url, templates)',
    why: 'production read mailer_otp_exp 600 on 2026-11-05 and nothing records the apply',
    source: 'docs/specs/v2/25-account-door.md:142',
    gates: 3,
    owner: 'owner',
    check: manual,
  },
  {
    id: 'signin-canary',
    mustBeTrue:
      'the Supabase Auth email limit is raised by at least 6 an hour, then SIGNIN_CANARY_TO is set (an internal mailbox) with Resend subscribed to email.delivered',
    why: "the canary's own links would use up the sign-in mail limit real users need (CC-33 Q4, Q16)",
    source: 'notes/cc-33/PR.md:116',
    gates: 3,
    owner: 'CC-33',
    check: manual,
  },
  {
    id: 'cc36-v1-accounts',
    mustBeTrue:
      "v1's users, the owner's Pro among them, have v2 accounts (the backfill), and users.pro_until's readers are moved before migration 009 drops it",
    why: 'a user from before migration 001 has no v2 account until the backfill, so the door cannot attach their site (spec 25)',
    source: 'docs/specs/v2/25-account-door.md:157',
    gates: 3,
    owner: 'CC-36',
    check: manual,
  },
  {
    id: 'edge-rate-limits',
    mustBeTrue:
      'infra/vercel/firewall.json is applied at the edge (magic-link, audits/start and claim limits), per docs/ops/edge-firewall.md',
    why: 'the door opens sign-up to everyone; the edge limits are its first line (sec-baseline D9)',
    source: 'docs/specs/v2/sec-baseline.md:388',
    gates: 3,
    owner: 'CTO',
    check: manual,
  },
  syncRow(3),
  // ── step 4: V2_CHECKS_PUBLIC ──
  {
    id: 'vercel-env-step-4',
    mustBeTrue:
      'Vercel Production has EMAIL_LINK_SECRET and RESEND_WEBHOOK_SECRET (REQUIRED_ENV[4])',
    why: 'without EMAIL_LINK_SECRET no alert or summary mail is sent (CC-31)',
    source: 'docs/ops/senders.md:53',
    gates: 4,
    owner: 'owner',
    check: auto('vercel-env-4'),
  },
  {
    id: 'resend-domain',
    mustBeTrue: 'Resend lists crawlmouse.com as verified',
    why: 'every v2 mail is sent from alerts@crawlmouse.com through Resend',
    source: 'docs/ops/senders.md:18',
    gates: 4,
    owner: 'owner',
    check: auto('resend-domain'),
  },
  {
    id: 'resend-webhook',
    mustBeTrue:
      'Resend sends email.bounced, email.complained and email.delivered to https://crawlmouse.com/api/webhooks/resend',
    why: 'a hard bounce or a complaint must suppress further mail to the address',
    source: 'docs/ops/senders.md:21',
    gates: 4,
    owner: 'owner',
    check: manual,
  },
  {
    id: 'alerts-reply-routing',
    mustBeTrue:
      'Cloudflare Email Routing delivers mail to alerts@crawlmouse.com (a test mail arrives)',
    why: 'a reply to an alert, a summary or an account mail bounces otherwise',
    source: 'docs/ops/senders.md:28',
    gates: 4,
    owner: 'owner',
    check: manual,
  },
  {
    id: 'public-checks-prerequisites',
    mustBeTrue:
      "spec 22b's list holds: the privacy page states v2's retention (24 hours, then deleted at the next daily run)",
    why: 'the public check stores data the privacy page must describe',
    source: 'docs/specs/v2/22b-public-checks.md:240',
    gates: 4,
    owner: 'CTO',
    check: manual,
  },
  {
    id: 'report-slug-sweep',
    mustBeTrue:
      'scripts/db/report-slug-sweep.ts has been run read-only against production and found no collision',
    why: 'a v1 report slug a v2 report would also claim breaks one of the two /r/ pages',
    source: 'notes/cc-29/PR.md:106',
    gates: 4,
    owner: 'owner',
    check: manual,
  },
  {
    id: 'v2-report-retraction',
    mustBeTrue:
      'the owner has accepted, or a later step has fixed, that no member can retract a v2 report',
    why: 'spec 29 states it as a known gap on a public, indexable page',
    source: 'docs/specs/v2/29-public-pages.md:81',
    gates: 4,
    owner: 'owner',
    check: manual,
  },
  {
    id: 'cc33-operations',
    mustBeTrue:
      "CC-33's owner list is done: FOUNDER_NOTIFY_TO set, an operator added, the uptime monitors and the founder-notice and sign-in-canary Sentry alerts in place",
    why: 'the operations surfaces watch the public v2 screens',
    source: 'notes/cc-33/PR.md:109',
    gates: 4,
    owner: 'CC-33',
    check: manual,
  },
  {
    id: 'search-console-baseline',
    mustBeTrue:
      'Search Console impressions and the indexed-URL list are recorded before the switch (and again after), and IndexNow is run after the deploy',
    why: 'step 4 rewrites /, /dashboard and /r/:slug, the URLs that earn search traffic (OPERATING-RULES §13)',
    source: 'docs/OPERATING-RULES.md:440',
    gates: 4,
    owner: 'owner',
    check: manual,
  },
  {
    id: 'cc36-v1-pages',
    mustBeTrue:
      "v1's audit and report pages have their v2 replacement or keep serving: no v1 /audit/ or /r/ URL errors once / and /r/:slug are rewritten",
    why: 'indexed URLs are the main thing at risk (brief F2)',
    source: 'docs/specs/v2/v1-audit.md:16',
    gates: 4,
    owner: 'CC-36',
    check: manual,
  },
  {
    id: 'cc36-v1-redirects',
    mustBeTrue:
      'every v1 URL v2 drops has its permanent redirect or 410 in place: /compare → /, /compare/[a]/[b] → /audit/[a], /top/[platform] 410, /billing → /settings/plan',
    why: 'OPERATING-RULES §13: no indexed URL is removed without a 301 or 308',
    source: 'docs/specs/v2/v1-audit.md:36',
    gates: 4,
    owner: 'CC-36',
    check: manual,
  },
  {
    id: 'cc36-v1-crons',
    mustBeTrue:
      "v1's crons are moved: cleanupExpiredAuditsFn becomes crawlmouse.cleanup.daily, still calling prune_rate_limits, and auditFn is retired for checkFn",
    why: 'rate_limits grows without the prune; two pipelines share one Inngest quota',
    source: 'docs/specs/v2/v1-audit.md:120',
    gates: 4,
    owner: 'CC-36',
    check: manual,
  },
  {
    id: 'footer-post-links',
    mustBeTrue: "the v2 footer's post links are chosen from Search Console data",
    why: "CC-22b's switch-on list; the footer is on every public v2 page",
    source: 'notes/cc-22b/PR.md:57',
    gates: 4,
    owner: 'owner',
    check: manual,
  },
  {
    id: 'bot-page-copy',
    mustBeTrue:
      "the owner has decided /bot's v1 text and whether v2 screens publish the crawler's IP addresses (CC-29 Q28)",
    why: 'v2 screens point readers at /bot to identify the crawler',
    source: 'notes/cc-29/PR.md:124',
    gates: 4,
    owner: 'owner',
    check: manual,
  },
  syncRow(4),
  // ── step 5: V2_BILLING ──
  {
    id: 'agency-trial-route-removed',
    mustBeTrue:
      'POST /api/billing/agency-trial is gone from main: the Agency trial starts only through app/api/agency-trial, which records consent',
    why: 'a trial with no recorded consent must not be reachable once billing is on (CC-31 Q45)',
    source: 'docs/specs/v2/03-billing.md:236',
    gates: 5,
    owner: 'done',
    check: auto('agency-trial-removed'),
  },
  {
    id: 'vercel-env-step-5',
    mustBeTrue:
      "Vercel Production has the v2 Stripe account's live key, its webhook secret, STRIPE_ACCOUNT_LIVEMODE=true and STRIPE_RECONCILE_LIVEMODE (REQUIRED_ENV[5])",
    why: 'stripeAccount() refuses a key whose mode is not the one named; every billing route then answers 500',
    source: 'apps/web/lib/billing/stripe-account.ts:25',
    gates: 5,
    owner: 'owner',
    check: auto('vercel-env-5'),
  },
  {
    id: 'stripe-live-prices',
    mustBeTrue:
      "each of CATALOG's eight lookup keys has an active live-mode price on the v2 Stripe account at the catalog's amount and interval",
    why: 'checkout refuses a plan whose price is missing or differs from the pages (CC-03)',
    source: 'apps/web/lib/billing/catalog.ts:38',
    gates: 5,
    owner: 'owner',
    check: auto('stripe-live-prices'),
  },
  {
    id: 'stripe-live-webhook',
    mustBeTrue:
      "the v2 account's live webhook points at /api/webhooks/stripe-account with api_version 2026-05-27.dahlia and the spec's event list, its secret in STRIPE_ACCOUNT_WEBHOOK_SECRET",
    why: 'subscription changes reach the entitlement machine only through it',
    source: 'docs/specs/v2/03-billing.md:265',
    gates: 5,
    owner: 'owner',
    check: manual,
  },
  {
    id: 'billing-copy-and-terms',
    mustBeTrue:
      'the owner has settled the Terms\' refund sentence, the legal read of the Agency-trial consent wording and the "under your brand" copy',
    why: 'the billing pages quote them to paying customers',
    source: 'docs/specs/v2/27b-account-wiring.md:71',
    gates: 5,
    owner: 'owner',
    check: manual,
  },
  {
    id: 'cc36-v1-billing',
    mustBeTrue:
      "the owner's v1 Pro subscription (Nahl account) is carried to v2 before V2_BILLING moves v1's checkout and portal routes to the v2 handlers",
    why: 'v1 and v2 share the stripe_events ledger, and the flag changes what the v1 routes do',
    source: 'docs/specs/v2/03-billing.md:4',
    gates: 5,
    owner: 'CC-36',
    check: manual,
  },
  {
    id: 'external-pen-test',
    mustBeTrue:
      'an external penetration test has been done, or the owner has accepted billing without one',
    why: 'sec-baseline lists it as due before the first paid agency',
    source: 'docs/specs/v2/sec-baseline.md:494',
    gates: 5,
    owner: 'owner',
    check: manual,
  },
  syncRow(5),
];

export const MANUAL = PRECONDITIONS.filter((p) => p.check.kind === 'manual');

export const rowsGating = (step: Step): Precondition[] =>
  PRECONDITIONS.filter((p) => p.gates === step);
