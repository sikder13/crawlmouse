import { randomUUID } from 'node:crypto';
import type { PGlite } from '@electric-sql/pglite';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { applyAllMigrations, asRole, freshDb, readMigration } from './helpers/pglite-migrations';
import {
  ROWS,
  SHA,
  insertRow,
  personalAccount,
  prepareMeasurement,
  signUp,
} from './helpers/v2-check-tables';

/**
 * Migration 028, sections C and D (docs/specs/v2/28-monitoring.md, D5–D7, D9): the alert record, the
 * Slack URL at send time, who receives alerts and summaries, the unsubscribe change, when a summary
 * is due, the account-link recipient, and the erasure's new rules.
 */

let db: PGlite;

beforeAll(async () => {
  db = await freshDb();
  await applyAllMigrations(db);
  await prepareMeasurement(db);
}, 300_000);
afterAll(async () => db.close());

async function svc<T>(sql: string, args: unknown[] = []): Promise<T[]> {
  return asRole(db, 'service_role', null, async (tx) => (await tx.query<T>(sql, args)).rows);
}

async function account(tier: 'free' | 'pro' = 'pro', timezone = 'UTC') {
  const email = `al-${randomUUID()}@example.com`;
  const userId = await signUp(db, email);
  const { accountId, seatId } = await personalAccount(db, userId);
  await db.query(`update public.accounts set timezone = $2 where id = $1`, [accountId, timezone]);
  if (tier === 'pro') {
    await db.query(
      `update public.accounts
          set state = 'pro_trial', tier = 'pro', trial_variant = 'no_card',
              trial_ends_at = now() + interval '7 days', trial_used_at = now(),
              state_history = state_history || jsonb_build_array(
                jsonb_build_object('state', 'pro_trial', 'since', now()))
        where id = $1`,
      [accountId],
    );
  }
  return { userId, accountId, seatId, email };
}

async function keptCheck(accountId: string) {
  const siteId = randomUUID();
  const checkId = randomUUID();
  await insertRow(db, 'sites', ROWS.sites(siteId, accountId, `${siteId.slice(0, 8)}.example`));
  await insertRow(db, 'checks', { ...ROWS.checks(checkId, siteId) });
  return { siteId, checkId };
}

async function change(siteId: string, checkId: string, subject = 'crawler_access', ua = 'GPTBot') {
  const id = randomUUID();
  await insertRow(db, 'changes', { ...ROWS.changes(id, siteId, checkId), subject, ua });
  return id;
}

/** A rule of the account: the seeded default of that kind (Q13), or a new site override. */
async function rule(accountId: string, siteId: string | null, kind = 'crawler_blocked') {
  if (siteId === null) {
    await svc(`select public.seed_default_alert_rules($1)`, [accountId]);
    const { rows } = await db.query<{ id: string }>(
      `select id from public.alert_rules where account_id = $1 and site_id is null and kind = $2`,
      [accountId, kind],
    );
    return rows[0]!.id;
  }
  const id = randomUUID();
  await insertRow(db, 'alert_rules', ROWS.alert_rules(id, accountId, siteId, kind));
  return id;
}

const SENT_AT = '2026-11-13T10:00:00.000Z';

function delivery(o: {
  checkId: string;
  siteId: string;
  channel?: 'email' | 'slack';
  status?: 'sent' | 'failed' | 'suppressed';
  reason?: string | null;
  rules: { rule_id: string; change_ids: string[] }[];
  slack?: string | null;
  at?: string;
}) {
  const status = o.status ?? 'sent';
  return {
    check_id: o.checkId,
    site_id: o.siteId,
    channel: o.channel ?? 'email',
    status,
    reason: o.reason === undefined ? (status === 'sent' ? null : 'provider_500') : o.reason,
    destination_hash: SHA(7),
    provider_message_id: status === 'sent' ? 'msg_1' : null,
    slack_channel: o.slack ?? null,
    sent_at: o.at ?? SENT_AT,
    rules: o.rules,
  };
}

const record = (p: unknown) =>
  svc(`select public.record_alert_delivery($1::jsonb)`, [JSON.stringify(p)]);
const notifiedOf = async (id: string) =>
  (await db.query<{ notified: unknown }>(`select notified from public.changes where id = $1`, [id]))
    .rows[0]!.notified;

