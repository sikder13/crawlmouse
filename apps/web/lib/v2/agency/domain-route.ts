/**
 * Goal 1 row 25: what the three domain routes share. Each route checks its caller as the brand route
 * does (`app/api/agency/brand/route.ts`), in its own source so the route-mechanism guard reads it:
 * the account door and `agency_domain` first, then a session, the account named in the query string
 * and `member_role`; `afterMembership` then checks the role, the Agency tier and a rate limit. Only
 * then are the domain steps given their deps.
 */
import 'server-only';
import { randomBytes } from 'node:crypto';
import { resolveTxt } from 'node:dns/promises';
import { checkRateLimit } from '../../rate-limit';
import { supabaseAdmin } from '../../supabase/admin';
import type { SupabaseClient } from '@supabase/supabase-js';
import { refuse } from '../account/route';
import { readEntitlement } from '../account/viewer-read';
import type { DomainAnswer, DomainDeps } from './domain';
import { supabaseDomainStore, type BrandsClient } from './domain-store';
import { vercelConfigured, vercelDomainsFromEnv } from './vercel-domains';

const EDITORS: ReadonlySet<unknown> = new Set(['owner', 'account_manager']);
/** Domain requests one account may make in an hour: a check is a click, and each may call Vercel. */
const PER_HOUR = 20;
const HOUR_MS = 60 * 60 * 1000;

/**
 * What follows the membership check, in each route after its own `member_role` call: the role
 * (owner or account manager), the Agency tier, and the rate limit, each refusing before the next.
 * Null when the caller may go on.
 */
export async function afterMembership(
  sb: SupabaseClient,
  accountId: string,
  role: unknown,
  roleError: { message: string } | null,
): Promise<Response | null> {
  if (roleError) {
    console.error(`agency domain: member_role failed: ${roleError.message}`);
    return refuse(500, 'internal');
  }
  if (!EDITORS.has(role)) return refuse(403, 'role_refused');

  const entitlement = await readEntitlement(sb, accountId, new Date()).catch((e: unknown) => {
    console.error(`agency domain: ${e instanceof Error ? e.message : 'entitlement read failed'}`);
    return undefined;
  });
  if (entitlement === undefined) return refuse(500, 'internal');
  if (entitlement === null || entitlement.tier !== 'agency' || !entitlement.gates.agencyBranding) {
    return refuse(403, 'upgrade_required', { gate: 'agencyBranding' });
  }

  const rl = await checkRateLimit(`agency-domain:${accountId}`, PER_HOUR, HOUR_MS, {
    failClosed: true,
  });
  if (!rl.allowed) return refuse(429, 'rate_limited');
  return null;
}

/** The steps' deps for a request: the service-role store, the Vercel port, the system resolver. */
export function domainDeps(): DomainDeps {
  const now = () => new Date();
  return {
    store: supabaseDomainStore(supabaseAdmin() as unknown as BrandsClient, now),
    vercel: vercelDomainsFromEnv(),
    vercelConfigured: vercelConfigured(),
    resolveTxt,
    newToken: () => randomBytes(16).toString('hex'),
    now,
  };
}

/** A step's answer as the route sends it. Never cached: it carries the TXT token. */
export function domainResponse(answer: DomainAnswer): Response {
  const headers = { 'Cache-Control': 'no-store' };
  if (answer.ok) return Response.json({ domain: answer.view }, { headers });
  const { status, code, reason } = answer;
  return refuse(status, code, reason === undefined ? {} : { reason }, headers);
}
