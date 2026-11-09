import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import fc from 'fast-check';
import { z } from 'zod';
import { describe, expect, it } from 'vitest';
import {
  IP_AUDITS_PER_DAY_ANON,
  IP_AUDITS_PER_DAY_USER,
  MAGIC_LINK_PER_IP_PER_HOUR,
} from '../../lib/limits';

// infra/vercel/firewall.json is the body the owner PUTs to /v1/security/firewall/config
// (docs/ops/edge-firewall.md). It must parse against Vercel's request schema, stay inside what the Pro
// plan allows, and refuse only floods: each edge limit sits above the most the app's own per-IP
// buckets admit in one edge window, so a real user meets the app's copy first.

const firewall = JSON.parse(
  readFileSync(resolve(__dirname, '../../../../infra/vercel/firewall.json'), 'utf8'),
) as {
  firewallEnabled: boolean;
  rules: Array<{
    name: string;
    active: boolean;
    conditionGroup: Array<{
      conditions: Array<{ type: string; op: string; value?: unknown; key?: string }>;
    }>;
    action: {
      mitigate: {
        action: string;
        rateLimit?: { algo: string; window: number; limit: number; keys: string[]; action: string };
      };
    };
  }>;
  managedRules?: Record<string, unknown>;
};
const schema = z.fromJSONSchema(
  JSON.parse(readFileSync(resolve(__dirname, 'vercel-firewall-config.schema.json'), 'utf8')),
);

const HOUR = 3600;
const DAY = 24 * HOUR;
// Vercel Pro: a rate-limit window of 10 s to 10 min, fixed window only, counted by IP or JA4.
const PRO_WINDOW = { min: 10, max: 600 };

/** The app's per-IP buckets for each rate-limited route: [limit, window in seconds]. */
const APP_PER_IP: Record<string, Array<[number, number]>> = {
  '/api/auth/magic-link': [[MAGIC_LINK_PER_IP_PER_HOUR, HOUR]],
  '/api/audits/start': [
    [IP_AUDITS_PER_DAY_ANON, DAY],
    [IP_AUDITS_PER_DAY_USER, DAY],
  ],
  '/api/checks/6f1c2a8e-0000-4000-8000-000000000000/claim': [],
};

/** The rate-limited routes with a dynamic segment. */
const DYNAMIC = new Set(['/api/checks/6f1c2a8e-0000-4000-8000-000000000000/claim']);

// What Vercel serves a route handler at, read on production with GETs on 2026-11-08 (the loop is in
// docs/ops/edge-firewall.md): the path, with a trailing slash, with `.rsc` or `.rsc/` appended (lower
// case), and with `/.rsc` appended (any case). A dynamic route answers in any letter case, its suffix
// included; a static route's own letters only as written. The rules accept `.rsc` in any case at each
// of these places, a few spellings more than Vercel serves, which a rate limit can count at no cost.
const SUFFIXES = ['', '/', '.rsc', '.rsc/', '/.rsc'];
/** Spellings no rule may count: other paths, and suffixes Vercel does not serve. */
const NOT_THE_ROUTE = (path: string) => [
  `${path}x`,
  `/x${path}`,
  `${path}/x`,
  `${path}.json`,
  `${path}.rscx`,
  `${path}.rsc.rsc`,
  `${path}/.rsc/x`,
  `${path}.prefetch.rsc`,
];

/** `s` with each letter in a case fast-check picks. */
const anyCase = (s: string) =>
  fc
    .array(fc.boolean(), { minLength: s.length, maxLength: s.length })
    .map((up) => [...s].map((c, i) => (up[i] ? c.toUpperCase() : c.toLowerCase())).join(''));

const pathCondition = (rule: (typeof firewall.rules)[number]) =>
  rule.conditionGroup.flatMap((g) => g.conditions).find((c) => c.type === 'path')!;
const rateLimited = firewall.rules.filter((r) => r.action.mitigate.action === 'rate_limit');

/** The most requests the app's buckets admit from one IP within `window` seconds. */
const appAdmits = (buckets: Array<[number, number]>, window: number) =>
  Math.max(0, ...buckets.map(([limit, per]) => limit * Math.ceil(window / per)));

