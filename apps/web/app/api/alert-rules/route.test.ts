import { randomUUID } from 'node:crypto';
import type { PGlite } from '@electric-sql/pglite';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

// PUT /api/alert-rules (CC-27b D7) over PGlite with every migration applied: the caller's session is
// the PostgREST stand-in signed in as them, the service role is the stand-in as service_role, and
// the viewer is CC-26b's readViewer over the two.

const h = vi.hoisted(() => ({
  db: null as unknown as PGlite,
  user: null as { id: string; email: string } | null,
  log: [] as string[],
  /** Runs after the viewer is read: a change between that read and the role check. */
  afterViewer: null as null | (() => Promise<void>),
}));

vi.mock('@/lib/supabase/server', async () => {
  const { postgrestOver } = await import('@/__tests__/helpers/postgrest-pglite');
  return {
    supabaseServer: async () => {
      const as = h.user ? { userId: h.user.id } : undefined;
      const client = postgrestOver(h.db, as ? { as } : {}) as unknown as Record<string, unknown>;
      return {
        ...client,
        rpc: (fn: string, args: Record<string, unknown>) => {
          h.log.push(`rpc:${fn}`);
          return (client.rpc as (f: string, a: Record<string, unknown>) => unknown)(fn, args);
        },
        auth: {
          getUser: async () => {
            h.log.push('getUser');
            return { data: { user: h.user }, error: null };
          },
        },
      };
    },
  };
});
vi.mock('@/lib/supabase/admin', async () => {
  const { postgrestOver } = await import('@/__tests__/helpers/postgrest-pglite');
  return {
    supabaseAdmin: () => {
      h.log.push('supabaseAdmin');
      return postgrestOver(h.db);
    },
  };
});
vi.mock('@/lib/v2/account/viewer', async () => {
  const { postgrestOver } = await import('@/__tests__/helpers/postgrest-pglite');
  const { readViewer } = await import('@/lib/v2/account/viewer-read');
  return {
    loadViewer: async () => {
      if (!h.user) return { kind: 'signed_out' };
      const viewer = await readViewer(
        {
          session: postgrestOver(h.db, { as: { userId: h.user.id } }),
          admin: postgrestOver(h.db),
          now: () => new Date(),
        },
        h.user,
      );
      await h.afterViewer?.();
      return viewer;
    },
  };
});

import { applyAllMigrations, freshDb } from '@/__tests__/helpers/pglite-migrations';
import { personalAccount, signUp } from '@/__tests__/helpers/v2-check-tables';
import { POST, PUT } from './route';

const URL_A = 'https://hooks.slack.com/services/T0000/B0000/abcdWXYZ';
const ORIGIN = 'https://crawlmouse.com';

beforeAll(async () => {
  h.db = await freshDb();
  await applyAllMigrations(h.db);
}, 300_000);
afterAll(async () => h.db.close());

beforeEach(() => {
  h.log.length = 0;
  h.user = null;
  vi.stubEnv('V2_CHECKS_PUBLIC', '1');
});

async function member(tag: string, tier: 'free' | 'pro') {
  const email = `${tag}-${randomUUID().slice(0, 8)}@example.com`;
  const id = await signUp(h.db, email);
  const { accountId } = await personalAccount(h.db, id);
  if (tier === 'pro') {
    await h.db.query(
      `update public.accounts
          set state = 'pro_trial', tier = 'pro', trial_variant = 'no_card',
              trial_ends_at = now() + interval '7 days', trial_used_at = now(),
              state_history = state_history || jsonb_build_array(
                jsonb_build_object('state', 'pro_trial', 'since', now()))
        where id = $1`,
      [accountId],
    );
  }
  const { rows } = await h.db.query<{ id: string }>(
    `insert into public.alert_rules (account_id, site_id, kind, enabled) values ($1, null, 'any_change', true)
     returning id`,
    [accountId],
  );
  return { user: { id, email }, accountId, ruleId: rows[0]!.id };
}

