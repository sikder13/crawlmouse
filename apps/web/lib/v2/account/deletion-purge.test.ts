import type { PGlite } from '@electric-sql/pglite';
import type { SupabaseClient } from '@supabase/supabase-js';
import type Stripe from 'stripe';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { applyAllMigrations, freshDb } from '../../../__tests__/helpers/pglite-migrations';
import { FIX_EMAIL_REQUESTS } from '../../../__tests__/helpers/v2-027b-standins';
import { personalAccount, signUp } from '../../../__tests__/helpers/v2-check-tables';
import type { CancelAccounts, CancelStripe } from '../../billing/cancel';
import { hashToken } from './tokens';
import { purgePorts } from './deletion-ports';
import { deletionBilling, purge } from './deletion-purge';

vi.mock('server-only', () => ({}));
vi.mock('@sentry/nextjs', () => ({ captureMessage: vi.fn(), captureException: vi.fn() }));

/**
 * The purge and the deletion's billing steps over the real SQL (PGlite, every migration). The
 * service-role client is a stand-in that sends `rpc` to PGlite, deletes Storage objects as the Storage
 * API does, and answers the Auth admin calls from auth.users; Stripe is a recorder.
 */

let db: PGlite;
beforeAll(async () => {
  db = await freshDb();
  await applyAllMigrations(db);
  await db.exec(FIX_EMAIL_REQUESTS);
}, 300_000);
afterAll(async () => db.close());

const n = async (sql: string, params: unknown[] = []) =>
  Number(Object.values((await db.query<Record<string, unknown>>(sql, params)).rows[0]!)[0]);

async function rpc(fn: string, args: Record<string, unknown>) {
  const names = Object.keys(args);
  const setof = await n(
    `select count(*) from pg_proc where proname = $1 and pronamespace = 'public'::regnamespace and proretset`,
    [fn],
  );
  const call = `public.${fn}(${names.map((k, i) => `${k} => $${i + 1}`).join(', ')})`;
  const values = names.map((k) => {
    const v = args[k];
    return v !== null && typeof v === 'object' && !Array.isArray(v) ? JSON.stringify(v) : v;
  });
  try {
    if (setof) return { data: (await db.query(`select * from ${call}`, values)).rows, error: null };
    const { rows } = await db.query<{ r: unknown }>(`select ${call} as r`, values);
    return { data: rows[0]!.r, error: null };
  } catch (e) {
    return { data: null, error: { message: (e as Error).message } };
  }
}

function serviceClient(log: string[], over: { deleteUser?: () => Promise<void> } = {}) {
  const sb = {
    rpc,
    auth: {
      admin: {
        async updateUserById(id: string, attrs: { ban_duration: string }) {
          log.push(`ban:${attrs.ban_duration}`);
          return { data: { user: { id } }, error: null };
        },
        async getUserById(id: string) {
          const found = await n(`select count(*) from auth.users where id = $1`, [id]);
          return found
            ? { data: { user: { id } }, error: null }
            : { data: { user: null }, error: { status: 404, message: 'User not found' } };
        },
        async deleteUser(id: string) {
          log.push('deleteUser');
          if (over.deleteUser) await over.deleteUser();
          await db.query(`delete from auth.users where id = $1`, [id]);
          return { data: {}, error: null };
        },
      },
    },
    storage: {
      from: (bucket: string) => ({
        async remove(names: string[]) {
          log.push(`remove:${bucket}:${names.length}`);
          await db.transaction(async (tx) => {
            await tx.query(`select set_config('storage.allow_delete_query', 'true', true)`);
            await tx.query(`delete from storage.objects where bucket_id = $1 and name = any($2)`, [
              bucket,
              names,
            ]);
          });
          return { data: [], error: null };
        },
      }),
    },
    // The one query-builder chain the purge makes: live subscriptions of the accounts.
    from: (table: string) => ({
      select: () => ({
        in: (_c: string, accounts: string[]) => ({
          not: async () => {
            expect(table).toBe('subscriptions');
            const { rows } = await db.query<{ id: string }>(
              `select id from public.subscriptions where account_id = any($1)
                 and status not in ('canceled', 'incomplete_expired') order by id`,
              [accounts],
            );
            return { data: rows, error: null };
          },
        }),
      }),
    }),
  };
  return sb as unknown as SupabaseClient;
}