describe('record_alert_delivery (D5)', () => {
  it('writes one event per rule, fires the rule, and marks the change notified in the views’ shape', async () => {
    const { accountId } = await account();
    const { siteId, checkId } = await keptCheck(accountId);
    const c = await change(siteId, checkId);
    const r = await rule(accountId, null);
    await record(delivery({ checkId, siteId, rules: [{ rule_id: r, change_ids: [c] }] }));
    expect(await notifiedOf(c)).toEqual({
      channels: ['email'],
      slack_channel: null,
      sent_at: SENT_AT,
    });
    const ev = await db.query<{ status: string; change_ids: string[]; reason: string | null }>(
      `select status, change_ids, reason from public.alert_events where rule_id = $1`,
      [r],
    );
    expect(ev.rows).toEqual([{ status: 'sent', change_ids: [c], reason: null }]);
    const fired = await db.query<{ last_fired_check_id: string }>(
      `select last_fired_check_id from public.alert_rules where id = $1`,
      [r],
    );
    expect(fired.rows[0]!.last_fired_check_id).toBe(checkId);
  });

  it('adds Slack to a change already notified by email, keeping the first sent_at, and names the channel', async () => {
    const { accountId } = await account();
    const { siteId, checkId } = await keptCheck(accountId);
    const c = await change(siteId, checkId);
    const r = await rule(accountId, null);
    await record(delivery({ checkId, siteId, rules: [{ rule_id: r, change_ids: [c] }] }));
    await record(
      delivery({
        checkId,
        siteId,
        channel: 'slack',
        slack: '#seo',
        at: '2026-11-13T10:05:00.000Z',
        rules: [{ rule_id: r, change_ids: [c] }],
      }),
    );
    expect(await notifiedOf(c)).toEqual({
      channels: ['email', 'slack'],
      slack_channel: '#seo',
      sent_at: SENT_AT,
    });
  });

  it('records a failed or suppressed channel with its reason and notifies nothing', async () => {
    const { accountId } = await account();
    const { siteId, checkId } = await keptCheck(accountId);
    const c = await change(siteId, checkId);
    const r = await rule(accountId, null);
    await record(
      delivery({
        checkId,
        siteId,
        status: 'suppressed',
        reason: 'tier_has_no_slack',
        channel: 'slack',
        rules: [{ rule_id: r, change_ids: [c] }],
      }),
    );
    expect(await notifiedOf(c)).toBeNull();
    const fired = await db.query<{ last_fired_at: Date | null }>(
      `select last_fired_at from public.alert_rules where id = $1`,
      [r],
    );
    expect(fired.rows[0]!.last_fired_at).toBeNull();
  });

  it('replaces the event on a retry, so a failure then a send leaves one sent row', async () => {
    const { accountId } = await account();
    const { siteId, checkId } = await keptCheck(accountId);
    const c = await change(siteId, checkId);
    const r = await rule(accountId, null);
    await record(
      delivery({ checkId, siteId, status: 'failed', rules: [{ rule_id: r, change_ids: [c] }] }),
    );
    await record(delivery({ checkId, siteId, rules: [{ rule_id: r, change_ids: [c] }] }));
    const ev = await db.query<{ status: string }>(
      `select status from public.alert_events where rule_id = $1`,
      [r],
    );
    expect(ev.rows).toEqual([{ status: 'sent' }]);
  });

  it('refuses a change of another check, and writes nothing', async () => {
    const { accountId } = await account();
    const one = await keptCheck(accountId);
    const otherCheck = randomUUID();
    await insertRow(db, 'checks', { ...ROWS.checks(otherCheck, one.siteId) });
    const foreign = await change(one.siteId, otherCheck);
    const own = await change(one.siteId, one.checkId, 'orphans', 'x');
    const r = await rule(accountId, null);
    await expect(
      record(
        delivery({
          checkId: one.checkId,
          siteId: one.siteId,
          rules: [{ rule_id: r, change_ids: [own, foreign] }],
        }),
      ),
    ).rejects.toThrow(/not this check/);
    expect(await notifiedOf(own)).toBeNull();
    expect(await notifiedOf(foreign)).toBeNull();
  });

  it('refuses another account’s rule, and another site’s per-site rule', async () => {
    const a = await account();
    const b = await account();
    const { siteId, checkId } = await keptCheck(a.accountId);
    const other = await keptCheck(a.accountId);
    const c = await change(siteId, checkId);
    const theirs = await rule(b.accountId, null);
    const otherSite = await rule(a.accountId, other.siteId);
    for (const r of [theirs, otherSite]) {
      await expect(
        record(delivery({ checkId, siteId, rules: [{ rule_id: r, change_ids: [c] }] })),
      ).rejects.toThrow(/not this check/);
    }
  });

  it('does not move last_fired back to an earlier send', async () => {
    const { accountId } = await account();
    const later = await keptCheck(accountId);
    const earlier = await keptCheck(accountId);
    const r = await rule(accountId, null);
    await record(
      delivery({
        ...later,
        at: '2026-11-13T12:00:00.000Z',
        rules: [{ rule_id: r, change_ids: [await change(later.siteId, later.checkId)] }],
      }),
    );
    await record(
      delivery({
        ...earlier,
        at: '2026-11-13T09:00:00.000Z',
        rules: [{ rule_id: r, change_ids: [await change(earlier.siteId, earlier.checkId)] }],
      }),
    );
    const fired = await db.query<{ last_fired_check_id: string }>(
      `select last_fired_check_id from public.alert_rules where id = $1`,
      [r],
    );
    expect(fired.rows[0]!.last_fired_check_id).toBe(later.checkId);
  });

  it('refuses a body with a key missing or extra, or no rules', async () => {
    const { accountId } = await account();
    const { siteId, checkId } = await keptCheck(accountId);
    const ok = delivery({ checkId, siteId, rules: [{ rule_id: randomUUID(), change_ids: [] }] });
    const missing: Record<string, unknown> = { ...ok };
    delete missing.reason;
    await expect(record(missing)).rejects.toThrow(/not a delivery/);
    await expect(record({ ...ok, extra: 1 })).rejects.toThrow(/not a delivery/);
    await expect(record({ ...ok, rules: [] })).rejects.toThrow(/not a delivery/);
  });
});

