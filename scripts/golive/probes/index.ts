/** Every automatic probe, by id. preconditions.test.ts fails on a registry row naming another id. */
import { inngestBudgetProbe } from './inngest';
import { migrationsProbe } from './migrations';
import { agencyTrialRemovedProbe } from './repo';
import { resendProbe } from './resend';
import { stripeProbe } from './stripe';
import type { Probe } from './types';
import { vercelEnvProbe } from './vercel-env';
import { healthzProbe, releaseProbe } from './worker';

export const PROBES = {
  'vercel-env-1': vercelEnvProbe(1),
  'vercel-env-2': vercelEnvProbe(2),
  'vercel-env-3': vercelEnvProbe(3),
  'vercel-env-4': vercelEnvProbe(4),
  'vercel-env-5': vercelEnvProbe(5),
  migrations: migrationsProbe(),
  'worker-healthz': healthzProbe,
  'worker-release': releaseProbe(),
  'stripe-live-prices': stripeProbe,
  'resend-domain': resendProbe,
  'inngest-budget': inngestBudgetProbe,
  'agency-trial-removed': agencyTrialRemovedProbe,
} as const satisfies Record<string, Probe>;

export type ProbeId = keyof typeof PROBES;
