/**
 * CC-33's Inngest functions as production wires them, for the serve route's list
 * (lib/v2/pipeline/functions.ts): the founder's notices (D3) with V2_BILLING or V2_CHECKS_PUBLIC set
 * to `1`, and the sign-in canary (D6) as well when SIGNIN_CANARY_TO is one plain address; its link is
 * asked for through `requestSignInLink` unless a test passes another `SignInLink`. Everything is built when a function runs, not when the route loads.
 */
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type { InngestFunction } from 'inngest';
import {
  createFounderDigestFn,
  createFounderEntitlementFn,
  createFounderSweepFn,
  type FounderWork,
} from '../../../../../inngest/founder';
import { createSigninCanaryFn } from '../../../../../inngest/signin-canary';
import { checksPublicEnabled } from '../../auth/flags';
import { billingV2Enabled } from '../../billing/flags';
import { stripeAccount } from '../../billing/stripe-account';
import { mailPepper } from '../mail/address-hash';
import { mailLog } from '../mail/functions';
import { isPlainAddress } from '../mail/headers';
import { supabaseMailLedger } from '../mail/ledger';
import { resendTransport } from '../mail/transport';
import { canaryWork, reportCanary, type SignInLink } from './canary';
import { digest, entitlementNotice, sweep, type FounderDeps, type LatestInvoice } from './founder';
import { supabaseFounderStore } from './founder-store';
import { requestSignInLink } from './sign-in-link';

type Env = Readonly<Record<string, string | undefined>>;

const serviceClient = (env: Env): SupabaseClient =>
  createClient(env.NEXT_PUBLIC_SUPABASE_URL ?? '', env.SUPABASE_SERVICE_ROLE_KEY ?? '', {
    auth: { persistSession: false },
  });

/** The followed subscription's latest invoice: Stripe's amounts and currency, never a card field. */
async function latestInvoice(env: Env, subscriptionId: string): Promise<LatestInvoice | null> {
  const sub = await stripeAccount(env).subscriptions.retrieve(subscriptionId, {
    expand: ['latest_invoice'],
  });
  const inv = sub.latest_invoice;
  if (inv === null || typeof inv === 'string') return null;
  return { amountPaid: inv.amount_paid, amountDue: inv.amount_due, currency: inv.currency };
}

export function founderDeps(env: Env): FounderDeps {
  const sb = serviceClient(env);
  return {
    mail: {
      ledger: supabaseMailLedger(sb),
      transport: resendTransport(env.RESEND_API_KEY),
      pepper: mailPepper(env),
      now: () => new Date(),
      log: mailLog,
    },
    store: supabaseFounderStore(sb),
    latestInvoice: (id) => latestInvoice(env, id),
    async confirmed(userId) {
      const { data, error } = await sb.auth.admin.getUserById(userId);
      if (error) throw new Error(`getUserById: ${error.status ?? 'error'}`);
      return Boolean(data.user?.email_confirmed_at);
    },
    to: env.FOUNDER_NOTIFY_TO ?? null,
    now: () => new Date(),
    log: (event, fields) => console.warn(JSON.stringify({ event, ...fields })),
  };
}

export function opsFunctions(
  env: Env = process.env,
  signIn: SignInLink = requestSignInLink,
): InngestFunction.Like[] {
  if (!billingV2Enabled(env) && !checksPublicEnabled(env)) return [];
  const work = (): FounderWork => {
    const d = founderDeps(env);
    return {
      entitlement: (ev) => entitlementNotice(d, ev),
      sweep: () => sweep(d),
      digest: () => digest(d),
    };
  };
  const fns: InngestFunction.Like[] = [
    createFounderEntitlementFn(work),
    createFounderSweepFn(work),
    createFounderDigestFn(work),
  ];
  const canaryTo = env.SIGNIN_CANARY_TO?.trim() ?? '';
  if (canaryTo !== '' && isPlainAddress(canaryTo)) {
    fns.push(
      createSigninCanaryFn(() =>
        canaryWork({
          to: canaryTo,
          signIn,
          sb: serviceClient(env),
          now: () => new Date(),
          report: reportCanary,
        }),
      ),
    );
  }
  return fns;
}
