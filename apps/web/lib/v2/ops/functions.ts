/**
 * CC-33's Inngest functions as production wires them, for the serve route's list
 * (lib/v2/pipeline/functions.ts): the founder's notices (D3) with V2_BILLING or V2_CHECKS_PUBLIC set
 * to `1`, and the sign-in canary (D6) as well when SIGNIN_CANARY_TO is one plain address; its link is
 * asked for through `requestSignInLink` unless a test passes another `SignInLink`. Everything is built when a function runs, not when the route loads.
 */
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type { InngestFunction } from 'inngest';
import type Stripe from 'stripe';
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
import { digest, entitlementNotice, sweep, type FounderDeps, type PaymentRecord } from './founder';
import { supabaseFounderStore } from './founder-store';
import { requestSignInLink } from './sign-in-link';

type Env = Readonly<Record<string, string | undefined>>;

const serviceClient = (env: Env): SupabaseClient =>
  createClient(env.NEXT_PUBLIC_SUPABASE_URL ?? '', env.SUPABASE_SERVICE_ROLE_KEY ?? '', {
    auth: { persistSession: false },
  });

/** The Stripe reads `stripePayment` makes. */
export interface StripeReads {
  subscriptions: Pick<Stripe['subscriptions'], 'retrieve'>;
  invoices: Pick<Stripe['invoices'], 'list'>;
}

/** Paid invoices read to find an earlier payment; `unknown` when more are left unread. */
export const PAID_INVOICES_READ = 10;

/**
 * Stripe's record of a subscription's payment (review C2, C3): its latest invoice (status, both
 * amounts, currency; never a card field), and whether the customer has another paid invoice with an
 * amount above 0. A zero-amount paid invoice is left out: Stripe creates and pays one when a trial
 * starts. The listing is `invoices.list({ customer, status: 'paid' })`, bounded by PAID_INVOICES_READ.
 */
export async function stripePayment(
  stripe: StripeReads,
  subscriptionId: string,
): Promise<PaymentRecord> {
  const sub = await stripe.subscriptions.retrieve(subscriptionId, { expand: ['latest_invoice'] });
  const inv = sub.latest_invoice;
  const latest = inv === null || typeof inv === 'string' ? null : inv;
  const customer = typeof sub.customer === 'string' ? sub.customer : sub.customer.id;
  const paid = await stripe.invoices.list({ customer, status: 'paid', limit: PAID_INVOICES_READ });
  const earlier = paid.data.some((i) => i.id !== latest?.id && i.amount_paid > 0)
    ? 'some'
    : paid.has_more
      ? 'unknown'
      : 'none';
  return {
    invoice:
      latest === null
        ? null
        : {
            status: latest.status,
            amountPaid: latest.amount_paid,
            amountDue: latest.amount_due,
            currency: latest.currency,
          },
    earlier,
  };
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
    payment: (id) => stripePayment(stripeAccount(env), id),
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
      digest: (at) => digest(d, new Date(at)),
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
