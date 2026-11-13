/**
 * The agency account's stored Checkout (migration 20261114000001): its URL, when it was opened and
 * the interval it was opened for. Over the service-role client; no client role can read the columns.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Interval } from '@/lib/billing/catalog';

export interface StoredCheckout {
  url: string;
  at: Date;
  interval: Interval;
}

export interface AgencyCheckouts {
  /** The Checkout stored on the account, or null when none is stored in full. */
  open(accountId: string): Promise<StoredCheckout | null>;
  store(accountId: string, checkout: StoredCheckout): Promise<void>;
}

export function agencyCheckouts(admin: SupabaseClient): AgencyCheckouts {
  return {
    async open(accountId) {
      const { data, error } = await admin
        .from('accounts')
        .select('agency_checkout_url, agency_checkout_at, agency_checkout_interval')
        .eq('id', accountId)
        .maybeSingle();
      if (error) throw new Error(`accounts checkout read failed: ${error.message}`);
      const row = data as {
        agency_checkout_url: string | null;
        agency_checkout_at: string | null;
        agency_checkout_interval: Interval | null;
      } | null;
      return row?.agency_checkout_url && row.agency_checkout_at && row.agency_checkout_interval
        ? {
            url: row.agency_checkout_url,
            at: new Date(row.agency_checkout_at),
            interval: row.agency_checkout_interval,
          }
        : null;
    },
    async store(accountId, { url, at, interval }) {
      const { error } = await admin
        .from('accounts')
        .update({
          agency_checkout_url: url,
          agency_checkout_at: at.toISOString(),
          agency_checkout_interval: interval,
        })
        .eq('id', accountId);
      if (error) throw new Error(`accounts checkout write failed: ${error.message}`);
    },
  };
}
