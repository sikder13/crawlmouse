/**
 * The v2 billing portal (CC-03 D8): a Stripe customer portal session for the account's customer, on
 * v2's own configuration (./portal-config.ts), returning to Settings › Plan. An account Stripe does
 * not know yet is v1's 400 `no_customer`.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import type Stripe from 'stripe';
import { z } from 'zod';
import type { BillingResult } from './checkout-v2';
import type { RequestBody } from './request-body';

export interface PortalAccounts {
  /** The account's Stripe customer, or null when it has none. */
  customerOf(accountId: string): Promise<string | null>;
}

/** The Stripe call the portal makes. */
export interface PortalStripe {
  billingPortal: {
    sessions: {
      create(params: Stripe.BillingPortal.SessionCreateParams): PromiseLike<{ url: string }>;
    };
  };
}

export interface PortalDeps {
  accounts: PortalAccounts;
  stripe: PortalStripe;
  /** The id of v2's portal configuration. */
  configuration: () => Promise<string>;
  /** `resolveOrigin(req)`. */
  origin: string;
}

const PortalBody = z.strictObject({ accountId: z.uuid().optional() });

/** A portal body: at most the account; null for anything else. */
export function parsePortal(body: RequestBody): { accountId?: string } | null {
  const parsed = PortalBody.safeParse(body.fields);
  return parsed.success ? parsed.data : null;
}

export async function portalV2(deps: PortalDeps, accountId: string): Promise<BillingResult> {
  const customer = await deps.accounts.customerOf(accountId);
  if (customer === null) return { ok: false, status: 400, error: 'no_customer' };
  const session = await deps.stripe.billingPortal.sessions.create({
    customer,
    configuration: await deps.configuration(),
    return_url: `${deps.origin}/settings/plan`,
  });
  return { ok: true, url: session.url };
}

/** The accounts port over the service-role client: `stripe_customer_id` is not member-readable. */
export function supabasePortalAccounts(admin: SupabaseClient): PortalAccounts {
  return {
    async customerOf(accountId) {
      const { data, error } = await admin
        .from('accounts')
        .select('stripe_customer_id')
        .eq('id', accountId)
        .maybeSingle();
      if (error) throw new Error(`accounts read failed: ${error.message}`);
      if (!data) throw new Error(`account ${accountId} not found`);
      return (data as { stripe_customer_id: string | null }).stripe_customer_id;
    },
  };
}
