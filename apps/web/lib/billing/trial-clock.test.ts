/**
 * The trial clock against every migration on PGlite: which accounts it picks up, through the same
 * PostgREST calls production makes, and the hourly function driven over the real entitlement machine
 * with the effects captured where they would be sent. A trial here is one the machine started, with
 * no `trial.started` lifecycle run behind it, as on production with V2_BILLING off.
 */
import { randomUUID } from 'node:crypto';
import type { PGlite } from '@electric-sql/pglite';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createTrialClockFn, type TrialClockPorts } from '../../../../inngest/trial-clock';
import { asRole } from '../../__tests__/helpers/pglite-migrations';
import { postgrestOver } from '../../__tests__/helpers/postgrest-pglite';
import { doorDb, pgliteEntitlementStore } from '../../__tests__/v2/_lib/door-pglite';
import { trialReminderKey } from '../v2/mail/trial-key';
import { billingClock, supabaseDeletionState, supabaseSweepReads } from './clock';
import type { EffectSinks, InngestSend } from './effects';
import { applyEntitlementTransition, type EntitlementStore } from './state-machine-apply';
import {
  REMINDER_PAGE,
  supabaseTrialClockReads,
  trialClockDue,
  type TrialClockReads,
} from './trial-clock';

const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const T = Date.parse('2099-01-01T00:00:00.000Z');
const END = T + 14 * DAY;
const REMINDER = END - 3 * DAY;

let db: PGlite;
let store: EntitlementStore;
beforeEach(async () => {
  db = await doorDb();
  store = pgliteEntitlementStore(db);
}, 60_000);
afterEach(async () => {
  await db?.close();
});

async function newAccount(): Promise<string> {
  const user = await db.query<{ id: string }>(
    `insert into auth.users (id, email) values (gen_random_uuid(), gen_random_uuid() || '@example.com')
     returning id`,
  );
  const { rows } = await db.query<{ a: string }>(
    `select default_account_id as a from public.users where id = $1`,
    [user.rows[0]!.id],
  );
  return rows[0]!.a;
}

async function noCardTrial(): Promise<string> {
  const id = await newAccount();
  const r = await applyEntitlementTransition(store, id, {
    type: 'trial_started',
    at: new Date(T),
    variant: 'no_card',
  });
  expect(r.transition.outcome).toBe('applied');
  return id;
}

async function addSite(accountId: string, minute: number, pausedReason: string | null = null) {
  const id = randomUUID();
  await db.query(
    `insert into public.sites (id, account_id, host, created_at, paused_reason, schedule_cadence,
                               schedule_iso_weekday, schedule_hour_local)
     values ($1, $2, $3, $4, $5, 'weekly', 1, 6)`,
    [id, accountId, `${id.slice(0, 8)}.example`, new Date(T + minute * 60_000), pausedReason],
  );
  return id;
}

async function ledger(accountId: string, status: 'sent' | 'suppressed' | 'failed') {
  await db.query(
    `insert into public.email_sends
       (idempotency_key, kind, address_hash, account_id, status, attempts, claimed_at, sent_at, updated_at)
     values ($1, 'trial_reminder', $2, $3, $4, $5, now(), case when $4 = 'sent' then now() end, now())`,
    [
      trialReminderKey(accountId, new Date(END)),
      'a'.repeat(64),
      accountId,
      status,
      status === 'suppressed' ? 0 : 1,
    ],
  );
}

const reads = () => supabaseTrialClockReads(postgrestOver(db));
const dueAt = (ms: number, limit = 100) => trialClockDue(reads(), new Date(ms), limit);
const kindOf = async (id: string, ms: number) =>
  (await dueAt(ms)).find((d) => d.accountId === id)?.kind ?? null;

