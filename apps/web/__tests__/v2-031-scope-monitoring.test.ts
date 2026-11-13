/**
 * CC-31 D2 over CC-28's reads: a site's alert switch, the Alerts page and the Changes log, as each
 * person, for an Agency account's two client sites. The world, the clients and the personas are
 * v2-031-scope-routes.test.ts's; here each person acts in the agency's account (the switcher's
 * cookie names it), which a removed seat and a stranger cannot, so they read their own.
 */
import type { PGlite } from '@electric-sql/pglite';
import type { ReactElement } from 'react';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  adminOver,
  scopeWorld,
  sessionOver,
  type ScopeWorld,
} from '../lib/v2/account/sites-test-support';
import { applyAllMigrations, freshDb } from './helpers/pglite-migrations';

const h = vi.hoisted(() => ({
  db: null as unknown as PGlite,
  user: null as { id: string; email: string } | null,
  /** The switcher cookie's value on this request. */
  chosen: null as string | null,
  admins: 0,
}));

vi.mock('server-only', () => ({}));
vi.mock('next/headers', () => ({
  cookies: async () => ({
    get: (name: string) =>
      name === 'cm_account' && h.chosen !== null ? { name, value: h.chosen } : undefined,
  }),
}));
vi.mock('@/lib/supabase/server', () => ({
  supabaseServer: async () => sessionOver(h.db, h.user),
}));
vi.mock('@/lib/supabase/admin', () => ({
  supabaseAdmin: () => {
    h.admins += 1;
    return adminOver(h.db);
  },
}));

import AlertsPage from '@/app/alerts/page';
import { PUT as siteAlertRule } from '@/app/api/sites/[id]/alert-rules/route';
import ChangesPage from '@/app/changes/page';

const PEOPLE = ['owner', 'manager', 'developer', 'removed', 'stranger'] as const;
type Who = (typeof PEOPLE)[number];
const SITES = ['site1', 'site2'] as const;

const NOT_FOUND = '404 {"code":"not_found"}';
/** What `PUT /api/sites/[id]/alert-rules` answers, for [site1, site2]: a seat that covers the site. */
const SWITCH: Record<Who, [string, string]> = {
  owner: ['200', '200'],
  manager: ['200', '200'],
  developer: ['200', NOT_FOUND],
  removed: [NOT_FOUND, NOT_FOUND],
  stranger: [NOT_FOUND, NOT_FOUND],
};
/** Which client sites a person's pages may name, for [site1, site2]. */
const NAMES: Record<Who, [boolean, boolean]> = {
  owner: [true, true],
  manager: [true, true],
  developer: [true, false],
  removed: [false, false],
  stranger: [false, false],
};

let base: PGlite;
let w: ScopeWorld;

beforeAll(async () => {
  base = await freshDb();
  await applyAllMigrations(base);
  w = await scopeWorld(base);
  // What CC-28's surfaces read: the account's default rules (a site's switch overrides one), and a
  // change of each client site that an alert was sent for (the Alerts page lists those).
  await base.query(`select public.seed_default_alert_rules($1)`, [w.accountId]);
  await base.query(
    `update public.changes
        set notified = jsonb_build_object('channels', jsonb_build_array('email'),
                                          'slack_channel', null, 'sent_at',
                                          to_char(detected_at at time zone 'UTC',
                                                  'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'))
      where id = any($1::uuid[])`,
    [[w.site1.change, w.site2.change]],
  );
}, 300_000);
afterAll(async () => {
  await base?.close();
});

beforeEach(async () => {
  // A copy each: the Alerts page seeds the account's default rules, and the route writes one.
  h.db = (await base.clone()) as PGlite;
  h.user = null;
  h.chosen = w.accountId;
  h.admins = 0;
  vi.stubEnv('V2_CHECKS_PUBLIC', '1');
});
afterEach(async () => {
  vi.unstubAllEnvs();
  await h.db.close();
});

const as = (who: Who) => {
  h.user = { id: w[who].id, email: w[who].email };
};

/** Every string a rendered page's props hold, at any depth. */
function strings(v: unknown, seen = new Set<unknown>()): string[] {
  if (typeof v === 'string') return [v];
  if (v === null || typeof v !== 'object' || seen.has(v)) return [];
  seen.add(v);
  return Object.values(v).flatMap((x) => strings(x, seen));
}

describe('PUT /api/sites/[id]/alert-rules, as each person, for each client site', () => {
  const put = (siteId: string) =>
    siteAlertRule(
      new Request(`https://crawlmouse.com/api/sites/${siteId}/alert-rules`, {
        method: 'PUT',
        headers: { origin: 'https://crawlmouse.com', 'content-type': 'application/json' },
        body: JSON.stringify({ rule: 'any_change', enabled: false }),
      }),
      { params: Promise.resolve({ id: siteId }) },
    );
  const cases = PEOPLE.flatMap((who) =>
    SITES.map((site, i) => [who, site, SWITCH[who][i]!] as const),
  );

  it.each(cases)('%s for %s: %s', async (who, site, expected) => {
    as(who);
    const res = await put(w[site].id);
    const said = res.ok ? String(res.status) : `${res.status} ${JSON.stringify(await res.json())}`;
    expect(said).toBe(expected);
    if (expected === NOT_FOUND) expect(h.admins).toBe(0);
  });
});

describe.each([
  ['/alerts', AlertsPage],
  ['/changes', ChangesPage],
] as const)('%s, as each person acting in the agency’s account', (_path, Page) => {
  it.each(PEOPLE)('%s reads the clients their seat covers and names no other', async (who) => {
    as(who);
    const el = (await Page({ searchParams: Promise.resolve({}) })) as ReactElement;
    const said = strings(el.props);
    const named = SITES.map((site) => said.some((s) => s.includes(w[site].host)));
    expect(named).toEqual(NAMES[who]);
    for (const [i, site] of SITES.entries()) {
      if (!NAMES[who][i]) expect(said.filter((s) => s.includes(w[site].id))).toEqual([]);
    }
  });
});