describe('the Slack ledger: claim before post (D5; review r1, test quality B1)', () => {
  const T0 = '2026-11-13T10:00:00.000Z';
  const at = (minutes: number) => new Date(Date.parse(T0) + minutes * 60_000).toISOString();
  const claimSlack = async (key: string, now: string | null, accountId: string | null = null) =>
    (
      await svc<{ r: { outcome: string; attempt?: number } }>(
        `select public.claim_slack_send($1, $2, $3) r`,
        [key, accountId, now],
      )
    )[0]!.r;
  const finishSlack = async (
    key: string,
    status: string,
    now: string,
    code: string | null = null,
  ) =>
    (
      await svc<{ r: boolean }>(`select public.finish_slack_send($1, $2, $3, $4) r`, [
        key,
        status,
        code,
        now,
      ])
    )[0]!.r;
  const rowOf = async (key: string) =>
    (
      await db.query<{
        status: string;
        attempts: number;
        error_code: string | null;
        sent_at: Date | null;
      }>(
        `select status, attempts, error_code, sent_at from public.slack_sends where idempotency_key = $1`,
        [key],
      )
    ).rows[0];
  const key = () => `alert:${randomUUID()}:slack`;

  it('lets the first claim of a key go, at attempt 1, and records it as sending', async () => {
    const { accountId } = await account();
    const k = key();
    expect(await claimSlack(k, T0, accountId)).toEqual({ outcome: 'go', attempt: 1 });
    expect(await rowOf(k)).toMatchObject({ status: 'sending', attempts: 1, sent_at: null });
  });

  it('answers busy to a second claim inside two minutes, and done once the first is posted', async () => {
    const k = key();
    await claimSlack(k, T0);
    expect(await claimSlack(k, at(1.9))).toEqual({ outcome: 'busy' });
    expect(await finishSlack(k, 'sent', at(1))).toBe(true);
    expect(await claimSlack(k, at(2))).toEqual({ outcome: 'done' });
    // A retried step long after: still done, so the message is not posted again.
    expect(await claimSlack(k, at(60 * 24 * 30))).toEqual({ outcome: 'done' });
    expect(await rowOf(k)).toMatchObject({ status: 'sent', attempts: 1, error_code: null });
  });

  it('retries a failed post at most three attempts, then answers exhausted', async () => {
    const k = key();
    expect(await claimSlack(k, T0)).toEqual({ outcome: 'go', attempt: 1 });
    await finishSlack(k, 'failed', at(1), 'slack_503');
    expect(await rowOf(k)).toMatchObject({ status: 'failed', error_code: 'slack_503' });
    expect(await claimSlack(k, at(2))).toEqual({ outcome: 'go', attempt: 2 });
    expect(await rowOf(k)).toMatchObject({ status: 'sending', error_code: null });
    await finishSlack(k, 'failed', at(3), 'slack_503');
    expect(await claimSlack(k, at(4))).toEqual({ outcome: 'go', attempt: 3 });
    await finishSlack(k, 'failed', at(5), 'network');
    expect(await claimSlack(k, at(6))).toEqual({ outcome: 'exhausted' });
    expect(await claimSlack(k, at(7))).toEqual({ outcome: 'exhausted' });
    expect(await rowOf(k)).toMatchObject({ status: 'failed', attempts: 3 });
  });

  it('takes back a claim left sending for more than two minutes (a worker that died mid-post)', async () => {
    const k = key();
    await claimSlack(k, T0);
    expect(await claimSlack(k, at(1.9))).toEqual({ outcome: 'busy' });
    expect(await claimSlack(k, at(2.1))).toEqual({ outcome: 'go', attempt: 2 });
    // and a claim left sending on its third attempt is exhausted, not posted a fourth time
    expect(await claimSlack(k, at(4.3))).toEqual({ outcome: 'go', attempt: 3 });
    expect(await claimSlack(k, at(6.5))).toEqual({ outcome: 'exhausted' });
    expect(await rowOf(k)).toMatchObject({ status: 'failed', attempts: 3 });
  });

  it('records a result only for a key that is sending', async () => {
    const k = key();
    expect(await finishSlack(k, 'sent', T0)).toBe(false);
    await claimSlack(k, T0);
    expect(await finishSlack(k, 'sent', at(1))).toBe(true);
    expect(await finishSlack(k, 'failed', at(2), 'late')).toBe(false);
    expect(await rowOf(k)).toMatchObject({ status: 'sent', error_code: null });
    expect((await rowOf(k))!.sent_at!.toISOString()).toBe(at(1));
  });

  it('refuses a missing key or time, another status, and an error that is not a code', async () => {
    await expect(claimSlack(key(), null)).rejects.toThrow(/required/);
    const k = key();
    await claimSlack(k, T0);
    await expect(finishSlack(k, 'sending', at(1))).rejects.toThrow(/sent or failed/);
    await expect(
      finishSlack(k, 'failed', at(1), 'https://hooks.slack.com/services/T/B/x'),
    ).rejects.toThrow(/check constraint/);
  });

  it('is executable by service_role only', async () => {
    const { rows } = await db.query<{ fn: string; r: string; ok: boolean }>(
      `select fn, r, has_function_privilege(r, fn, 'execute') ok
         from unnest(array['public.claim_slack_send(text, uuid, timestamptz)',
                           'public.finish_slack_send(text, text, text, timestamptz)']) fn,
              unnest(array['anon', 'authenticated', 'service_role']) r
        order by fn, r`,
    );
    expect(rows.filter((x) => x.ok).map((x) => [x.fn, x.r])).toEqual([
      ['public.claim_slack_send(text, uuid, timestamptz)', 'service_role'],
      ['public.finish_slack_send(text, text, text, timestamptz)', 'service_role'],
    ]);
  });
});

