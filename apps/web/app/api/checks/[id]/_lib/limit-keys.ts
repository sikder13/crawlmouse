/**
 * The four buckets the stream and notify routes count against: each one's key and its number.
 * `limits.ts` counts them with `checkRateLimit`; the route tests count the same keys in memory.
 *
 * No key holds a check's id or a visitor's address: the limiter stores its key and prints it when
 * its database call fails (lib/rate-limit.ts), so the check is named by `checkRef` and the address
 * by a hash.
 */
import { stableId } from '@crawlmouse/engine/v2/pipeline';
import { NOTIFY_PER_EMAIL_PER_DAY, NOTIFY_PER_IP_PER_DAY } from '../../../../../lib/limits';
import { checkRef } from '../../../../../lib/v2/pipeline/public';

/**
 * Stream opens an address may make in an hour. One tab reconnects every STREAM_CLOSE_MS (240 s),
 * 15 times an hour; this leaves room for eight tabs, or four on a connection that drops as often
 * again.
 */
export const STREAM_OPENS_PER_IP_PER_HOUR = 120;

export const LIMITS = {
  /** Stream opens by one address, an hour. */
  streamOpens: {
    key: (ip: string) => `stream:ip:${ip}`,
    limit: STREAM_OPENS_PER_IP_PER_HOUR,
  },
  /** The marker `check_finished` takes: one capture for a check in the bucket's day. */
  finishedOnce: {
    key: (checkId: string) => `event:check_finished:${checkRef(checkId)}`,
    limit: 1,
  },
  /** Notify requests by one address, a day: v1's key and number. */
  notifyIp: { key: (ip: string) => `notify:ip:${ip}`, limit: NOTIFY_PER_IP_PER_DAY },
  /** Notify requests naming one email address, a day: v1's number, the address hashed. */
  notifyAddress: {
    key: (email: string) => `notify:email:${stableId('notify_email', email)}`,
    limit: NOTIFY_PER_EMAIL_PER_DAY,
  },
} as const;

/** Whether one more is allowed in each bucket's current window; a call counts. */
export type CheckRouteLimits = {
  [K in keyof typeof LIMITS]: (subject: string) => Promise<boolean>;
};
