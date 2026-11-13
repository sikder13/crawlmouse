/**
 * The support console's search box (CC-33 D2): one input, and the kind of query decided by its shape.
 * A uuid is an id (the store tries an account, then a check); `cus_…` a Stripe customer; anything
 * with an `@` an address, matched exactly and lower-cased against `users.email`; anything else a
 * site host, through the Sign-up form's normaliser (`hostFromSiteInput`, which makes no network
 * call). The query is never logged: the record holds its kind and how many accounts it found
 * (app/api/internal/search/route.ts).
 */
import { hostFromSiteInput } from '../../auth/site-host';

export type SearchQuery =
  | { kind: 'id'; id: string }
  | { kind: 'stripe_customer'; customerId: string }
  | { kind: 'email'; email: string }
  | { kind: 'host'; host: string }
  | { kind: 'none' };

/** The longest query read; longer is no query (an address is at most 320 characters). */
export const QUERY_MAX = 320;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const CUSTOMER = /^cus_[A-Za-z0-9]+$/;
const ADDRESS = /^[^@\s]+@[^@\s]+$/;

export function classifyQuery(raw: string): SearchQuery {
  const q = raw.trim();
  if (q === '' || q.length > QUERY_MAX) return { kind: 'none' };
  if (UUID.test(q.toLowerCase())) return { kind: 'id', id: q.toLowerCase() };
  if (CUSTOMER.test(q)) return { kind: 'stripe_customer', customerId: q };
  if (q.includes('@')) {
    return ADDRESS.test(q) ? { kind: 'email', email: q.toLowerCase() } : { kind: 'none' };
  }
  const host = hostFromSiteInput(q);
  return host === null ? { kind: 'none' } : { kind: 'host', host };
}
