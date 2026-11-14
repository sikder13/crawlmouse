/**
 * Every automatic probe, by id. preconditions.test.ts fails on a registry row naming another id.
 *
 * A row whose answer reads a table from this checkout (the required variable names, the price catalog,
 * the worker-input list, the budget's function rows) runs through `onLiveInputs`, so it answers
 * `unknown` unless this checkout's `CHECK_INPUTS` equal the live production commit's (live.ts).
 */
import { inngestBudgetProbe } from './inngest';
import { onLiveInputs } from './live';
import { migrationsProbe } from './migrations';
import { agencyTrialRemovedProbe } from './repo';
import { resendProbe } from './resend';
import { stripeProbe } from './stripe';
import type { Probe } from './types';
import { vercelEnvProbe } from './vercel-env';
import { healthzProbe, releaseProbe } from './worker';

export const PROBES = {
  'vercel-env-1': onLiveInputs(vercelEnvProbe(1)),
  'vercel-env-2': onLiveInputs(vercelEnvProbe(2)),
  'vercel-env-3': onLiveInputs(vercelEnvProbe(3)),
  'vercel-env-4': onLiveInputs(vercelEnvProbe(4)),
  'vercel-env-5': onLiveInputs(vercelEnvProbe(5)),
  migrations: migrationsProbe(),
  'worker-healthz': healthzProbe,
  'worker-release': onLiveInputs(releaseProbe()),
  'stripe-live-prices': onLiveInputs(stripeProbe),
  'resend-domain': resendProbe,
  'inngest-budget': onLiveInputs(inngestBudgetProbe),
  'agency-trial-removed': agencyTrialRemovedProbe,
} as const satisfies Record<string, Probe>;

export type ProbeId = keyof typeof PROBES;

/** The probes registered through `onLiveInputs` above (live.test.ts holds each one gated). */
export const GATED_PROBES: readonly ProbeId[] = [
  'vercel-env-1',
  'vercel-env-2',
  'vercel-env-3',
  'vercel-env-4',
  'vercel-env-5',
  'stripe-live-prices',
  'worker-release',
  'inngest-budget',
];
