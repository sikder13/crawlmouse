/**
 * Goal 1 row 25, server side: which agency a request on a portal host serves. The middleware has let
 * through only a share link and the page it opens, with the host in `PORTAL_HOST_HEADER` (deleted
 * from every request on our own hosts, so only the middleware sets it). Each of those two routes asks
 * `portalScope` before it reads a link, and on a portal host opens only that agency's reports.
 */
import 'server-only';
import { featureShown } from '../../feature-switch';
import { normalizeHost, PORTAL_HOST_HEADER, portalHostRefusal } from './portal-host';

/** The one read `portalScope` makes: `agency_brands`, through the service-role client. */
export interface PortalReader {
  from(table: 'agency_brands'): {
    select(columns: 'account_id'): {
      eq(
        column: 'portal_domain',
        value: string,
      ): {
        eq(
          column: 'portal_domain_status',
          value: 'verified',
        ): PromiseLike<{ data: { account_id: string }[] | null; error: unknown }>;
      };
    };
  };
}

export type PortalScope =
  /** Our own host: the route answers as it always has. */
  | { kind: 'own' }
  /** A verified agency host: only `accountId`'s reports open, and links lead back to `origin`. */
  | { kind: 'portal'; host: string; origin: string; accountId: string }
  /** A portal host that may serve nothing: the route answers as for a link that does not exist. */
  | { kind: 'refused' };

/**
 * The scope of a request, from the header the middleware set. A host is served only while
 * `agency_domain` is shown, the host passes the attach rules again (a row written before a rule
 * tightened is not served), and exactly one `agency_brands` row holds it as `verified`. A read
 * error refuses: the route fails closed.
 */
export async function portalScope(
  headers: Pick<Headers, 'get'>,
  reader: () => PortalReader,
  env: Readonly<Record<string, string | undefined>> = process.env,
): Promise<PortalScope> {
  const raw = headers.get(PORTAL_HOST_HEADER);
  if (raw === null) return { kind: 'own' };
  if (!featureShown('agency_domain', env)) return { kind: 'refused' };
  const host = normalizeHost(raw);
  if (portalHostRefusal(host) !== null) return { kind: 'refused' };
  const { data, error } = await reader()
    .from('agency_brands')
    .select('account_id')
    .eq('portal_domain', host)
    .eq('portal_domain_status', 'verified');
  if (error || !data || data.length !== 1) return { kind: 'refused' };
  return { kind: 'portal', host, origin: `https://${host}`, accountId: data[0]!.account_id };
}
