/**
 * Every environment name the code reads, sorted by who sets it (CC-35 D3b). env-scan.test.ts fails
 * when the scan finds a name in no class, so a new variable cannot ship without someone deciding
 * whether production needs it.
 *
 * Only `REQUIRED_ENV` is compared with production's Vercel variables (probes/vercel-env.ts). The
 * switch-on flags are the steps themselves, so they are not a precondition of their own step.
 */
import type { Step } from './steps';

type Why = Readonly<Record<string, string>>;

/** Set in Vercel Production before the step, each with what breaks without it. */
export const REQUIRED_ENV: Readonly<Record<Step, Why>> = {
  1: {
    NEXT_PUBLIC_SUPABASE_URL: 'every database read and write',
    NEXT_PUBLIC_SUPABASE_ANON_KEY: 'sign-in and the session client',
    SUPABASE_SERVICE_ROLE_KEY: 'audits, checks and every capability-URL read',
    NEXT_PUBLIC_BASE_URL: 'links in mail and the sign-in redirect',
    TURNSTILE_SECRET_KEY: 'Turnstile fails closed in production without it (PROJECT_OVERVIEW §6)',
    NEXT_PUBLIC_TURNSTILE_SITE_KEY: 'the client widget; without it a gated request cannot pass',
    STRIPE_SECRET_KEY: "v1's checkout, portal and reconcile",
    STRIPE_WEBHOOK_SECRET: "v1's Stripe webhook refuses every event without it",
    STRIPE_PRICE_ID_PRO_MONTHLY: "v1's checkout and pricing page",
    STRIPE_PRICE_ID_PRO_YEARLY: "v1's checkout and pricing page",
    RESEND_API_KEY: "v1's audit-finished mail and every v2 mail",
    SENTRY_DSN: 'server errors reach Sentry, which each step watches for 30 minutes',
    NEXT_PUBLIC_SENTRY_DSN: 'browser errors reach Sentry',
    NEXT_PUBLIC_POSTHOG_KEY: 'the funnel events (OPERATING-RULES §4)',
    INNGEST_SIGNING_KEY: 'the Inngest SDK verifies the sync and every call; read by the SDK',
    INNGEST_EVENT_KEY: 'the Inngest SDK sends events; read by the SDK',
    CRAWL_WORKER_URL:
      'the app reaches the production worker (apps/web/lib/worker-client/client.ts)',
    WORKER_SIGNING_SECRET: 'the app signs each worker request',
    WORKER_JWT_PRIVATE_KEY_PKCS8_B64: 'the app signs the batch JWT the worker verifies',
  },
  2: {},
  3: {
    TRIAL_LEDGER_PEPPER: 'without it a first login silently gets no trial (spec 25)',
  },
  4: {
    EMAIL_LINK_SECRET: 'alert and summary mail is not sent without it (CC-31, senders.md §4)',
    RESEND_WEBHOOK_SECRET: 'the Resend webhook answers 500 and records no bounce (senders.md §4)',
  },
  5: {
    STRIPE_ACCOUNT_SECRET_KEY:
      "the v2 Stripe account's live key; every v2 billing route 500s without it",
    STRIPE_ACCOUNT_WEBHOOK_SECRET: "the v2 account's webhook refuses every event without it",
    STRIPE_ACCOUNT_LIVEMODE: "must be 'true' with a live key, or stripeAccount() refuses it",
    STRIPE_RECONCILE_LIVEMODE: "unset, the reconcile's livemode guard does not run (v1-audit)",
  },
};

/** Read when set, with a working default or a deliberate "off" when unset. */
export const OPTIONAL_ENV: Why = {
  ADMIN_SECRET: 'unset, the admin takedown route refuses every request (closed by default)',
  AI_READINESS_EXTRACTION: 'engine switch; unset keeps the default extraction',
  CRAWL_PAUSED: 'the global crawl pause, set only to pause (PROJECT_OVERVIEW §6)',
  CRAWL_WALL_CLOCK_MS: "engine budget override; unset uses the engine's default",
  ENGINE_V2: 'engine switch; unset keeps the default engine path',
  FOUNDER_NOTIFY_TO:
    'unset, no founder notice or digest is sent and each run logs founder.unconfigured (CC-33 D3)',
  HOMEPAGE_FETCH_TIMEOUT_MS: "engine timeout override; unset uses the engine's default",
  INNGEST_AUDIT_CONCURRENCY:
    'unset is PLAN_CONCURRENCY_CAP; any value is clamped to it (inngest/concurrency.ts)',
  INNGEST_CHECK_CONCURRENCY:
    'unset is CHECK_CONCURRENCY_DEFAULT; any value is clamped to the plan cap',
  INNGEST_ALERT_CONCURRENCY: "unset uses inngest/alerts.ts's default",
  INNGEST_SUMMARY_CONCURRENCY: "unset uses inngest/summary.ts's default",
  NEXT_PUBLIC_POSTHOG_HOST: 'unset uses the /ingest proxy default',
  SENTRY_AUTH_TOKEN: 'build-time source-map upload; unset ships without source maps',
  SIGNIN_CANARY_TO:
    'unset, the sign-in canary is not registered; set, it runs every 10 minutes (CC-33 D6, docs/ops/uptime.md)',
  RENDER_MAX_BROWSER_SECONDS_PER_CHECK:
    'rendering stays off until the owner sets the caps (spec 14)',
  RENDER_MAX_BROWSER_SECONDS_PER_DAY: 'rendering stays off until the owner sets the caps (spec 14)',
  RENDER_MAX_IN_FLIGHT: 'rendering stays off until the owner sets the caps (spec 14)',
  CLOUDFLARE_ACCOUNT_ID: 'Browser Rendering; rendering stays off without it (spec 14)',
  CLOUDFLARE_BROWSER_RENDERING_TOKEN: 'Browser Rendering; rendering stays off without it (spec 14)',
};

