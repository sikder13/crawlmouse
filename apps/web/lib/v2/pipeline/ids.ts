/**
 * The idempotency key of a check request (ARCH-2 §4.1) and the check id it gives. A bucketed key's
 * check id is derived from the key, so the `checks` insert and the event (whose `id` is the key)
 * deduplicate together: two requests in one bucket make one row and one run.
 */
import { stableId } from '@crawlmouse/engine/v2/pipeline';
import type { Check } from '@crawlmouse/types/v2';
import { DEPLOY_BUCKET_S, MANUAL_BUCKET_S } from './limits';

export interface KeyInput {
  siteId: string;
  trigger: Check['trigger'];
  /** An account keeps the site. */
  kept: boolean;
  /** Milliseconds since the epoch. */
  now: number;
  /** `sites.next_check_at`; a scheduled request is keyed on it. */
  nextCheckAt: string | null;
}

const bucket = (now: number, seconds: number): number => Math.floor(now / (seconds * 1000));

/** The bucketed key, or null when the request is keyed by its own fresh check id. */
export function bucketedKey(k: KeyInput): string | null {
  if (!k.kept) return null;
  switch (k.trigger) {
    case 'manual':
      return `check:${k.siteId}:manual:${bucket(k.now, MANUAL_BUCKET_S)}`;
    case 'fix_recheck':
      return `check:${k.siteId}:recheck:${bucket(k.now, MANUAL_BUCKET_S)}`;
    case 'deploy':
      return `check:${k.siteId}:deploy:${bucket(k.now, DEPLOY_BUCKET_S)}`;
    case 'scheduled':
      if (k.nextCheckAt === null) {
        throw new Error(`requestCheck: site ${k.siteId} has no next_check_at to schedule from`);
      }
      return `check:${k.siteId}:scheduled:${new Date(k.nextCheckAt).toISOString()}`;
    case 'first_audit':
      return null;
  }
}

/** The key of a request that is not bucketed: an audit nobody keeps, or a site's first audit. */
export const freshKey = (k: Pick<KeyInput, 'siteId' | 'kept'>, checkId: string): string =>
  k.kept ? `check:${k.siteId}:first_audit:${checkId}` : `check:anon:${checkId}`;

/** The check id a bucketed key names: a version-8 UUID of the key (the engine's stableId). */
export const checkIdOfKey = (key: string): string => stableId('check_request', key);
