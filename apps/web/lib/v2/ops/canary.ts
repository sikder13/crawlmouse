/**
 * The sign-in canary's work as production wires it (D6; the function is inngest/signin-canary.ts):
 * the link is asked for through `SignInLink` (lib/v2/ops/sign-in-link.ts's `requestSignInLink`), the
 * delivery is looked for with `signin_delivery_seen` over the service-role client, and a failure,
 * the canary's own included, is Sentry's `signal: signin-canary` with its `stage`. Nothing here logs
 * or reports the address.
 */
import * as Sentry from '@sentry/nextjs';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { CanaryStage, CanaryWork } from '../../../../../inngest/signin-canary';

/** Asks Supabase Auth for a sign-in link to an existing user's address. */
export type SignInLink = (email: string) => Promise<'sent' | 'refused'>;

export interface CanaryDeps {
  /** SIGNIN_CANARY_TO, already checked to be one plain address. */
  to: string;
  signIn: SignInLink;
  sb: Pick<SupabaseClient, 'rpc'>;
  now(): Date;
  report: CanaryWork['report'];
}

export function canaryWork(d: CanaryDeps): CanaryWork {
  return {
    now: d.now,
    request: () => d.signIn(d.to),
    async delivered(sinceIso) {
      const { data, error } = await d.sb.rpc('signin_delivery_seen', {
        p_address: d.to,
        p_since: sinceIso,
      });
      if (error) throw new Error(`signin_delivery_seen: ${error.code ?? 'error'}`);
      return data === true;
    },
    report: d.report,
  };
}

const FLUSH_MS = 2000;

/** The signal, with its stage; flushed before the step ends, since the function's process may not outlive it. */
export async function reportCanary(stage: CanaryStage): Promise<void> {
  Sentry.captureMessage('signin-canary', {
    level: 'error',
    tags: { signal: 'signin-canary', stage },
  });
  if (Sentry.getClient() === undefined) {
    console.error(JSON.stringify({ event: 'ops.signin_canary', stage, sentry: 0 }));
    return;
  }
  if (!(await Sentry.flush(FLUSH_MS))) throw new Error('the canary signal was not flushed in time');
}