function stripeRecorder(subs: Record<string, Partial<Stripe.Subscription>>) {
  const calls: unknown[][] = [];
  const subscriptions: CancelStripe['subscriptions'] = {
    retrieve: async (id) => {
      calls.push(['retrieve', id]);
      return {
        id,
        items: { data: [] },
        trial_end: null,
        cancel_at_period_end: false,
        ...subs[id],
      } as unknown as Stripe.Subscription;
    },
    update: async (id, params) => {
      calls.push(['update', id, params]);
      subs[id] = { ...subs[id], ...(params as Partial<Stripe.Subscription>) };
      return {
        id,
        items: { data: [] },
        trial_end: null,
        ...subs[id],
      } as unknown as Stripe.Subscription;
    },
    cancel: async (id, params, options) => {
      calls.push(['cancel', id, params, options]);
      return { id, status: 'canceled' } as unknown as Stripe.Subscription;
    },
  };
  return { subscriptions, calls };
}

let serial = 0;

/** A person whose deletion was confirmed, with one Storage object their account names. */
async function deleted({ due = true } = {}) {
  const email = `pg-${++serial}@example.com`;
  const userId = await signUp(db, email);
  const { accountId } = await personalAccount(db, userId);
  await db.query(
    `insert into public.agency_brands (account_id, agency_name, logo_path) values ($1, 'A', $2)`,
    [accountId, `logo-${serial}.png`],
  );
  await db.query(`insert into storage.objects (bucket_id, name) values ('report-logos', $1)`, [
    `logo-${serial}.png`,
  ]);
  const { rows: requested } = await db.query<{ r: { confirmTokenId: string } }>(
    `select public.request_account_deletion($1, $2, $3) as r`,
    [accountId, userId, email],
  );
  const { rows: issued } = await db.query<{ kind: string; token: string }>(
    `select kind, token from public.issue_account_link($1)`,
    [requested[0]!.r.confirmTokenId],
  );
  const token = (kind: string) => issued.find((r) => r.kind === kind)!.token;
  const [confirm, restore] = [token('delete_confirm'), token('delete_restore')];
  await db.query(`select public.confirm_account_deletion($1, now())`, [hashToken(confirm)]);
  if (due) {
    await db.query(
      `update public.pending_erasures set confirmed_at = confirmed_at - interval '8 days',
              purge_after = purge_after - interval '8 days' where user_id = $1`,
      [userId],
    );
    await db.query(
      `update public.accounts set deletion_confirmed_at = deletion_confirmed_at - interval '8 days',
              purge_after = purge_after - interval '8 days' where id = $1`,
      [accountId],
    );
  }
  return { userId, accountId, email, restore };
}

const queued = (userId: string) =>
  n(`select count(*) from public.pending_erasures where user_id = $1`, [userId]);

function purgeOver(log: string[], stripe = stripeRecorder({}), over = {}) {
  const captured: unknown[] = [];
  const p = purgePorts(serviceClient(log, over), stripe.subscriptions, async (...a) => {
    captured.push(a);
  });
  return { steps: purge(p), captured, stripe };
}

