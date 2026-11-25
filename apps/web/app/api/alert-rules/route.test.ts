import { randomUUID } from 'node:crypto';
import type { PGlite } from '@electric-sql/pglite';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

// PUT /api/alert-rules (CC-27b D7) over PGlite with every migration applied: the caller's session is
// the PostgREST stand-in signed in as them, the service role is the stand-in as service_role, and
// the viewer is CC-26b's readViewer over the two.

const h = vi.hoisted(() => ({
  posted: [] as { url: string; text: string }[],
  slackAnswer: { ok: true } as { ok: true } | { ok: false; code: string; retryable: boolean },
  limited: false,
  limitKeys: [] as string[],
  limitArgs: [] as unknown[],
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
vi.mock('@/lib/v2/monitor/slack', async (original) => ({
  ...(await original<typeof import('@/lib/v2/monitor/slack')>()),
  slackPoster: () => async (url: string, text: string) => {
    h.posted.push({ url, text });
    return h.slackAnswer;
  },
}));
vi.mock('@/lib/rate-limit', () => ({
  checkRateLimit: async (key: string, limit: number, windowMs: number, opts: unknown) => {
    h.limitKeys.push(key);
    h.limitArgs.push([limit, windowMs, opts]);
    return { allowed: !h.limited, remaining: 0, resetAt: new Date(Date.now() + 60_000) };
  },
}));
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
  h.posted.length = 0;
  h.slackAnswer = { ok: true };
  h.limited = false;
  h.limitKeys.length = 0;
  h.limitArgs.length = 0;
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

const formFrom = (body: string, referer: string) =>
  new Request(`${ORIGIN}/api/alert-rules`, {
    method: 'POST',
    headers: {
      origin: ORIGIN,
      'content-type': 'application/x-www-form-urlencoded',
      referer,
    },
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

  it('a developer seat is 403 role_refused and nothing is written; an account manager may set it', async () => {
    const m = await member('team', 'pro');
    const seated = async (role: 'developer' | 'account_manager') => {
      const guest = await member(`guest-${role}`, 'free');
      await h.db.query(
        `insert into public.seats (account_id, user_id, invited_email, role, status, accepted_at)
         values ($1, $2, $3, $4, 'active', now())`,
        [m.accountId, guest.user.id, guest.user.email, role],
      );
      // They act in the team's account, as the switcher would have it.
      await h.db.query(`update public.users set default_account_id = $1 where id = $2`, [
        m.accountId,
        guest.user.id,
      ]);
      return guest.user;
    };

    h.user = await seated('developer');
    const refused = await PUT(put({ slackWebhookUrl: URL_A }));
    expect([refused.status, await refused.json()]).toEqual([403, { code: 'role_refused' }]);
    const switched = await PUT(put({ rule: m.ruleId, enabled: false }));
    expect(switched.status).toBe(403);
    expect(await secretsOf(m.accountId)).toEqual([]);
    expect(await enabledOf(m.ruleId)).toBe(true);

    h.user = await seated('account_manager');
    const allowed = await PUT(put({ slackWebhookUrl: URL_A }));
    expect(allowed.status).toBe(200);
    expect(await secretsOf(m.accountId)).toEqual([URL_A]);
  });

  describe('a test message', () => {
    const PAGE = `${ORIGIN}/settings/integrations`;

    it('posts one fixed message to the stored webhook, and goes back saying so', async () => {
      const m = await member('test-ok', 'pro');
      h.user = m.user;
      await PUT(put({ slackWebhookUrl: URL_A }));
      const res = await POST(formFrom('_method=PUT&testSlack=true', PAGE));
      expect(res.headers.get('location')).toBe('/settings/integrations?tested=1');
      expect(h.posted).toEqual([{ url: URL_A, text: expect.stringContaining('test message') }]);
      // Nothing of the account or its sites is in it.
      expect(h.posted[0]!.text).not.toContain(m.user.email);
      expect(h.limitKeys).toEqual([`slack-test:account:${m.accountId}`]);
      // Ten a day per account, and closed if the limiter cannot be read.
      expect(h.limitArgs).toEqual([[10, 24 * 60 * 60 * 1000, { failClosed: true }]]);
    });

    it('with nothing connected: refused, nothing posted', async () => {
      const m = await member('test-none', 'pro');
      h.user = m.user;
      const res = await POST(formFrom('_method=PUT&testSlack=true', PAGE));
      expect(res.headers.get('location')).toBe('/settings/integrations?error=slack_not_connected');
      expect(h.posted).toEqual([]);
    });

    it('a webhook Slack refuses: says so, and the URL stays stored', async () => {
      const m = await member('test-refused', 'pro');
      h.user = m.user;
      await PUT(put({ slackWebhookUrl: URL_A }));
      h.slackAnswer = { ok: false, code: 'slack_404', retryable: false };
      const res = await POST(formFrom('_method=PUT&testSlack=true', PAGE));
      expect(res.headers.get('location')).toBe('/settings/integrations?error=slack_failed');
      expect(await secretsOf(m.accountId)).toEqual([URL_A]);
    });

    it('Slack not reached at all: says so, rather than blame the webhook', async () => {
      const m = await member('test-unreached', 'pro');
      h.user = m.user;
      await PUT(put({ slackWebhookUrl: URL_A }));
      for (const code of ['slack_dns', 'network']) {
        h.slackAnswer = { ok: false, code, retryable: true };
        const res = await POST(formFrom('_method=PUT&testSlack=true', PAGE));
        expect(res.headers.get('location'), code).toBe(
          '/settings/integrations?error=slack_unreachable',
        );
      }
    });

    it('over the limit: refused before anything is posted', async () => {
      const m = await member('test-limit', 'pro');
      h.user = m.user;
      await PUT(put({ slackWebhookUrl: URL_A }));
      h.limited = true;
      const res = await POST(formFrom('_method=PUT&testSlack=true', PAGE));
      expect(res.headers.get('location')).toBe('/settings/integrations?error=rate_limited');
      expect(h.posted).toEqual([]);
    });

    it('on Free: refused with upgrade_required, nothing read or posted', async () => {
      const m = await member('test-free', 'free');
      h.user = m.user;
      const res = await POST(formFrom('_method=PUT&testSlack=true', PAGE));
      expect(res.headers.get('location')).toBe('/settings/integrations?error=upgrade_required');
      expect(h.posted).toEqual([]);
      expect(h.limitKeys).toEqual([]);
    });

    it('cannot ride along with another change', async () => {
      const m = await member('test-mixed', 'pro');
      h.user = m.user;
      const res = await PUT(put({ testSlack: true, clearSlack: true }));
      expect(res.status).toBe(400);
      expect(h.posted).toEqual([]);
    });
  });

  describe('which alerts go to Slack', () => {
    const channelsOf = async (accountId: string) =>
      (
        await h.db.query<{ channels: string[] }>(
          `select channels from public.alert_rules where account_id = $1 order by kind`,
          [accountId],
        )
      ).rows.map((r) => r.channels);

    it('connecting adds Slack to each of the account’s rules, beside email', async () => {
      const m = await member('rules-on', 'pro');
      h.user = m.user;
      await PUT(put({ slackWebhookUrl: URL_A }));
      expect(await channelsOf(m.accountId)).toEqual([['email', 'slack']]);
    });

    it('replacing the URL adds nothing twice', async () => {
      const m = await member('rules-again', 'pro');
      h.user = m.user;
      await PUT(put({ slackWebhookUrl: URL_A }));
      await PUT(put({ slackWebhookUrl: URL_A.replace('abcd', 'efgh') }));
      expect(await channelsOf(m.accountId)).toEqual([['email', 'slack']]);
    });

    it('disconnecting takes Slack off them and leaves email', async () => {
      const m = await member('rules-off', 'pro');
      h.user = m.user;
      await PUT(put({ slackWebhookUrl: URL_A }));
      expect(await channelsOf(m.accountId)).toEqual([['email', 'slack']]);
      await PUT(put({ clearSlack: true }));
      expect(await channelsOf(m.accountId)).toEqual([['email']]);
    });

    it('touches no other account’s rules', async () => {
      const m = await member('rules-mine', 'pro');
      const other = await member('rules-theirs', 'pro');
      h.user = m.user;
      await PUT(put({ slackWebhookUrl: URL_A }));
      expect(await channelsOf(other.accountId)).toEqual([['email']]);
    });
  });

  it('stores a Slack URL on a paid account and answers its last four, never the URL', async () => {
    const m = await member('paid', 'pro');
    h.user = m.user;
    const res = await PUT(put({ slackWebhookUrl: URL_A }));
    expect(res.status).toBe(200);
    const text = await res.text();
    expect(JSON.parse(text)).toEqual({ slack: { set: true, last4: 'WXYZ' }, tested: false });
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

  describe('a form posted from Integrations', () => {
    const PAGE = `${ORIGIN}/settings/integrations`;
    const connect = `_method=PUT&slackWebhookUrl=${encodeURIComponent(URL_A)}`;

    it('connecting goes back there saying it saved, and stores the URL', async () => {
      const m = await member('int-set', 'pro');
      h.user = m.user;
      const res = await POST(formFrom(connect, PAGE));
      expect(res.status).toBe(303);
      expect(res.headers.get('location')).toBe('/settings/integrations?saved=1');
      expect(await secretsOf(m.accountId)).toEqual([URL_A]);
    });

    it('the address never goes into the answer', async () => {
      const m = await member('int-quiet', 'pro');
      h.user = m.user;
      const res = await POST(formFrom(connect, PAGE));
      expect(res.headers.get('location')).not.toContain('hooks.slack.com');
      expect(await res.text()).not.toContain('hooks.slack.com');
    });

    it('disconnecting goes back there and removes it', async () => {
      const m = await member('int-clear', 'pro');
      h.user = m.user;
      await POST(formFrom(connect, PAGE));
      const res = await POST(formFrom('_method=PUT&clearSlack=true', PAGE));
      expect(res.headers.get('location')).toBe('/settings/integrations?saved=1');
      expect(await secretsOf(m.accountId)).toEqual([]);
    });

    it('a refusal goes back there with its code', async () => {
      const m = await member('int-free', 'free');
      h.user = m.user;
      const res = await POST(formFrom(connect, PAGE));
      expect(res.headers.get('location')).toBe('/settings/integrations?error=upgrade_required');
      expect(await secretsOf(m.accountId)).toEqual([]);
    });

    it.each([
      ['Alerts', `${ORIGIN}/alerts`],
      ['another site with the same path', 'https://evil.example/settings/integrations'],
      ['a page below it', `${PAGE}/more`],
      ['an address that is not one', 'not a url'],
    ])('from %s: back to Alerts', async (_name, referer) => {
      const m = await member('int-other', 'pro');
      h.user = m.user;
      const res = await POST(formFrom(connect, referer));
      expect(res.headers.get('location')).toBe('/alerts');
    });
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