describe('infra/vercel/firewall.json', () => {
  it("parses against Vercel's request schema, which refuses a malformed rule", () => {
    expect(schema.safeParse(firewall).success).toBe(true);
    const broken = { ...firewall, rules: [{ ...firewall.rules[0], conditionGroup: undefined }] };
    expect(schema.safeParse(broken).success).toBe(false);
    expect(schema.safeParse({ ...firewall, unknownSection: true }).success).toBe(false);
  });

  it('is enabled and every rule is active', () => {
    expect(firewall.firewallEnabled).toBe(true);
    expect(firewall.rules.filter((r) => !r.active).map((r) => r.name)).toEqual([]);
  });

  it('rate-limits exactly the three routes, with Pro-plan settings', () => {
    expect(rateLimited.length).toBe(3);
    for (const rule of rateLimited) {
      const rl = rule.action.mitigate.rateLimit!;
      expect(rl.algo, rule.name).toBe('fixed_window');
      expect(rl.keys, rule.name).toEqual(['ip']);
      expect(rl.action, rule.name).toBe('deny');
      expect(rl.window, rule.name).toBeGreaterThanOrEqual(PRO_WINDOW.min);
      expect(rl.window, rule.name).toBeLessThanOrEqual(PRO_WINDOW.max);
    }
  });

  it.each(Object.entries(APP_PER_IP))(
    '%s: one rule, matched by regex at each spelling Vercel serves it at, above the app',
    (path, buckets) => {
      const rules = rateLimited.filter((r) =>
        new RegExp(String(pathCondition(r).value)).test(path),
      );
      expect(rules).toHaveLength(1);
      const rule = rules[0]!;
      const cond = pathCondition(rule);
      // The route handler answers at more than one spelling, so an exact-match path rule would miss it.
      expect(cond.op).toBe('re');
      const re = new RegExp(String(cond.value));
      for (const suffix of SUFFIXES) expect(re.test(`${path}${suffix}`), suffix).toBe(true);
      for (const other of NOT_THE_ROUTE(path)) expect(re.test(other), other).toBe(false);
      const served = DYNAMIC.has(path)
        ? // Any case, every letter: the path, its id and the suffix.
          fc
            .tuple(fc.uuid(), fc.constantFrom(...SUFFIXES))
            .chain(([id, suffix]) => anyCase(`/api/checks/${id}/claim${suffix}`))
        : // The path as written, the suffix in any case.
          fc.constantFrom(...SUFFIXES).chain((suffix) => anyCase(suffix).map((s) => path + s));
      fc.assert(
        fc.property(served, (spelling) => re.test(spelling)),
        { numRuns: 500 },
      );
      const rl = rule.action.mitigate.rateLimit!;
      expect(rl.limit).toBeGreaterThan(appAdmits(buckets, rl.window));
    },
  );

  it('challenges GET /login and /signup, and not the page the email link lands on', () => {
    const challenge = firewall.rules.filter((r) => r.action.mitigate.action === 'challenge');
    expect(challenge).toHaveLength(1);
    const re = new RegExp(String(pathCondition(challenge[0]!).value));
    for (const p of ['/login', '/login/', '/signup', '/signup/']) expect(re.test(p), p).toBe(true);
    for (const p of ['/login/verify', '/loginx', '/api/auth/magic-link', '/'])
      expect(re.test(p), p).toBe(false);
  });

  it('blocks no crawler: no rule keys on a bot, an agent or a user agent, and no managed bot set', () => {
    const botKeys = new Set([
      'user_agent',
      'bot_name',
      'bot_category',
      'bot_status',
      'bot_protection',
      'ja4_digest',
      'ja3_digest',
    ]);
    const keyed = firewall.rules.filter((r) =>
      r.conditionGroup.some((g) => g.conditions.some((c) => botKeys.has(c.type))),
    );
    expect(keyed.map((r) => r.name)).toEqual([]);
    expect(firewall.managedRules).toBeUndefined();
  });

  it('the above-the-app arithmetic counts a bucket shorter than the window more than once', () => {
    expect(appAdmits([[5, HOUR]], 60)).toBe(5);
    expect(appAdmits([[5, 60]], 600)).toBe(50);
    expect(appAdmits([], 600)).toBe(0);
  });
});