describe('the purge', () => {
  it('does not list a person inside the window', async () => {
    const d = await deleted({ due: false });
    const { steps } = purgeOver([]);
    expect(
      (await steps.due(new Date(Date.now() + 86_400_000), 1000)).map((x) => x.userId),
    ).not.toContain(d.userId);
  });

  it('after the window: bans again, removes the objects, erases, deletes the Auth user, then the queue row', async () => {
    const d = await deleted();
    const log: string[] = [];
    const { steps, captured } = purgeOver(log);
    const [person] = (await steps.due(new Date(), 1000)).filter((x) => x.userId === d.userId);
    expect(person).toEqual({ userId: d.userId, accounts: [d.accountId] });
    const out = await steps.purgeOne(person!);
    expect(out.outcome).toBe('purged');
    expect(out.counts).toMatchObject({ 'accounts deleted': 1, 'users deleted': 1 });
    expect(log).toEqual(['ban:876000h', 'remove:report-logos:1', 'deleteUser']);
    expect(await n(`select count(*) from auth.users where id = $1`, [d.userId])).toBe(0);
    expect(await n(`select count(*) from public.accounts where id = $1`, [d.accountId])).toBe(0);
    expect(await queued(d.userId)).toBe(0);
    expect(captured).toEqual([['account_purged', d.accountId, { counts: out.counts }]]);
  });

  it('the Auth delete fails once: the queue row stays, and the next run finishes with nothing left', async () => {
    const d = await deleted();
    let failures = 1;
    const log: string[] = [];
    const { steps } = purgeOver(log, stripeRecorder({}), {
      deleteUser: async () => {
        if (failures-- > 0) throw new Error('Auth admin delete failed: HTTP 503');
      },
    });
    const person = { userId: d.userId, accounts: [d.accountId] };
    await expect(steps.purgeOne(person)).rejects.toThrow(/HTTP 503/);
    expect(await queued(d.userId)).toBe(1);
    expect(await n(`select count(*) from public.accounts where id = $1`, [d.accountId])).toBe(0);
    expect((await steps.purgeOne(person)).outcome).toBe('purged');
    expect(await queued(d.userId)).toBe(0);
    const left = await rpc('erase_person_counts', {
      p_user: d.userId,
      p_emails: [d.email],
      p_accounts: [d.accountId],
    });
    for (const [k, v] of Object.entries((left.data as { counts: Record<string, number> }).counts)) {
      expect(`${k}=${v}`).toBe(`${k}=0`);
    }
  });

  it('a run whose queue row outlived the erasure finishes it, and one whose accounts are still there refuses to', async () => {
    const d = await deleted();
    await db.query(`delete from auth.users where id = $1`, [d.userId]);
    const log: string[] = [];
    const { steps } = purgeOver(log);
    const person = { userId: d.userId, accounts: [d.accountId] };
    await expect(steps.purgeOne(person)).rejects.toThrow(/an account it marked is still there/);
    expect(await queued(d.userId)).toBe(1);
    await db.query(`delete from public.accounts where id = $1`, [d.accountId]);
    expect((await steps.purgeOne(person)).outcome).toBe('purged');
    expect(log).toEqual([]);
    expect(await queued(d.userId)).toBe(0);
  });

  it('ends a live subscription at once with no proration, refuses until Stripe’s webhook lands, and reports nothing that day', async () => {
    const d = await deleted();
    const sub = `sub_purge${serial}`;
    await db.query(
      `insert into public.subscriptions (id, account_id, status, plan, interval) values ($1, $2, 'active', 'pro', 'month')`,
      [sub, d.accountId],
    );
    const { captureMessage } = await import('@sentry/nextjs');
    vi.mocked(captureMessage).mockClear();
    const { steps, stripe } = purgeOver([]);
    const person = { userId: d.userId, accounts: [d.accountId] };
    const first = await steps.purgeOne(person);
    expect(first.outcome).toBe('refused');
    expect(stripe.calls).toEqual([
      ['cancel', sub, { prorate: false }, { idempotencyKey: `purge:${sub}` }],
    ]);
    expect(captureMessage).not.toHaveBeenCalled();
    expect(
      await n(`select attempts from public.pending_erasures where user_id = $1`, [d.userId]),
    ).toBe(1);
    // The webhook writes the cancellation; the next run erases.
    await db.query(`update public.subscriptions set status = 'canceled' where id = $1`, [sub]);
    expect((await steps.purgeOne(person)).outcome).toBe('purged');
  });

  it('any other refusal is counted and reported with the user id only', async () => {
    const d = await deleted();
    const other = await signUp(db, `joined-${serial}@example.com`);
    await db.query(
      `insert into public.seats (account_id, user_id, invited_email, role, status, accepted_at)
       values ($1, $2, 'j@example.com', 'developer', 'active', now())`,
      [d.accountId, other],
    );
    const { captureMessage } = await import('@sentry/nextjs');
    vi.mocked(captureMessage).mockClear();
    const log: string[] = [];
    const { steps } = purgeOver(log);
    const out = await steps.purgeOne({ userId: d.userId, accounts: [d.accountId] });
    expect(out.outcome).toBe('refused');
    expect(log).toEqual(['ban:876000h']);
    expect(vi.mocked(captureMessage).mock.calls).toEqual([
      ['account.purge_refused', { level: 'error', user: { id: d.userId } }],
    ]);
    expect(await queued(d.userId)).toBe(1);
    expect(
      await n(`select count(*) from storage.objects where name = $1`, [`logo-${serial}.png`]),
    ).toBe(1);
  });
});