describe('the Slack URL at send time (D5)', () => {
  it('answers the URL for a paid account, and null once it is Free', async () => {
    const { accountId } = await account('pro');
    const url = 'https://hooks.slack.com/services/T0000/B0000/sendTime1';
    await svc(`select public.set_account_slack_webhook($1, $2)`, [accountId, url]);
    const now = new Date().toISOString();
    expect(
      (
        await svc<{ u: string | null }>(`select public.account_slack_webhook_url($1, $2) u`, [
          accountId,
          now,
        ])
      )[0]!.u,
    ).toBe(url);
    const after = '2099-01-01T00:00:00.000Z';
    expect(
      (
        await svc<{ u: string | null }>(`select public.account_slack_webhook_url($1, $2) u`, [
          accountId,
          after,
        ])
      )[0]!.u,
    ).toBeNull();
  });

  it('answers null for an account marked for deletion, or deleted (review r1, test quality B2)', async () => {
    const url = 'https://hooks.slack.com/services/T0000/B0000/markedAccount1';
    const urlOf = async (accountId: string) =>
      (
        await svc<{ u: string | null }>(`select public.account_slack_webhook_url($1, now()) u`, [
          accountId,
        ])
      )[0]!.u;
    const marked = await account('pro');
    const deleted = await account('pro');
    for (const a of [marked, deleted]) {
      await svc(`select public.set_account_slack_webhook($1, $2)`, [a.accountId, url]);
      expect(await urlOf(a.accountId)).toBe(url);
    }
    await db.query(
      `update public.accounts set deletion_confirmed_at = now(), purge_after = now() + interval '7 days' where id = $1`,
      [marked.accountId],
    );
    await db.query(`update public.accounts set deleted_at = now() where id = $1`, [
      deleted.accountId,
    ]);
    expect(await urlOf(marked.accountId)).toBeNull();
    expect(await urlOf(deleted.accountId)).toBeNull();
  });

  it('is executable by service_role only', async () => {
    const { rows } = await db.query<{ r: string; ok: boolean }>(
      `select r, has_function_privilege(r, 'public.account_slack_webhook_url(uuid, timestamptz)', 'execute') ok
         from unnest(array['anon', 'authenticated', 'service_role']) r order by r`,
    );
    expect(rows).toEqual([
      { r: 'anon', ok: false },
      { r: 'authenticated', ok: false },
      { r: 'service_role', ok: true },
    ]);
  });
});

