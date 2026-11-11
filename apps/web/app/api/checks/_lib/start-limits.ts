/**
 * The buckets of a public start. A first start counts against three, with v1's keys and numbers
 * (CC-22b D2; `app/api/audits/start/route.ts`). Those keys are v1's on purpose: `global:audits:day`
 * is one daily ceiling for v1 audits and v2 checks together, and an address or a domain has one
 * budget across both. A repeat of a request whose check is already there counts against `replay`
 * and against none of the three.
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

/**
 * Repeats of a start whose check is already there that one address may send in an hour. The form
 * sends a request id a second time once, for a submit's second attempt after the person check
 * (components/v2/screens/home/start-check.ts), and mints a new id for each later submit. A repeat
 * under the limit costs a DNS lookup, the derived read and, while the check is queued, one
 * `check.requested` send.
 */
export const START_REPLAYS_PER_IP_PER_HOUR = 30;

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

  // Fails open, as the address and domain buckets do.
  async replay(ip) {
    const key = `start-replay:ip:${ip}`;
    return (await checkRateLimit(key, START_REPLAYS_PER_IP_PER_HOUR, HOUR_MS)).allowed;
  },
};
