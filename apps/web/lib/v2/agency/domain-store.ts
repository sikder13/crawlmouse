/**
 * Goal 1 row 25: the `DomainStore` over `public.agency_brands`, through the service-role client (the
 * table's portal columns are written by `service_role` only; members read them under row security).
 * Every write names the account and, after the claim, the host it expects, so a step that races a
 * removal or a new claim writes nothing.
 */
import 'server-only';
import type { DomainPatch, DomainRow, DomainStatus, DomainStore } from './domain';

const COLUMNS =
  'portal_domain, portal_domain_status, portal_txt_token, portal_txt_verified_at, portal_cname_found, portal_certificate_issued_at, vercel_domain_added_at';

interface Row {
  portal_domain: string | null;
  portal_domain_status: DomainStatus;
  portal_txt_token: string | null;
  portal_txt_verified_at: string | null;
  portal_cname_found: boolean | null;
  portal_certificate_issued_at: string | null;
  vercel_domain_added_at: string | null;
}

type Answer<T> = PromiseLike<{ data: T | null; error: { code?: string; message?: string } | null }>;

/** The calls the store makes, as `supabase-js` answers them. */
export interface BrandsClient {
  from(table: 'agency_brands'): {
    select(columns: string): { eq(column: string, value: string): Answer<Row[]> };
    update(values: Record<string, unknown>): BrandsFilter;
  };
}
interface BrandsFilter {
  eq(column: string, value: string): BrandsFilter;
  is(column: string, value: null): BrandsFilter;
  select(columns: string): Answer<{ account_id: string }[]>;
}

const UNIQUE_VIOLATION = '23505';

function patchColumns(patch: DomainPatch, now: string): Record<string, unknown> {
  const out: Record<string, unknown> = { updated_at: now };
  if (patch.status !== undefined) out.portal_domain_status = patch.status;
  if (patch.txtVerifiedAt !== undefined) out.portal_txt_verified_at = patch.txtVerifiedAt;
  if (patch.cnameFound !== undefined) out.portal_cname_found = patch.cnameFound;
  if (patch.certificateAt !== undefined) out.portal_certificate_issued_at = patch.certificateAt;
  if (patch.vercelAddedAt !== undefined) out.vercel_domain_added_at = patch.vercelAddedAt;
  return out;
}

export function supabaseDomainStore(db: BrandsClient, now: () => Date): DomainStore {
  const fail = (what: string, e: { message?: string } | null) => {
    throw new Error(`agency domain: ${what} failed${e?.message ? `: ${e.message}` : ''}`);
  };

  async function read(accountId: string): Promise<DomainRow | null | 'no_brand'> {
    const { data, error } = await db
      .from('agency_brands')
      .select(COLUMNS)
      .eq('account_id', accountId);
    if (error || !data) return fail('read', error);
    const row = data[0];
    if (row === undefined) return 'no_brand';
    if (row.portal_domain === null) return null;
    return {
      host: row.portal_domain,
      status: row.portal_domain_status,
      txtToken: row.portal_txt_token,
      txtVerifiedAt: row.portal_txt_verified_at,
      cnameFound: row.portal_cname_found === true,
      certificateAt: row.portal_certificate_issued_at,
      vercelAddedAt: row.vercel_domain_added_at,
    };
  }

  return {
    read,
    async claim(accountId, host, token) {
      const { data, error } = await db
        .from('agency_brands')
        .update({
          portal_domain: host,
          portal_domain_status: 'unverified',
          portal_txt_token: token,
          portal_txt_verified_at: null,
          portal_cname_found: false,
          portal_certificate_issued_at: null,
          vercel_domain_added_at: null,
          updated_at: now().toISOString(),
        })
        .eq('account_id', accountId)
        .is('portal_domain', null)
        .select('account_id');
      if (error?.code === UNIQUE_VIOLATION) return 'in_use';
      if (error || !data) return fail('claim', error);
      if (data.length === 1) return 'claimed';
      const held = await read(accountId);
      return held === 'no_brand' ? 'no_brand' : 'has_host';
    },
    async update(accountId, host, patch) {
      const { data, error } = await db
        .from('agency_brands')
        .update(patchColumns(patch, now().toISOString()))
        .eq('account_id', accountId)
        .eq('portal_domain', host)
        .select('account_id');
      if (error || !data) return fail('update', error);
      return data.length === 1;
    },
    async clear(accountId, host) {
      const { data, error } = await db
        .from('agency_brands')
        .update({
          portal_domain: null,
          portal_domain_status: 'unverified',
          portal_txt_token: null,
          portal_txt_verified_at: null,
          portal_cname_found: null,
          portal_certificate_issued_at: null,
          vercel_domain_added_at: null,
          updated_at: now().toISOString(),
        })
        .eq('account_id', accountId)
        .eq('portal_domain', host)
        .select('account_id');
      if (error || !data) return fail('clear', error);
      return data.length === 1;
    },
  };
}