/** The switch-on flags: setting one is a step, not a precondition. */
export const SWITCH_FLAGS: Why = {
  V2_PIPELINE: 'step 2',
  V2_ACCOUNT_DOOR: 'step 3',
  V2_CHECKS_PUBLIC: 'step 4',
  V2_BILLING: 'step 5',
};

/** Set by Vercel, Node or the runtime, never in the project's variables. */
export const PLATFORM_ENV: Why = {
  VERCEL: 'Vercel system variable',
  VERCEL_ENV: 'Vercel system variable',
  VERCEL_GIT_COMMIT_SHA: 'Vercel system variable',
  NEXT_RUNTIME: 'set by Next.js per runtime',
  NODE_ENV: 'set by Next.js and the test runner',
  CI: 'set by CI runners',
  AWS_LAMBDA_FUNCTION_MEMORY_SIZE:
    "Vercel's function runtime; the engine re-asserts it (PROJECT_OVERVIEW §11)",
};

/** Read only by test harnesses running a build outside Vercel. */
export const TEST_ONLY_ENV: Why = {
  CRAWLMOUSE_VISUAL_HARNESS: 'the visual harness sets it for next dev (next.config.mjs)',
  V2_PREVIEW_ON_NEXT_START: 'CI sets it to serve the previews on next start; ignored on Vercel',
  PERF_STRICT: "packages/timing's strict job",
  PERF_SAMPLES_DIR: "packages/timing's sample output",
};

/**
 * The crawl worker's environment on Fly (packages/worker). The worker is not a Vercel app: these are
 * Fly secrets (set by the owner, worker-runbook.md), its fly.toml `[env]`, or Fly's own.
 */
export const WORKER_FLY_ENV: Why = {
  WORKER_SIGNING_SECRET: 'Fly secret, the pair of the app variable of the same name',
  WORKER_JWT_PUBLIC_KEY:
    "Fly secret, the public half of the app's WORKER_JWT_PRIVATE_KEY_PKCS8_B64",
  BATCH_CONCURRENCY: 'fly.toml [env]',
  CRAWL_PAUSED: 'Fly secret, set only to pause the worker',
  PORT: 'fly.toml [env]',
  FLY_REGION: 'set by Fly',
  FLY_MACHINE_ID: 'set by Fly',
};

/** Names a library reads, which no scan of this repository can find. */
export const READ_BY_LIBRARIES: Why = {
  INNGEST_SIGNING_KEY: 'the inngest SDK',
  INNGEST_EVENT_KEY: 'the inngest SDK',
  INNGEST_DEV: 'the inngest SDK',
};

/** Must NOT be set for Production: the Vercel probe fails step 1 when one is. */
export const FORBIDDEN_ENV: Why = {
  INNGEST_DEV:
    'puts the Inngest SDK in dev mode: production events go to a dev server that is not there',
};

/** The class an app (non-worker) name is in, or null. */
export function appClassOf(name: string): string | null {
  for (const step of [1, 2, 3, 4, 5] as const) {
    if (Object.hasOwn(REQUIRED_ENV[step], name)) return `required (step ${step})`;
  }
  if (Object.hasOwn(OPTIONAL_ENV, name)) return 'optional';
  if (Object.hasOwn(SWITCH_FLAGS, name)) return 'switch flag';
  if (Object.hasOwn(PLATFORM_ENV, name)) return 'platform';
  if (Object.hasOwn(TEST_ONLY_ENV, name)) return 'test only';
  return null;
}

/** Required names up to and including `step`. */
export function requiredThrough(step: Step): string[] {
  return ([1, 2, 3, 4, 5] as const)
    .filter((s) => s <= step)
    .flatMap((s) => Object.keys(REQUIRED_ENV[s]));
}
