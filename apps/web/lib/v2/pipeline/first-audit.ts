/**
 * A kept site's first audit (CC-22b D7): requested when a site named on Sign-up is attached, and
 * when a claim keeps a site whose claimed check failed. door-deps.ts gives it to the first-login
 * hook and the claim under V2_CHECKS_PUBLIC with V2_PIPELINE.
 *
 * It counts against the start route's daily ceiling, which fails closed, and the host's hourly
 * bucket: the same two limits the public start counts against (`startLimits`,
 * app/api/checks/_lib/start-limits.ts), given here by door-deps.ts. It is not requested while
 * crawls are paused. The check's id is derived from the site, so two requests for one site make one check and
 * send one event id; a site whose first audit failed is not given another by this path (the second
 * request finds the id taken and answers `has_check`).
 */
import { stableId } from '@crawlmouse/engine/v2/pipeline';
import type { FirstAudit } from '../../auth/door-store';
import { normalizeDomain } from '../../domain';
import { requestCheck, type RequestDeps } from './request';

export interface FirstAuditDeps {
  request: Omit<RequestDeps, 'newId'>;
  /** Whether the site has a check that is queued, running, deferred, finished or partial. */
  hasLiveOrGradedCheck(siteId: string): Promise<boolean>;
  limits: {
    /** The day's ceiling on check starts; false when it is reached or could not be counted. */
    global(): Promise<boolean>;
    /** The hourly bucket of `domain`, a host without a leading `www.`. */
    domain(domain: string): Promise<boolean>;
  };
  /** `isCrawlPaused` (lib/crawl-pause.ts). */
  paused(): boolean;
}

/** The id of a site's first audit. */
export const firstAuditId = (siteId: string): string => stableId('first_audit', siteId);

export function firstAuditRequester(deps: FirstAuditDeps): FirstAudit {
  return async ({ siteId, host, userId }) => {
    if (deps.paused()) return 'paused';
    if (await deps.hasLiveOrGradedCheck(siteId)) return 'has_check';
    if (!(await deps.limits.global())) return 'capacity';
    if (!(await deps.limits.domain(normalizeDomain(host)))) return 'domain_limit';
    const { created } = await requestCheck(
      { ...deps.request, newId: () => firstAuditId(siteId) },
      { siteId, trigger: 'first_audit', requestedByUserId: userId },
    );
    return created ? 'requested' : 'has_check';
  };
}