describe('which trials the clock picks up', () => {
  it('none before the reminder is due', async () => {
    const id = await noCardTrial();
    expect(await kindOf(id, REMINDER - 1)).toBeNull();
  });

  it('the reminder from three days before the end, up to the end', async () => {
    const id = await noCardTrial();
    expect(await kindOf(id, REMINDER)).toBe('remind');
    expect(await kindOf(id, END - 1)).toBe('remind');
  });

  it('the expiry from the end on', async () => {
    const id = await noCardTrial();
    expect(await kindOf(id, END)).toBe('expire');
    expect(await kindOf(id, END + DAY)).toBe('expire');
  });

  it('at the very end it is an expiry and not a reminder as well', async () => {
    const id = await noCardTrial();
    expect((await dueAt(END)).filter((d) => d.accountId === id)).toEqual([
      { accountId: id, kind: 'expire' },
    ]);
  });

  it('a trial on Stripe’s clock, with a card, is left out of both', async () => {
    const id = await newAccount();
    const r = await applyEntitlementTransition(store, id, {
      type: 'trial_started',
      at: new Date(T),
      variant: 'card_required',
      trialEnd: new Date(END),
      subscriptionId: 'sub_card',
      subscriptionStatus: 'trialing',
    });
    expect(r.transition.outcome).toBe('applied');
    expect(await kindOf(id, REMINDER + HOUR)).toBeNull();
    expect(await kindOf(id, END)).toBeNull();
  });

  it.each(['sent', 'suppressed'] as const)(
    'no reminder once the ledger says %s',
    async (status) => {
      const id = await noCardTrial();
      await ledger(id, status);
      expect(await kindOf(id, REMINDER + HOUR)).toBeNull();
    },
  );

  it('a reminder whose send failed is picked up again', async () => {
    const id = await noCardTrial();
    await ledger(id, 'failed');
    expect(await kindOf(id, REMINDER + HOUR)).toBe('remind');
  });

  it('an account that turned the reminder off gets none, and still ends', async () => {
    const id = await noCardTrial();
    await db.query(`update public.accounts set email_trial_reminder = false where id = $1`, [id]);
    expect(await kindOf(id, REMINDER + HOUR)).toBeNull();
    expect(await kindOf(id, END)).toBe('expire');
  });

  it('an account marked for deletion is left out of both', async () => {
    const id = await noCardTrial();
    await db.query(
      `update public.accounts set deletion_confirmed_at = $2,
              purge_after = $2::timestamptz + interval '7 days' where id = $1`,
      [id, new Date(T + DAY)],
    );
    expect(await kindOf(id, REMINDER + HOUR)).toBeNull();
    expect(await kindOf(id, END)).toBeNull();
  });

  it('an account that is not on a no-card trial is left out', async () => {
    const free = await newAccount();
    expect(await kindOf(free, REMINDER + HOUR)).toBeNull();
    expect(await kindOf(free, END)).toBeNull();
  });

  it('ended trials come first, inside the limit', async () => {
    const reminding = await noCardTrial();
    const ended = await noCardTrial();
    await db.query(`update public.accounts set trial_ends_at = $2 where id = $1`, [
      ended,
      new Date(REMINDER),
    ]);
    expect(await dueAt(REMINDER + HOUR, 1)).toEqual([{ accountId: ended, kind: 'expire' }]);
    expect(reminding).not.toBe(ended);
  });
});

describe('looking past reminders already sent', () => {
  it('finds one on the next page when a whole page has gone out', async () => {
    const at = new Date(END - HOUR);
    const row = (n: number) => ({
      accountId: `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`,
      at: new Date(END),
    });
    const rows = Array.from({ length: REMINDER_PAGE + 1 }, (_, n) => row(n));
    const fake: TrialClockReads = {
      ended: async () => [],
      endingBetween: async (_f, _t, offset, size) => rows.slice(offset, offset + size),
      remindersDone: async (keys) =>
        new Set(keys.filter((k) => !k.includes(rows.at(-1)!.accountId))),
    };
    expect(await trialClockDue(fake, at, 10)).toEqual([
      { accountId: rows.at(-1)!.accountId, kind: 'remind' },
    ]);
  });
});

