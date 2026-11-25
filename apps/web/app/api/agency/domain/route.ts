import { accountDoorEnabled } from '@/lib/auth/flags';
import { featureShown } from '@/lib/feature-switch';
import { supabaseServer } from '@/lib/supabase/server';
import { isId, notFound, readBody, refuse } from '@/lib/v2/account/route';
import { claimDomain, removeDomain } from '@/lib/v2/agency/domain';
import { afterMembership, domainDeps, domainResponse } from '@/lib/v2/agency/domain-route';

// node:crypto (the TXT token) and node:dns (the check) need the Node runtime.
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** A host is at most 253 characters; the body needs little more. */
const BODY_MAX = 1024;

/**
 * Goal 1 row 25: an Agency account names its portal host (`{ "host": "reports.example.com" }`,
 * `?account=<uuid>`). The host is stored `unverified` with a TXT token, and the answer names the TXT
 * record to add; nothing is attached until `check` reads it. A 404 while `agency_domain` is hidden.
 * The middleware has already refused a cross-site request and a body not declared JSON.
 */
export async function POST(req: Request) {
  // The account door and the Goal 1 switch, before the session is read.
  if (!accountDoorEnabled()) return notFound();
  if (!featureShown('agency_domain')) return notFound();
  const sb = await supabaseServer();
  const {
    data: { user },
  } = await sb.auth.getUser();
  if (!user) return refuse(401, 'auth_required');
  const accountId = new URL(req.url).searchParams.get('account');
  if (accountId === null || !isId(accountId)) return refuse(400, 'invalid');
  const { data: role, error: roleError } = await sb.rpc('member_role', { p_account: accountId });
  const refused = await afterMembership(sb, accountId, role, roleError);
  if (refused) return refused;
  const declared = req.headers.get('content-length');
  if (declared !== null && !(/^\d+$/.test(declared) && Number(declared) <= BODY_MAX)) {
    return refuse(413, 'too_large');
  }
  const body = await readBody(req).catch(() => null);
  const host = body?.kind === 'json' ? body.fields.host : undefined;
  if (typeof host !== 'string' || host.length > BODY_MAX) return refuse(400, 'invalid');
  return domainResponse(await claimDomain(domainDeps(), accountId, host));
}

/**
 * Removes the account's portal host: off the Vercel project first, then its columns cleared. The
 * answer still names the host, so the page can tell the agency to delete its CNAME.
 */
export async function DELETE(req: Request) {
  // The account door and the Goal 1 switch, before the session is read.
  if (!accountDoorEnabled()) return notFound();
  if (!featureShown('agency_domain')) return notFound();
  const sb = await supabaseServer();
  const {
    data: { user },
  } = await sb.auth.getUser();
  if (!user) return refuse(401, 'auth_required');
  const accountId = new URL(req.url).searchParams.get('account');
  if (accountId === null || !isId(accountId)) return refuse(400, 'invalid');
  const { data: role, error: roleError } = await sb.rpc('member_role', { p_account: accountId });
  const refused = await afterMembership(sb, accountId, role, roleError);
  if (refused) return refused;
  return domainResponse(await removeDomain(domainDeps(), accountId));
}
