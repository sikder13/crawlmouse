/**
 * A kept site's first audit (CC-22b D7): requested when a site named on Sign-up is attached, and
 * when a claim keeps a site whose claimed check failed. door-deps.ts gives it to the first-login
 * hook and the claim under V2_CHECKS_PUBLIC with V2_PIPELINE.
 *
 * It counts against the start route's daily ceiling, which fails closed, and the host's hourly
 * bucket, with that route's keys and limits (questions Q15), and is not requested while crawls are
 * paused. The check's id is derived from the site, so two requests for one site make one check and
 * send one event id; a site whose first audit failed is not given another by this path (the second
 * request finds the id taken and answers `has_check`).
 */
import { stableId } from '@crawlmouse/engine/v2/pipeline';
import type { FirstAudit } from '../../auth/door-store';
import { normalizeDomain } from '../../domain';
import { DOMAIN_AUDITS_PER_HOUR, GLOBAL_AUDITS_PER_DAY } from '../../limits';
import { requestCheck, type RequestDeps } from './request';

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

export interface FirstAuditDeps {
  request: Omit<RequestDeps, 'newId'>;
  /** Whether the site has a check that is queued, running, deferred, finished or partial. */
  hasLiveOrGradedCheck(siteId: string): Promise<boolean>;
  /** `checkRateLimit` (lib/rate-limit.ts). */
  limit(
    key: string,
    limit: number,
    windowMs: number,
    opts?: { failClosed?: boolean },
  ): Promise<{ allowed: boolean }>;
  /** `isCrawlPaused` (lib/crawl-pause.ts). */
  paused(): boolean;
}

/** The id of a site's first audit. */
export const firstAuditId = (siteId: string): string => stableId('first_audit', siteId);

export function firstAuditRequester(deps: FirstAuditDeps): FirstAudit {
  return async ({ siteId, host, userId }) => {
    if (deps.paused()) return 'paused';
    if (await deps.hasLiveOrGradedCheck(siteId)) return 'has_check';
    const global = await deps.limit('global:audits:day', GLOBAL_AUDITS_PER_DAY, DAY_MS, {
      failClosed: true,
    });
    if (!global.allowed) return 'capacity';
    const domain = await deps.limit(
      `domain:${normalizeDomain(host)}`,
      DOMAIN_AUDITS_PER_HOUR,
      HOUR_MS,
    );
    if (!domain.allowed) return 'domain_limit';
    const { created } = await requestCheck(
      { ...deps.request, newId: () => firstAuditId(siteId) },
      { siteId, trigger: 'first_audit', requestedByUserId: userId },
    );
    return created ? 'requested' : 'has_check';
  };
}
