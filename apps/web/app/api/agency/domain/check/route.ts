import { accountDoorEnabled } from '@/lib/auth/flags';
import { featureShown } from '@/lib/feature-switch';
import { supabaseServer } from '@/lib/supabase/server';
import { isId, notFound, refuse } from '@/lib/v2/account/route';
import { checkDomain } from '@/lib/v2/agency/domain';
import { afterMembership, domainDeps, domainResponse } from '@/lib/v2/agency/domain-route';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Goal 1 row 25, "Check now": reads the host's TXT record, attaches the host to the Vercel project
 * once the record proves control, and marks it `verified` once Vercel serves it. A 503 without the
 * owner's Vercel token, before anything is read or written.
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
  return domainResponse(await checkDomain(domainDeps(), accountId));
}
