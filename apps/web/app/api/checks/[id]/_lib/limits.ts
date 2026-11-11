import 'server-only';
import { checkRateLimit } from '@/lib/rate-limit';
import { LIMITS, type CheckRouteLimits } from './limit-keys';

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

/** The stream and notify routes' buckets, counted by `checkRateLimit` (each fails open). */
export const checkRouteLimits: CheckRouteLimits = {
  async streamOpens(ip) {
    const { key, limit } = LIMITS.streamOpens;
    return (await checkRateLimit(key(ip), limit, HOUR_MS)).allowed;
  },
  async finishedOnce(checkId) {
    const { key, limit } = LIMITS.finishedOnce;
    return (await checkRateLimit(key(checkId), limit, DAY_MS)).allowed;
  },
  async notifyIp(ip) {
    const { key, limit } = LIMITS.notifyIp;
    return (await checkRateLimit(key(ip), limit, DAY_MS)).allowed;
  },
  async notifyAddress(email) {
    const { key, limit } = LIMITS.notifyAddress;
    return (await checkRateLimit(key(email), limit, DAY_MS)).allowed;
  },
};