const put = (body: unknown) =>
  new Request(`${ORIGIN}/api/alert-rules`, {
    method: 'PUT',
    headers: { origin: ORIGIN, 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
const form = (body: string) =>
  new Request(`${ORIGIN}/api/alert-rules`, {
    method: 'POST',
    headers: { origin: ORIGIN, 'content-type': 'application/x-www-form-urlencoded' },
    body,
  });

const enabledOf = async (ruleId: string) =>
  (
    await h.db.query<{ enabled: boolean }>(`select enabled from public.alert_rules where id = $1`, [
      ruleId,
    ])
  ).rows[0]!.enabled;
const secretsOf = async (accountId: string) =>
  (
    await h.db.query<{ secret: string }>(`select secret from vault.secrets where name = $1`, [
      `slack_webhook:${accountId}`,
    ])
  ).rows.map((r) => r.secret);

describe('PUT /api/alert-rules', () => {
  it('is a 404 with V2_CHECKS_PUBLIC off, for both verbs, before anything else runs', async () => {
    vi.stubEnv('V2_CHECKS_PUBLIC', '');
    expect((await PUT(put({ clearSlack: true }))).status).toBe(404);
    expect((await POST(form('_method=PUT&clearSlack=true'))).status).toBe(404);
    expect(h.log).toEqual([]);
  });

  it('answers 401 to a signed-out caller', async () => {
    const res = await PUT(put({ clearSlack: true }));
    expect(res.status).toBe(401);
    expect(h.log).toEqual(['getUser']);
  });

  it('confirms membership through the session before the service role is made', async () => {
    const m = await member('order', 'pro');
    h.user = m.user;
    const res = await PUT(put({ rule: m.ruleId, enabled: false }));
    expect(res.status).toBe(200);
    expect(h.log.indexOf('rpc:member_role')).toBeGreaterThan(-1);
    expect(h.log.indexOf('supabaseAdmin')).toBeGreaterThan(h.log.indexOf('rpc:member_role'));
  });

  it('stores a Slack URL on a paid account and answers its last four, never the URL', async () => {
    const m = await member('paid', 'pro');
    h.user = m.user;
    const res = await PUT(put({ slackWebhookUrl: URL_A }));
    expect(res.status).toBe(200);
    const text = await res.text();
    expect(JSON.parse(text)).toEqual({ slack: { set: true, last4: 'WXYZ' } });
    expect(text).not.toContain('hooks.slack.com');
    expect(text).not.toContain(URL_A.split('/').slice(-3).join('/'));
    expect(await secretsOf(m.accountId)).toEqual([URL_A]);
  });

  it('refuses a Slack URL on Free with 402 before any write', async () => {
    const m = await member('free', 'free');
    h.user = m.user;
    const res = await PUT(put({ slackWebhookUrl: URL_A, rule: m.ruleId, enabled: false }));
    expect(res.status).toBe(402);
    expect(await res.json()).toEqual({ code: 'upgrade_required', gate: 'slack' });
    expect(h.log).not.toContain('supabaseAdmin');
    expect(await secretsOf(m.accountId)).toEqual([]);
    expect(await enabledOf(m.ruleId)).toBe(true);
  });

  it('a switch’s form posting PUT in _method switches the rule and goes back to Alerts', async () => {
    const m = await member('switch', 'free');
    h.user = m.user;
    const res = await POST(form(`_method=PUT&rule=${m.ruleId}&enabled=false`));
    expect(res.status).toBe(303);
    expect(res.headers.get('location')).toBe('/alerts');
    expect(await enabledOf(m.ruleId)).toBe(false);
  });

  it('answers 404 when the role check finds no seat, with no service-role client and no write', async () => {
    // The account is marked for deletion between the viewer's read and the role check, so
    // member_role answers null (027b's membership functions refuse a marked account).
    const m = await member('marked', 'pro');
    h.user = m.user;
    h.afterViewer = async () => {
      await h.db.query(
        `update public.accounts set deletion_confirmed_at = now(), purge_after = now() + interval '7 days' where id = $1`,
        [m.accountId],
      );
    };
    try {
      const res = await PUT(put({ rule: m.ruleId, enabled: false }));
      expect(res.status).toBe(404);
      expect(h.log).not.toContain('supabaseAdmin');
      const { rows } = await h.db.query<{ enabled: boolean }>(
        `select enabled from public.alert_rules where id = $1`,
        [m.ruleId],
      );
      expect(rows[0]!.enabled).toBe(true);
    } finally {
      h.afterViewer = null;
    }
  });

  it('answers 404 for another account’s rule, and writes nothing to it', async () => {
    const mine = await member('mine', 'pro');
    const theirs = await member('theirs', 'pro');
    h.user = mine.user;
    const res = await PUT(put({ rule: theirs.ruleId, enabled: false }));
    expect(res.status).toBe(404);
    expect(await enabledOf(theirs.ruleId)).toBe(true);
  });

  it.each([
    ['an account id', { clearSlack: true, accountId: randomUUID() }],
    ['an unknown field', { clearSlack: true, channel: '#seo' }],
    ['a URL that is not Slack’s', { slackWebhookUrl: 'https://example.com/hook' }],
  ])('refuses %s with 400', async (_name, body) => {
    const m = await member('bad', 'pro');
    h.user = m.user;
    const res = await PUT(put(body));
    expect(res.status).toBe(400);
    expect(h.log).not.toContain('supabaseAdmin');
  });

  it('a refused form goes back to Alerts with its code; JSON is answered with JSON', async () => {
    const m = await member('form-refused', 'free');
    h.user = m.user;
    const url = encodeURIComponent(URL_A);
    const res = await POST(form(`_method=PUT&slackWebhookUrl=${url}`));
    expect(res.status).toBe(303);
    expect(res.headers.get('location')).toBe('/alerts?error=upgrade_required');
    const bad = await POST(form('_method=PUT&channel=%23seo'));
    expect(bad.headers.get('location')).toBe('/alerts?error=invalid');
    const theirs = await member('form-theirs', 'free');
    const gone = await POST(form(`_method=PUT&rule=${theirs.ruleId}&enabled=false`));
    expect(gone.headers.get('location')).toBe('/alerts?error=not_found');
    expect((await PUT(put({ slackWebhookUrl: URL_A }))).status).toBe(402);
    expect(await secretsOf(m.accountId)).toEqual([]);
  });

  it('a POST that does not name PUT is refused: 405 for JSON, back to Alerts for a form', async () => {
    const m = await member('verb', 'pro');
    h.user = m.user;
    const res = await POST(form(`rule=${m.ruleId}&enabled=false`));
    expect(res.status).toBe(303);
    expect(res.headers.get('location')).toBe('/alerts?error=method_not_allowed');
    const json = await POST(
      new Request(`${ORIGIN}/api/alert-rules`, {
        method: 'POST',
        headers: { origin: ORIGIN, 'content-type': 'application/json' },
        body: JSON.stringify({ rule: m.ruleId, enabled: false }),
      }),
    );
    expect(json.status).toBe(405);
    expect(await enabledOf(m.ruleId)).toBe(true);
  });
});
