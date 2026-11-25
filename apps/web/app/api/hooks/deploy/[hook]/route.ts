import * as Sentry from '@sentry/nextjs';
import { checksPublicEnabled, pipelineEnabled } from '@/lib/auth/flags';
import { getClientIp } from '@/lib/client-ip';
import { isCrawlPaused } from '@/lib/crawl-pause';
import { checkRateLimit } from '@/lib/rate-limit';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { deployHookSecret, parseDeployHook, verifyDeployHook } from '@/lib/v2/account/deploy-hook';
import { notFound, refuse } from '@/lib/v2/account/route';
import { supabaseRequestRecheck } from '@/lib/v2/account/sites-store';
import { readEntitlement } from '@/lib/v2/account/viewer';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Calls one address may make in an hour: well above a project's deploys. */
const PER_IP_HOUR = 60;
const HOUR_MS = 60 * 60 * 1000;

/**
 * A staging site's deploy hook (Goal 1 row 20, F-097): a deploy posts here, and a check of the
 * staging site is queued with trigger `deploy`.
 *
 * It answers, in order:
 * - 404 with V2_CHECKS_PUBLIC unset;
 * - 503 `not_configured` with no `DEPLOY_HOOK_SECRET`;
 * - 404 for an address that is not a hook's shape;
 * - 429 over the per-address hour, before any read;
 * - 503 while crawls are paused or the pipeline is off;
 * - the same 404 for no such site, a signature that is not the site's (compared in constant time), a
 *   site that is not a live staging site, or a site nobody keeps (which the `sites_staging_kept`
 *   constraint already forbids for a staging site; the check narrows the type), so the answer says
 *   nothing about which;
 * - 402 when the account's plan has no deploy hooks.
 *
 * The check goes through `request_capped_check`, under the plan's `checksPerSiteDay` counted over
 * deploy checks alone; a repeat inside the deploy bucket finds the check it queued. There is no
 * Turnstile, because a deploy cannot solve one: the signature is the credential.
 */
export async function POST(req: Request, { params }: { params: Promise<{ hook: string }> }) {
  if (!checksPublicEnabled()) return notFound();
  const secret = deployHookSecret();
  if (secret === null) return refuse(503, 'not_configured');
  const parsed = parseDeployHook((await params).hook);
  if (parsed === null) return notFound();

  const limit = await checkRateLimit(`deploy-hook:ip:${getClientIp(req)}`, PER_IP_HOUR, HOUR_MS);
  if (!limit.allowed) return refuse(429, 'rate_limited');
  if (isCrawlPaused()) return refuse(503, 'paused');
  if (!pipelineEnabled()) return refuse(503, 'unavailable');

  const admin = supabaseAdmin();
  const { data: site, error } = await admin
    .from('sites')
    .select('id, account_id, created_at, staging_of_site_id, removed_at')
    .eq('id', parsed.siteId)
    .maybeSingle();
  if (error) throw new Error(`deploy hook: sites read failed: ${error.message}`);
  if (
    site === null ||
    !verifyDeployHook(parsed.signature, site.id as string, site.created_at as string, secret) ||
    site.staging_of_site_id === null ||
    site.removed_at !== null ||
    site.account_id === null
  ) {
    return notFound();
  }

  const entitlement = await readEntitlement(admin, site.account_id as string, new Date());
  if (entitlement === null) return notFound();
  if (!entitlement.gates.stagingAndDeployHooks) return refuse(402, 'upgrade_required');

  let outcome;
  try {
    outcome = await supabaseRequestRecheck(admin)({
      siteId: parsed.siteId,
      trigger: 'deploy',
      cap: entitlement.gates.checksPerSiteDay,
    });
  } catch (cause) {
    // Before migration 20261124000001 is applied, the database refuses a deploy check.
    Sentry.captureException(cause);
    return refuse(503, 'unavailable');
  }
  if (outcome.queued) {
    return Response.json({ checkId: outcome.checkId, created: outcome.created }, { status: 202 });
  }
  switch (outcome.reason) {
    case 'capped':
    case 'recently_checked': {
      const seconds = Math.max(
        1,
        Math.ceil((Date.parse(outcome.nextAllowedAt) - Date.now()) / 1000),
      );
      return refuse(
        429,
        outcome.reason,
        { nextAllowedAt: outcome.nextAllowedAt },
        { 'retry-after': String(seconds) },
      );
    }
    case 'check_running':
      return refuse(409, 'check_running', { checkId: outcome.checkId });
    case 'capacity':
      return refuse(503, 'capacity');
    case 'removed':
      return notFound();
    case 'paused':
      return refuse(409, 'site_paused');
  }
}