describe('the deletion’s billing steps', () => {
  const followedFrom = (subscription: string | null): CancelAccounts => ({
    followed: async () => (subscription === null ? null : { id: subscription, mirror: null }),
  });

  it('records that it set an active plan to end, then ends it through CC-03’s cancel', async () => {
    const d = await deleted({ due: false });
    const stripe = stripeRecorder({ sub_a: { status: 'active' } });
    const steps = deletionBilling({
      rpc: async (fn, args) => (await rpc(fn, args)).data as never,
      cancel: { accounts: followedFrom('sub_a'), stripe, now: () => new Date() },
    });
    expect(await steps.cancel(d.userId, d.accountId)).toBe('cancelled');
    expect(stripe.calls).toEqual([
      ['retrieve', 'sub_a'],
      ['retrieve', 'sub_a'],
      ['update', 'sub_a', { cancel_at_period_end: true }],
    ]);
    expect(
      await n(
        `select count(*) from public.deletion_cancellations where subscription_id = 'sub_a' and we_set_cancel`,
      ),
    ).toBe(1);
    await db.query(`delete from public.deletion_cancellations where user_id = $1`, [d.userId]);
  });

  it('a plan the person had already set to end is recorded as not ours', async () => {
    const d = await deleted({ due: false });
    const stripe = stripeRecorder({ sub_b: { status: 'active', cancel_at_period_end: true } });
    const steps = deletionBilling({
      rpc: async (fn, args) => (await rpc(fn, args)).data as never,
      cancel: { accounts: followedFrom('sub_b'), stripe, now: () => new Date() },
    });
    await steps.cancel(d.userId, d.accountId);
    expect(
      await n(
        `select count(*) from public.deletion_cancellations where subscription_id = 'sub_b' and not we_set_cancel`,
      ),
    ).toBe(1);
    const restored = await rpc('restore_account', {
      p_hash: hashToken(d.restore),
      p_now: new Date().toISOString(),
    });
    expect(restored.data).toMatchObject({ ok: true, resume: [] });
  });

  it('after a restore, cancels nothing; with no subscription, calls Stripe for nothing', async () => {
    const d = await deleted({ due: false });
    await rpc('restore_account', { p_hash: hashToken(d.restore), p_now: new Date().toISOString() });
    const stripe = stripeRecorder({ sub_c: { status: 'active' } });
    const steps = deletionBilling({
      rpc: async (fn, args) => (await rpc(fn, args)).data as never,
      cancel: { accounts: followedFrom('sub_c'), stripe, now: () => new Date() },
    });
    expect(await steps.cancel(d.userId, d.accountId)).toBe('restored');
    expect(stripe.calls).toEqual([['retrieve', 'sub_c']]);
    const none = deletionBilling({
      rpc: async () => {
        throw new Error('no call expected');
      },
      cancel: { accounts: followedFrom(null), stripe, now: () => new Date() },
    });
    expect(await none.cancel(d.userId, d.accountId)).toBe('no_subscription');
  });

  it('resumes only a plan still set to end', async () => {
    const stripe = stripeRecorder({
      sub_r: { status: 'active', cancel_at_period_end: true },
      sub_x: { status: 'canceled', cancel_at_period_end: false },
    });
    const steps = deletionBilling({
      rpc: async () => {
        throw new Error('no call expected');
      },
      cancel: { accounts: followedFrom(null), stripe, now: () => new Date() },
    });
    expect(await steps.resume('sub_r')).toBe('resumed');
    expect(await steps.resume('sub_x')).toBe('left:canceled');
    expect(stripe.calls.filter((c) => c[0] === 'update')).toEqual([
      ['update', 'sub_r', { cancel_at_period_end: false }],
    ]);
  });
});