describe('recipients and unsubscribe (D5, D6, D7)', () => {
  it('sends alerts to an active seat with email in its channels, while change notes are on', async () => {
    const { accountId, seatId, email } = await account();
    const recips = () =>
      svc<{ seat_id: string; email: string }>(`select * from public.alert_email_recipients($1)`, [
        accountId,
      ]);
    expect(await recips()).toEqual([{ seat_id: seatId, email }]);
    await db.query(`update public.accounts set email_change_notes = false where id = $1`, [
      accountId,
    ]);
    expect(await recips()).toEqual([]);
  });

  it('unsubscribes one seat from one kind only', async () => {
    const { accountId, seatId, email } = await account();
    expect(
      (await svc<{ ok: boolean }>(`select public.unsubscribe_seat($1, 'alerts') ok`, [seatId]))[0]!
        .ok,
    ).toBe(true);
    expect(await svc(`select * from public.alert_email_recipients($1)`, [accountId])).toEqual([]);
    expect(await svc(`select * from public.summary_recipients($1)`, [accountId])).toEqual([
      { seat_id: seatId, email },
    ]);
    await svc(`select public.unsubscribe_seat($1, 'summary')`, [seatId]);
    expect(await svc(`select * from public.summary_recipients($1)`, [accountId])).toEqual([]);
    const acc = await db.query<{ n: boolean }>(
      `select email_change_notes n from public.accounts where id = $1`,
      [accountId],
    );
    expect(acc.rows[0]!.n).toBe(true);
  });

  it('answers false for no such seat, and refuses another kind', async () => {
    expect(
      (
        await svc<{ ok: boolean }>(`select public.unsubscribe_seat($1, 'alerts') ok`, [
          randomUUID(),
        ])
      )[0]!.ok,
    ).toBe(false);
    await expect(
      svc(`select public.unsubscribe_seat($1, 'trial')`, [randomUUID()]),
    ).rejects.toThrow(/alerts or summary/);
  });

  it('sends nothing to an account marked for deletion', async () => {
    const { accountId } = await account();
    await db.query(
      `update public.accounts set deletion_confirmed_at = now(), purge_after = now() + interval '7 days' where id = $1`,
      [accountId],
    );
    expect(await svc(`select * from public.alert_email_recipients($1)`, [accountId])).toEqual([]);
    expect(await svc(`select * from public.summary_recipients($1)`, [accountId])).toEqual([]);
  });
});

