/**
 * The three buckets a public start counts against, with v1's keys and numbers (CC-22b D2;
 * `app/api/audits/start/route.ts`). The keys are v1's on purpose: `global:audits:day` is one daily
 * ceiling for v1 audits and v2 checks together, and an address or a domain has one budget across both.
 */
import { checkRateLimit } from '../../../../lib/rate-limit';
import {
  DOMAIN_AUDITS_PER_HOUR,
  GLOBAL_AUDITS_PER_DAY,
  IP_AUDITS_PER_DAY_ANON,
  IP_AUDITS_PER_DAY_USER,
} from '../../../../lib/limits';
import type { StartLimits } from './start';

const DAY_MS = 24 * 60 * 60 * 1000;
const HOUR_MS = 60 * 60 * 1000;

export const startLimits: StartLimits = {
  // Fails closed: when the count cannot be read the start is refused, so an outage of the limiter
  // does not lift the ceiling on what a day's crawls cost.
  async global() {
    const ceiling = await checkRateLimit('global:audits:day', GLOBAL_AUDITS_PER_DAY, DAY_MS, {
      failClosed: true,
    });
    return ceiling.allowed;
  },

  async ip(ip, signedIn) {
    const limit = signedIn ? IP_AUDITS_PER_DAY_USER : IP_AUDITS_PER_DAY_ANON;
    const { allowed, resetAt } = await checkRateLimit(`ip:${ip}`, limit, DAY_MS);
    return { allowed, resetAt };
  },

  async domain(domain) {
    return (await checkRateLimit(`domain:${domain}`, DOMAIN_AUDITS_PER_HOUR, HOUR_MS)).allowed;
  },
};
