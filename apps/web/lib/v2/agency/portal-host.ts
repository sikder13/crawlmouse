/**
 * Goal 1 row 25: an Agency's own host for its client portal. The pure rules the middleware, the
 * routes and the tests share:
 *
 * - `portalHostRefusal`: whether a host an agency types may ever be attached, and if not, why;
 * - `isOwnHost` (from `own-host.ts`, re-exported): whether a request's host is one of ours;
 * - `portalPathAllowed`: the only paths a request on any other host may reach.
 *
 * Edge-safe: `tldts` is pure JavaScript and no Node built-in is imported here.
 */
import { parse } from 'tldts';
import { normalizeHost } from './own-host';

export { hostnameOf, isOwnHost, normalizeHost, OWN_HOST_MATCHER } from './own-host';

/** Why a host is refused, one code per rule, said to the agency by the route. */
export type PortalHostRefusal =
  | 'empty'
  | 'too_long'
  | 'not_ascii'
  | 'idn'
  | 'bad_label'
  | 'single_label'
  | 'ip'
  | 'unknown_suffix'
  | 'public_suffix'
  | 'apex'
  | 'reserved'
  | 'ours';

/**
 * Registrable domains no agency may use a host under: ours, and Vercel's, whose hosts point at
 * every Vercel project. Matched on the registrable domain `tldts` reads, and on the host itself.
 */
const DENIED_DOMAINS: readonly string[] = [
  'crawlmouse.com',
  'nahltech.com',
  'vercel.app',
  'vercel.com',
  'vercel.sh',
  'now.sh',
];

/** Vercel's DNS hosts are `vercel-dns.com` and `vercel-dns-NNN.com`. */
const VERCEL_DNS = /^vercel-dns(-\d+)?\.com$/;

/**
 * Top-level names that are special-use (RFC 6761, 6762, 7686, 8375, ICANN's `.internal`) or
 * infrastructure: some are in the ICANN section of the suffix list (`arpa`, `onion`), so the
 * section check alone does not refuse them.
 */
const RESERVED_TLDS: ReadonlySet<string> = new Set([
  'arpa',
  'example',
  'internal',
  'invalid',
  'local',
  'localhost',
  'onion',
  'test',
]);

const MAX_HOST = 253;
const MAX_LABEL = 63;
const LDH_LABEL = /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/;
const IPV4ISH = /^[0-9.]+$/;

/**
 * Null when `raw` may be attached as an agency's portal host, otherwise the first rule it breaks.
 * The rules, in order: present; at most 253 characters; ASCII only and no `xn--` label (v1 takes no
 * internationalised host, so none mixes scripts); every label 1 to 63 letters, digits and inner
 * hyphens; more than one label; not an IP literal; a suffix in the ICANN section of the public
 * suffix list (a private-section suffix such as `github.io` is a platform's, not the agency's); not a
 * special-use top-level name; not itself a public suffix; below its registrable domain, since an
 * apex cannot carry the CNAME; and under none of the domains in `DENIED_DOMAINS`.
 */
export function portalHostRefusal(raw: string): PortalHostRefusal | null {
  const host = normalizeHost(raw);
  if (host === '') return 'empty';
  if (host.length > MAX_HOST) return 'too_long';
  if (!/^[\x00-\x7f]*$/.test(host)) return 'not_ascii';
  if (host.includes(':') || host.startsWith('[')) return 'ip';
  const labels = host.split('.');
  if (labels.some((l) => l.startsWith('xn--'))) return 'idn';
  if (labels.some((l) => l.length === 0 || l.length > MAX_LABEL || !LDH_LABEL.test(l))) {
    return 'bad_label';
  }
  if (IPV4ISH.test(host)) return 'ip';
  if (labels.length < 2) return 'single_label';
  const parsed = parse(host, { allowPrivateDomains: true });
  if (parsed.isIp) return 'ip';
  const tld = labels[labels.length - 1]!;
  if (RESERVED_TLDS.has(tld)) return 'reserved';
  if (parsed.isIcann !== true) return 'unknown_suffix';
  if (parsed.domain === null || parsed.publicSuffix === host) return 'public_suffix';
  if (parsed.domain === host) return 'apex';
  if (isDenied(host) || isDenied(parsed.domain)) return 'ours';
  return null;
}

function isDenied(name: string): boolean {
  return DENIED_DOMAINS.some((d) => name === d || name.endsWith(`.${d}`)) || VERCEL_DNS.test(name);
}

const SHARE_TOKEN_PATH = /^\/s\/[A-Za-z0-9_-]{22}$/;
const SHARE_VIEW_PATH = /^\/s\/view\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const STATIC_ASSET = /^\/_next\/static\//;

/**
 * Whether a request on a portal host may reach the app at all: a GET or HEAD of a share link
 * (`/s/<token>`), of the page that link opens (`/s/view/<report id>`), or of one of Next's static
 * files those pages load. Everything else on such a host, every `/api` path and every other method
 * included, is a 404 before any route runs. The token's own shape is checked again by the route.
 */
export function portalPathAllowed(method: string, path: string): boolean {
  if (method !== 'GET' && method !== 'HEAD') return false;
  if (STATIC_ASSET.test(path)) return true;
  if (path === '/s/view' || path.startsWith('/s/view/')) return SHARE_VIEW_PATH.test(path);
  return SHARE_TOKEN_PATH.test(path);
}

/** The request header the middleware sets to the portal host it served, after deleting any sent. */
export const PORTAL_HOST_HEADER = 'x-crawlmouse-portal-host';