describe('due_summary_accounts (D6)', () => {
  const due = (now: string) =>
    svc<{ account_id: string; week_key: string; week_start: Date }>(
      `select * from public.due_summary_accounts($1)`,
      [now],
    );

  it('is due Monday 08:00–08:59 in the account’s zone, keyed by its ISO week', async () => {
    const { accountId } = await account('pro', 'America/New_York');
    // Monday 2026-11-16 08:30 in New York is 13:30 UTC.
    const hit = (await due('2026-11-16T13:30:00Z')).find((r) => r.account_id === accountId);
    expect(hit?.week_key).toBe('2026-W47');
    expect(hit?.week_start.toISOString()).toBe('2026-11-16T05:00:00.000Z');
    expect((await due('2026-11-16T08:30:00Z')).some((r) => r.account_id === accountId)).toBe(false);
    expect((await due('2026-11-16T14:00:00Z')).some((r) => r.account_id === accountId)).toBe(false);
  });

  it('is never due for a Free account or a marked one', async () => {
    const free = await account('free');
    const marked = await account('pro');
    await db.query(
      `update public.accounts set deletion_confirmed_at = now(), purge_after = now() + interval '7 days' where id = $1`,
      [marked.accountId],
    );
    const ids = (await due('2026-11-16T08:30:00Z')).map((r) => r.account_id);
    expect(ids).not.toContain(free.accountId);
    expect(ids).not.toContain(marked.accountId);
  });
});

describe('account_link_recipient (D2, plan review 1)', () => {
  it('reads a link’s recipient without minting its token', async () => {
    const { accountId, userId } = await account();
    const id = randomUUID();
    await insertRow(db, 'account_tokens', {
      ...ROWS.account_tokens(id, accountId, userId),
      revoked_at: null,
    });
    const got = await svc<{ kind: string; recipient: string }>(
      `select * from public.account_link_recipient($1)`,
      [id],
    );
    expect(got).toEqual([{ kind: 'delete_confirm', recipient: 'owner@example.com' }]);
    const row = await db.query<{ token_hash: string | null }>(
      `select token_hash from public.account_tokens where id = $1`,
      [id],
    );
    expect(row.rows[0]!.token_hash).toBeNull();
  });

  it('answers nothing for a revoked link', async () => {
    const { accountId, userId } = await account();
    const id = randomUUID();
    await insertRow(db, 'account_tokens', ROWS.account_tokens(id, accountId, userId));
    expect(await svc(`select * from public.account_link_recipient($1)`, [id])).toEqual([]);
  });
});

describe('the erasure (D9)', () => {
  it('lists the ledgers’ account rules before the accounts rule', async () => {
    const rows = await db.query<{ ord: number; key: string }>(
      `select ord, key from public.erase_rules() where kind = 'change'`,
    );
    const at = (k: string) => rows.rows.find((r) => r.key === k)!.ord;
    expect(at('email_sends deleted (accounts)')).toBeLessThan(at('accounts deleted'));
    expect(at('slack_sends deleted (accounts)')).toBeLessThan(at('accounts deleted'));
  });

  it('erases a person’s account’s ledger rows through the plan and apply', async () => {
    const o = await account();
    await svc(`select public.claim_email_send($1, 'alert', $2, $3, now())`, [
      `e:${randomUUID()}`,
      SHA(4001),
      o.accountId,
    ]);
    await svc(`select public.claim_slack_send($1, $2, now())`, [`s:${randomUUID()}`, o.accountId]);
    const plan = (
      await db.query<{ r: { counts: Record<string, number> } }>(
        `select public.erase_person_plan($1, null) as r`,
        [o.userId],
      )
    ).rows[0]!.r;
    expect(plan.counts['email_sends deleted (accounts)']).toBe(1);
    expect(plan.counts['slack_sends deleted (accounts)']).toBe(1);
    await db.query(`select public.erase_person_apply($1, null, $2::jsonb, false)`, [
      o.userId,
      JSON.stringify(plan),
    ]);
    const left = await db.query<{ n: number }>(
      `select (select count(*) from public.email_sends where address_hash = $1)::int
            + (select count(*) from public.slack_sends where account_id = $2)::int n`,
      [SHA(4001), o.accountId],
    );
    expect(left.rows[0]!.n).toBe(0);
  });

  it('erase_mail_records counts, then deletes, sends by hash, and keeps suppressions', async () => {
    const h = SHA(4100);
    await svc(`select public.claim_email_send($1, 'check_notify', $2, null, now())`, [
      `v:${randomUUID()}`,
      h,
    ]);
    await svc(`select public.record_email_suppression($1, 'complaint', now())`, [h]);
    const plan = (
      await svc<{ r: unknown }>(`select public.erase_mail_records($1, false) r`, [[h]])
    )[0]!.r;
    expect(plan).toEqual({ email_sends: 1, email_suppressions_kept: 1 });
    expect(
      (await svc<{ r: unknown }>(`select public.erase_mail_records($1, true) r`, [[h]]))[0]!.r,
    ).toEqual({
      email_sends: 1,
      email_suppressions_kept: 1,
    });
    expect(
      (await svc<{ r: unknown }>(`select public.erase_mail_records($1, false) r`, [[h]]))[0]!.r,
    ).toEqual({
      email_sends: 0,
      email_suppressions_kept: 1,
    });
  });

  it('refuses a hash that is not 64 hex characters', async () => {
    await expect(
      svc(`select public.erase_mail_records($1, false)`, [['someone@example.com']]),
    ).rejects.toThrow(/64 hex/);
  });
});