describe('the hourly function on the real machine', () => {
  type Handler = (ctx: { step: unknown }) => Promise<unknown>;
  const step = { run: async (_id: string, fn: () => unknown) => fn() };

  function run(at: number) {
    const sent: InngestSend[] = [];
    const cancel = vi.fn<EffectSinks['cancel']>(async () => undefined);
    const sinks: EffectSinks = {
      send: async (events) => void sent.push(...events),
      cancel,
      alert: async () => undefined,
    };
    const sb = postgrestOver(db);
    const clock = billingClock({
      store,
      reads: supabaseSweepReads(sb),
      sinks,
      now: () => at,
      deletion: supabaseDeletionState(sb),
    });
    const ports: TrialClockPorts = {
      now: clock.now,
      due: (when, limit) => trialClockDue(reads(), when, limit),
      remind: clock.remind,
      expire: clock.expire,
      dispatch: clock.dispatch,
    };
    const fn = (createTrialClockFn(() => ports) as unknown as { fn: Handler }).fn;
    return { go: () => fn({ step }), sent, cancel };
  }

  it('asks for the reminder, and the account stays on its trial', async () => {
    const id = await noCardTrial();
    const r = run(REMINDER + HOUR);
    await r.go();
    expect(r.sent).toEqual([
      {
        id: `email.requested:trial_reminder:${id}:trial-reminder:${new Date(END).toISOString()}`,
        name: 'email.requested',
        data: { accountId: id, template: 'trial_reminder' },
      },
    ]);
    const { rows } = await db.query<{ state: string }>(
      `select state from public.accounts where id = $1`,
      [id],
    );
    expect(rows[0]!.state).toBe('pro_trial');
  });

  it('two runs ask with the same event id, which Inngest and the ledger send once', async () => {
    await noCardTrial();
    const first = run(REMINDER + HOUR);
    await first.go();
    const second = run(REMINDER + 2 * HOUR);
    await second.go();
    expect(second.sent.map((e) => e.id)).toEqual(first.sent.map((e) => e.id));
  });

  it('at the end moves the account to Free: the oldest site stays, the others pause', async () => {
    const id = await noCardTrial();
    const oldest = await addSite(id, 1);
    const other = await addSite(id, 2);
    const third = await addSite(id, 3);
    const r = run(END + HOUR);
    await r.go();
    const account = await db.query<{ state: string; tier: string }>(
      `select state, tier from public.accounts where id = $1`,
      [id],
    );
    expect(account.rows[0]).toEqual({ state: 'free', tier: 'free' });
    const sites = await db.query<{ id: string; paused_reason: string | null; c: string | null }>(
      `select id, paused_reason, schedule_cadence as c from public.sites where account_id = $1`,
      [id],
    );
    const by = new Map(sites.rows.map((s) => [s.id, s]));
    expect(by.get(oldest)).toMatchObject({ paused_reason: null, c: 'monthly' });
    expect(by.get(other)!.paused_reason).toBe('trial_ended');
    expect(by.get(third)!.paused_reason).toBe('trial_ended');
    expect(r.sent.map((e) => e.name)).toEqual(['entitlement.changed']);
  });

  it('makes no Stripe call', async () => {
    await noCardTrial();
    const r = run(END + HOUR);
    await r.go();
    expect(r.cancel).not.toHaveBeenCalled();
  });

  it('a second run after the end changes and sends nothing', async () => {
    const id = await noCardTrial();
    await run(END + HOUR).go();
    const version = async () =>
      (
        await db.query<{ v: number }>(
          `select entitlement_version as v from public.accounts where id = $1`,
          [id],
        )
      ).rows[0]!.v;
    const before = await version();
    const again = run(END + 2 * HOUR);
    await again.go();
    expect(again.sent).toEqual([]);
    expect(await version()).toBe(before);
  });

  it('after the end a paused site refuses a manual re-check (B’s question 010)', async () => {
    const id = await noCardTrial();
    await addSite(id, 1);
    const other = await addSite(id, 2);
    await run(END + HOUR).go();
    const now = new Date().toISOString();
    const { rows } = await asRole(db, 'service_role', null, (tx) =>
      tx.query<{ r: Record<string, unknown> }>(
        `select public.request_capped_check($1, $2, $3) as r`,
        [
          JSON.stringify({
            id: randomUUID(),
            site_id: other,
            trigger: 'manual',
            grade_version: '2.0.0',
            queued_at: now,
            heartbeat_at: now,
            expires_at: null,
          }),
          2,
          JSON.stringify({
            bucket: `test:${randomUUID()}`,
            window_start: '2099-01-01T00:00:00.000Z',
            limit: 1000,
          }),
        ],
      ),
    );
    expect(rows[0]!.r).toEqual({ outcome: 'paused', paused_reason: 'trial_ended' });
  });
});