describe('the default alert rules (questions Q13)', () => {
  const rulesOf = async (accountId: string) =>
    (
      await db.query<{
        kind: string;
        enabled: boolean;
        threshold_points: number | null;
        channels: string[];
        site_id: string | null;
      }>(
        `select kind, enabled, threshold_points, channels, site_id from public.alert_rules
          where account_id = $1 order by kind`,
        [accountId],
      )
    ).rows;
  const DEFAULTS = [
    {
      kind: 'any_change',
      enabled: false,
      threshold_points: null,
      channels: ['email'],
      site_id: null,
    },
    {
      kind: 'crawler_blocked',
      enabled: true,
      threshold_points: null,
      channels: ['email'],
      site_id: null,
    },
    {
      kind: 'fix_regressed',
      enabled: true,
      threshold_points: null,
      channels: ['email'],
      site_id: null,
    },
    {
      kind: 'grade_letter_moved',
      enabled: true,
      threshold_points: null,
      channels: ['email'],
      site_id: null,
    },
    {
      kind: 'new_orphans',
      enabled: true,
      threshold_points: null,
      channels: ['email'],
      site_id: null,
    },
    { kind: 'text_drop', enabled: true, threshold_points: 10, channels: ['email'], site_id: null },
  ];

  it('gives an account the six rules, by email, any_change off, on a Free account too', async () => {
    const { accountId } = await account('free');
    expect(await rulesOf(accountId)).toEqual([]);
    await svc(`select public.seed_default_alert_rules($1)`, [accountId]);
    await svc(`select public.seed_default_alert_rules($1)`, [accountId]);
    expect(await rulesOf(accountId)).toEqual(DEFAULTS);
  });

  it('the migration’s backfill seeds an account that existed before it, and only one with no rules', async () => {
    const own = await freshDb();
    try {
      await applyAllMigrations(own, undefined, (f) => f < '20261113000001_v2_028_monitoring.sql');
      const none = await personalAccount(own, await signUp(own, `pre-${randomUUID()}@example.com`));
      const some = await personalAccount(
        own,
        await signUp(own, `pre2-${randomUUID()}@example.com`),
      );
      await insertRow(
        own,
        'alert_rules',
        ROWS.alert_rules(randomUUID(), some.accountId, null, 'new_orphans'),
      );
      await own.exec(readMigration('20261113000001_v2_028_monitoring.sql'));
      const count = async (a: string) =>
        (
          await own.query<{ n: number }>(
            `select count(*)::int n from public.alert_rules where account_id = $1`,
            [a],
          )
        ).rows[0]!.n;
      expect(await count(none.accountId)).toBe(6);
      expect(await count(some.accountId)).toBe(1);
    } finally {
      await own.close();
    }
  }, 300_000);

  it('leaves a rule the account already holds, and adds the missing kinds', async () => {
    const { accountId } = await account();
    await svc(`select public.seed_default_alert_rules($1)`, [accountId]);
    await db.query(
      `update public.alert_rules set enabled = false, channels = '{email,slack}' where account_id = $1 and kind = 'crawler_blocked'`,
      [accountId],
    );
    await db.query(
      `delete from public.alert_rules where account_id = $1 and kind = 'new_orphans'`,
      [accountId],
    );
    await svc(`select public.seed_default_alert_rules($1)`, [accountId]);
    const rows = await rulesOf(accountId);
    expect(rows.find((r) => r.kind === 'crawler_blocked')).toMatchObject({
      enabled: false,
      channels: ['email', 'slack'],
    });
    expect(rows.map((r) => r.kind)).toEqual(DEFAULTS.map((d) => d.kind));
  });
});
