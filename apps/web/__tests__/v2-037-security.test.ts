/**
 * Migration 20261117000001 (CC-37): internal accounts and the trial ledger (§A), one Agency trial a
 * person (§B), `mint_report` in `seat_may` (§C), two erasure rules (§D) and the card's last four
 * (§E), on PGlite with every migration applied. PGlite has one backend, so two calls racing in real
 * transactions are scripts/db/agency-trial-repeat-race.test.ts.
 *
 * No test reads the clock: ledger rows and `p_now` are fixed instants, and the trial transition is
 * built at a fixed instant after every account's history in this file.
 */
import { createHash, randomUUID } from 'node:crypto';
import type { PGlite } from '@electric-sql/pglite';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { next } from '../lib/billing/state-machine';
import { toTransitionParams } from '../lib/billing/state-machine-apply';
import { startAgencyTrial, type StartedAccount } from '../app/api/agency-trial/_lib/start';
import { admittedHost } from '../lib/v2/account/sites';
import { readUsedAgencyTrial } from '../lib/v2/pricing/used-trial';
import { agencyTrialView } from '../lib/v2/view/agency-trial';
import { AGENCY_TRIAL_COPY } from '../lib/v2/copy/agency-trial';
import {
  applyAllMigrations,
  asRole,
  freshDb,
  readMigration,
  readRollback,
  MIGRATIONS_DIR,
} from './helpers/pglite-migrations';
import { postgrestOver } from './helpers/postgrest-pglite';
import { personalAccount, signUp } from './helpers/v2-check-tables';
import { pgliteEntitlementStore } from './v2/_lib/door-pglite';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

// The handler's module graph reaches a `server-only` marker, which resolves only inside Next.
vi.mock('server-only', () => ({}));

const MIGRATION = '20261117000001_v2_037_security.sql';
const ROLLBACK = '20261117000001_v2_037_security.revert.sql';
const MIGRATION_028 = '20261113000001_v2_028_monitoring.sql';
const FINGERPRINT = readFileSync(resolve(MIGRATIONS_DIR, '../checks/fingerprint.sql'), 'utf8');

/** An address built from its parts. */
const address = (local: string) =>
  [`${local}-${randomUUID().slice(0, 8)}`, 'example.com'].join('@');
/** A ledger hash built from its parts: sha256 of `kind:tag`, 64 lower-case hex. */
const hash = (kind: string, tag: string) =>
  createHash('sha256').update([kind, tag].join(':')).digest('hex');

/** A fixed instant for `p_now`, ledger rows and the trial transition. */
const P_NOW = '2030-01-15T12:00:00.000Z';
const AT = new Date('2030-01-15T12:00:00.000Z');

let db: PGlite;
beforeAll(async () => {
  db = await freshDb();
  await applyAllMigrations(db);
}, 300_000);
afterAll(async () => {
  await db?.close();
});

const svc = <T>(sql: string, params: unknown[] = []) =>
  asRole(db, 'service_role', null, async (tx) => (await tx.query<T>(sql, params)).rows);

async function newPerson(tag: string) {
  const email = address(tag);
  const id = await signUp(db, email);
  return { id, email, ...(await personalAccount(db, id)) };
}
type P = Awaited<ReturnType<typeof newPerson>>;

const markInternal = (accountId: string, on = true) =>
  db.query('update public.accounts set internal = $2 where id = $1', [accountId, on]);

// ═══ §A ═══════════════════════════════════════════════════════════════════════════════════════════

type Kind = 'email' | 'device' | 'ip24';
type Outcome = { outcome: string; hits: string[] };

/** The p_transition first-login.ts sends, built at AT. */
async function transitionFor(accountId: string) {
  const stored = (await pgliteEntitlementStore(db).load(accountId))!;
  const t = next(stored.snapshot, { type: 'trial_started', at: AT, variant: 'no_card' });
  expect(t.outcome).toBe('applied');
  return { event: 'trial_started', ...toTransitionParams(accountId, stored.version, t.state, AT) };
}

/** The hashes a first login sends: one per kind, built from `tag`. */
const hashesOf = (tag: string) =>
  (['email', 'device', 'ip24'] as const).map((kind) => ({ kind, value_hash: hash(kind, tag) }));

/**
 * Ledger rows of `owner` that refuse `tag`'s hashes by `kind`'s rule: one email row; two device
 * rows; two ip24 rows and one device row (the ip24 rule needs the device too).
 */
async function refusingRows(kind: Kind, tag: string, owner: string | null) {
  const rows: Kind[] =
    kind === 'email'
      ? ['email']
      : kind === 'device'
        ? ['device', 'device']
        : ['ip24', 'ip24', 'device'];
  for (const k of rows) {
    await db.query(
      `insert into public.trial_ledger (kind, value_hash, account_id, trial_kind, created_at)
       values ($1, $2, $3, 'pro', now())`,
      [k, hash(k, tag), owner],
    );
  }
}

async function startTrial(accountId: string, tag: string, built?: object) {
  const hashes = hashesOf(tag);
  // Read before the transaction: PGlite runs one statement at a time, so a read on `db` inside it
  // would wait for the transaction.
  const transition = built ?? (await transitionFor(accountId));
  return asRole(db, 'service_role', null, async (tx) => {
    const { rows } = await tx.query<{ r: Outcome }>(
      `select public.start_trial_with_ledger($1, $2::jsonb, $3::jsonb) as r`,
      [accountId, JSON.stringify(hashes), JSON.stringify(transition)],
    );
    // The trial ledger's advisory locks (class 1728), held by this transaction.
    const locks = await tx.query<{ n: number }>(
      `select count(*)::int n from pg_locks
        where locktype = 'advisory' and classid = 1728 and pid = pg_backend_pid()`,
    );
    return { ...rows[0]!.r, locks: locks.rows[0]!.n };
  });
}

const ledgerRowsOf = async (accountId: string) =>
  (
    await db.query<{ n: number }>(
      'select count(*)::int n from public.trial_ledger where account_id = $1',
      [accountId],
    )
  ).rows[0]!.n;

describe('§A start_trial_with_ledger: an internal account', () => {
  it.each(['email', 'device', 'ip24'] as const)(
    '%s: a row that refuses a customer refuses nothing for an internal account, which takes no lock and writes no row',
    async (kind) => {
      const tag = `a-${kind}-${randomUUID()}`;
      const earlier = await newPerson('earlier');
      await refusingRows(kind, tag, earlier.accountId);

      const customer = await newPerson('customer');
      const refused = await startTrial(customer.accountId, tag);
      expect(refused).toMatchObject({ outcome: 'refused', hits: [kind] });
      expect(refused.locks).toBeGreaterThan(0);

      const owner = await newPerson('owner');
      await markInternal(owner.accountId);
      const started = await startTrial(owner.accountId, tag);
      expect(started).toEqual({ outcome: 'started', hits: [], locks: 0 });
      expect(await ledgerRowsOf(owner.accountId)).toBe(0);
      const { rows } = await db.query<{ state: string }>(
        'select state from public.accounts where id = $1',
        [owner.accountId],
      );
      expect(rows[0]!.state).toBe('pro_trial');
    },
  );

  it('a customer’s trial with no refusing row still takes the locks and writes one row per hash', async () => {
    const customer = await newPerson('control');
    const r = await startTrial(customer.accountId, `a-control-${randomUUID()}`);
    expect(r).toMatchObject({ outcome: 'started', hits: [] });
    expect(r.locks).toBeGreaterThan(0);
    expect(await ledgerRowsOf(customer.accountId)).toBe(3);
  });

  it('not_eligible is unchanged: an internal account whose trial was used is not given another', async () => {
    const owner = await newPerson('used');
    await markInternal(owner.accountId);
    // Built while the account is still eligible: the state machine would not build one after.
    const transition = await transitionFor(owner.accountId);
    await db.query(`update public.accounts set trial_used_at = $2 where id = $1`, [
      owner.accountId,
      P_NOW,
    ]);
    const r = await startTrial(owner.accountId, `a-used-${randomUUID()}`, transition);
    expect(r).toEqual({ outcome: 'not_eligible', hits: [], locks: 0 });
  });
});

describe('§A trial_ledger_refusals: rows of an internal account are not counted', () => {
  const refusalsFor = async (tag: string) =>
    (
      await db.query<{ r: string[] }>(
        `select public.trial_ledger_refusals($1::jsonb, $2::timestamptz) as r`,
        [JSON.stringify(hashesOf(tag)), P_NOW],
      )
    ).rows[0]!.r;

  /** Rows as refusingRows writes them, created a day before P_NOW. */
  async function rowsAt(kind: Kind, tag: string, owner: string | null) {
    await refusingRows(kind, tag, owner);
    await db.query(
      `update public.trial_ledger set created_at = $2::timestamptz - interval '1 day'
        where value_hash = any($1)`,
      [hashesOf(tag).map((h) => h.value_hash), P_NOW],
    );
  }

  it.each(['email', 'device', 'ip24'] as const)(
    '%s: an internal account’s rows refuse nothing; a customer’s rows and rows with no account refuse',
    async (kind) => {
      const internal = await newPerson('internal');
      await markInternal(internal.accountId);
      const customer = await newPerson('customer');
      const cases = {
        internal: internal.accountId,
        customer: customer.accountId,
        accountGone: null,
      };
      const got: Record<string, string[]> = {};
      for (const [name, owner] of Object.entries(cases)) {
        const tag = `r-${kind}-${name}-${randomUUID()}`;
        await rowsAt(kind, tag, owner);
        got[name] = await refusalsFor(tag);
      }
      expect(got).toEqual({ internal: [], customer: [kind], accountGone: [kind] });
    },
  );

  it('marking an account internal frees what its rows held, and unmarking it gives them back', async () => {
    const owner = await newPerson('toggle');
    const tag = `r-toggle-${randomUUID()}`;
    await rowsAt('email', tag, owner.accountId);
    expect(await refusalsFor(tag)).toEqual(['email']);
    await markInternal(owner.accountId);
    expect(await refusalsFor(tag)).toEqual([]);
    await markInternal(owner.accountId, false);
    expect(await refusalsFor(tag)).toEqual(['email']);
  });
});

// ═══ §B (and §A's agency part) ════════════════════════════════════════════════════════════════════

type Answer = { outcome: string; account_id?: string; site_id?: string };
const startAgency = async (userId: string, host = 'client.example') =>
  (
    await svc<{ r: Answer }>('select public.start_agency_trial_account($1, $2, $3) as r', [
      userId,
      'Summit Digital',
      host,
    ])
  )[0]!.r;

/**
 * An agency account whose trial was used (or not), with `owner` as its owner, the seat's status as
 * given, and optionally a second person holding `role` on it.
 */
async function usedAgency(
  owner: P,
  opts: { used?: boolean; ownerSeat?: 'active' | 'removed'; internal?: boolean } = {},
) {
  const { account_id } = await startAgency(owner.id);
  await db.query(
    `update public.accounts set trial_used_at = case when $2 then $3::timestamptz end, internal = $4
      where id = $1`,
    [account_id, opts.used ?? true, P_NOW, opts.internal ?? false],
  );
  if (opts.ownerSeat === 'removed') {
    await db.query(
      `update public.seats set status = 'removed', removed_at = $3::timestamptz
        where account_id = $1 and user_id = $2`,
      [account_id, owner.id, P_NOW],
    );
  }
  return account_id!;
}

async function seatOn(accountId: string, who: P, role: 'account_manager' | 'developer') {
  await db.query(
    `insert into public.seats (account_id, user_id, invited_email, role, status, accepted_at)
     values ($1, $2, $3, $4, 'active', $5::timestamptz)`,
    [accountId, who.id, who.email, role, P_NOW],
  );
}

describe('§B start_agency_trial_account: one Agency trial a person, role by role', () => {
  it('an owner whose seat on the used-trial account was removed is refused trial_used', async () => {
    const owner = await newPerson('removed-owner');
    await usedAgency(owner, { ownerSeat: 'removed' });
    expect(await startAgency(owner.id, 'other.example')).toEqual({ outcome: 'trial_used' });
  });

  it('an owner whose active seat is on the used-trial account is refused, as before', async () => {
    const owner = await newPerson('active-owner');
    await usedAgency(owner);
    expect(await startAgency(owner.id, 'other.example')).toEqual({ outcome: 'trial_used' });
  });

  it.each(['account_manager', 'developer'] as const)(
    'a %s on a used-trial account, never its owner, is not refused: their own account is created',
    async (role) => {
      const owner = await newPerson('owner');
      const account = await usedAgency(owner);
      const member = await newPerson(role);
      await seatOn(account, member, role);
      const r = await startAgency(member.id);
      expect(r.outcome).toBe('created');
      expect(r.account_id).not.toBe(account);
    },
  );

  it('an owner whose only agency account never used a trial, seat removed, is not refused', async () => {
    const owner = await newPerson('unused');
    const first = await usedAgency(owner, { used: false, ownerSeat: 'removed' });
    const r = await startAgency(owner.id, 'other.example');
    expect(r.outcome).toBe('created');
    expect(r.account_id).not.toBe(first);
  });

  it('a fresh person is created an account', async () => {
    const fresh = await newPerson('fresh');
    expect((await startAgency(fresh.id)).outcome).toBe('created');
  });

  it('§A: an internal account’s used trial does not count, its seat active or removed', async () => {
    for (const ownerSeat of ['active', 'removed'] as const) {
      const owner = await newPerson(`internal-${ownerSeat}`);
      const first = await usedAgency(owner, { internal: true, ownerSeat });
      const r = await startAgency(owner.id, 'other.example');
      expect(r.outcome, ownerSeat).toBe('created');
      expect(r.account_id).not.toBe(first);
    }
  });
});

// The Agency trial page reads the rule through readUsedAgencyTrial; it must say "used" exactly when
// the function answers trial_used, over each attribute the rule now keys on.
describe('§B readUsedAgencyTrial agrees with start_agency_trial_account', () => {
  const cases: { role: 'owner' | 'account_manager'; removed: boolean; internal: boolean }[] = [];
  for (const role of ['owner', 'account_manager'] as const)
    for (const removed of [false, true])
      for (const internal of [false, true]) cases.push({ role, removed, internal });

  it.each(cases)('%j', async (c) => {
    const p = await newPerson('sweep');
    const account = await usedAgency(p, { internal: c.internal });
    await db.query(
      `update public.seats
          set role = $3, status = case when $4 then 'removed' else 'active' end,
              removed_at = case when $4 then $5::timestamptz end
        where account_id = $1 and user_id = $2`,
      [account, p.id, c.role, c.removed, P_NOW],
    );
    const read = await readUsedAgencyTrial(postgrestOver(db) as never, p.id);
    const answer = await startAgency(p.id, 'other.example');
    expect(read !== null).toBe(answer.outcome === 'trial_used');
    expect(answer.outcome === 'trial_used').toBe(c.role === 'owner' && !c.internal);
  });
});

describe('§B the route: a removed-seat repeat gets the Agency trial page’s refusal', () => {
  it('409 trial_used from the route’s handler over the real function, and the page shows its used state', async () => {
    const owner = await newPerson('route');
    await usedAgency(owner, { ownerSeat: 'removed' });
    const admin = postgrestOver(db);
    const checkouts: unknown[] = [];
    const res = await startAgencyTrial(
      new Request('https://crawlmouse.com/api/agency-trial', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          consent: true,
          agencyName: 'Summit Digital',
          site: 'https://clientsite.com',
          interval: 'month',
        }),
      }),
      { id: owner.id, email: owner.email },
      {
        rateLimit: async () => ({ allowed: true }),
        admit: (site) => admittedHost(site, async () => undefined),
        // As app/api/agency-trial/route.ts calls it.
        async startAccount(userId, name, host) {
          const { data, error } = await admin.rpc('start_agency_trial_account', {
            p_user: userId,
            p_name: name,
            p_host: host,
          });
          if (error) throw new Error(error.message);
          const r = data as Answer;
          return (
            r.outcome === 'trial_used'
              ? { outcome: 'trial_used' }
              : { outcome: r.outcome, accountId: r.account_id, siteId: r.site_id }
          ) as StartedAccount;
        },
        openCheckout: async () => null,
        storeCheckout: async () => undefined,
        checkout: async (input) => {
          checkouts.push(input);
          return { ok: true, url: 'https://checkout.stripe.com/c/pay/cs_x' };
        },
        capture: async () => undefined,
        firstClient: async () => undefined,
        defer: () => undefined,
        now: () => AT,
      },
    );
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ error: 'trial_used' });
    expect(checkouts).toEqual([]);
    // The form shows this error's own sentence (components/v2/screens/agency-trial).
    expect(AGENCY_TRIAL_COPY.errors.trial_used).toEqual(expect.any(String));

    const used = await readUsedAgencyTrial(admin as never, owner.id);
    expect(used).not.toBeNull();
    const view = agencyTrialView(
      {
        email: owner.email,
        interval: 'month',
        timeZone: 'UTC',
        standing: { held: false, billing: [], used, open: null },
        customers: new Map(),
        cancelAsked: null,
      },
      AT,
    );
    expect(view.kind).toBe('used');
  });
});

// ═══ §C ═══════════════════════════════════════════════════════════════════════════════════════════

describe('§C seat_may: mint_report', () => {
  it('the owner and an account manager may; a developer may not; an unknown action still raises', async () => {
    const owner = await newPerson('mint-owner');
    const { account_id } = await startAgency(owner.id);
    const manager = await newPerson('mint-manager');
    const developer = await newPerson('mint-developer');
    await seatOn(account_id!, manager, 'account_manager');
    await seatOn(account_id!, developer, 'developer');
    const may = (who: P, action: string) =>
      asRole(db, 'authenticated', who.id, async (tx) => {
        const { rows } = await tx.query<{ v: boolean }>(`select public.seat_may($1, $2) v`, [
          account_id,
          action,
        ]);
        return rows[0]!.v;
      });
    expect({
      owner: await may(owner, 'mint_report'),
      account_manager: await may(manager, 'mint_report'),
      developer: await may(developer, 'mint_report'),
    }).toEqual({ owner: true, account_manager: true, developer: false });
    await expect(may(owner, 'mint_reports')).rejects.toThrow(/mint_reports is not an action/);
  });
});

// ═══ §D ═══════════════════════════════════════════════════════════════════════════════════════════

const NEW_RULES = ['sites.report_refusals pruned', 'sites.client_contact_name nulled'];

describe('§D erase_rules: every existing row is 028’s, byte for byte', () => {
  it('the rows of 028’s text, run as written, equal the restated rows less the two new ones', async () => {
    const text = readMigration(MIGRATION_028);
    const from = text.indexOf('create or replace function public.erase_rules()');
    const to = text.indexOf('\n$$;', from) + '\n$$;'.length;
    expect(from).toBeGreaterThan(0);
    const statement = text
      .slice(from, to)
      .replace('function public.erase_rules()', 'function pg_temp.erase_rules_028()');
    type Row = Record<string, unknown>;
    const [old, now] = await db.transaction(async (tx) => {
      await tx.exec(statement);
      const a = await tx.query<Row>('select * from pg_temp.erase_rules_028()');
      const b = await tx.query<Row>('select * from public.erase_rules()');
      return [a.rows, b.rows];
    });
    expect(old.length).toBeGreaterThan(20);
    expect(now.filter((r) => !NEW_RULES.includes(r.key as string))).toEqual(old);
    // The two new rules, at ords 028 did not use, before rule 30 and rule 29.
    const added = now.filter((r) => NEW_RULES.includes(r.key as string));
    expect(added.map((r) => [r.ord, r.kind, r.key, r.target])).toEqual([
      [18, 'change', 'sites.report_refusals pruned', 'public.sites x'],
      [19, 'change', 'sites.client_contact_name nulled', 'public.sites x'],
    ]);
    expect(old.map((r) => r.ord)).not.toContain(18);
    expect(old.map((r) => r.ord)).not.toContain(19);
  });
});

describe('§D the erasure of a client contact (deletion)', () => {
  type Plan = { counts: Record<string, number> };
  const plan = async (email: string | null, userId: string | null = null) =>
    (await db.query<{ r: Plan }>(`select public.erase_person_plan($1, $2) as r`, [userId, email]))
      .rows[0]!.r;
  /** The dry run, then the apply with that plan, as erasePerson runs them. */
  const erase = async (email: string | null, userId: string | null = null) => {
    const before = await plan(email, userId);
    await db.query(`select public.erase_person_apply($1, $2, $3::jsonb, false)`, [
      userId,
      email,
      JSON.stringify(before),
    ]);
    return { before, after: await plan(email, userId) };
  };

  /** A client site of an agency account, with `contact` set by set_client and a name beside it. */
  async function clientSite(contact: string) {
    const owner = await newPerson('agency');
    const { account_id, site_id } = await startAgency(
      owner.id,
      `c${randomUUID().slice(0, 8)}.example`,
    );
    await setContact(site_id!, account_id!, contact);
    await db.query(`update public.sites set client_contact_name = 'Jordan' where id = $1`, [
      site_id,
    ]);
    return { accountId: account_id!, siteId: site_id! };
  }
  const setContact = async (site: string, account: string, email: string) => {
    const rows = await svc<{ r: { outcome: string } }>(
      `select public.set_client($1, $2, $3::jsonb) as r`,
      [site, account, JSON.stringify({ client_contact_email: email })],
    );
    expect(rows[0]!.r.outcome).toBe('saved');
  };
  const refuse = (site: string, email: string, patch: Record<string, string>) =>
    db.query(`select public.note_report_refusal($1, $2, $3::jsonb)`, [
      site,
      email,
      JSON.stringify(patch),
    ]);
  const siteRow = async (id: string) =>
    (
      await db.query<{ name: string | null; email: string | null; keys: string[] }>(
        `select client_contact_name name, client_contact_email email,
                array(select e ->> 'a' from jsonb_array_elements(report_refusals) e) keys
           from public.sites where id = $1`,
        [id],
      )
    ).rows[0]!;
  const keyOf = async (email: string) =>
    (await db.query<{ k: string }>(`select public.report_refusal_key($1) k`, [email])).rows[0]!.k;

  it('a contact who declined, was never sent a report and was replaced: their entry goes; the new contact’s entry and name stay', async () => {
    const declined = address('declined');
    const next = address('next');
    const s = await clientSite(declined);
    await refuse(s.siteId, declined, { declined_at: P_NOW });
    await setContact(s.siteId, s.accountId, next);
    await refuse(s.siteId, next, { paused_at: P_NOW });
    expect((await siteRow(s.siteId)).keys).toEqual([await keyOf(declined), await keyOf(next)]);

    const { before, after } = await erase(declined);
    expect(before.counts['sites.report_refusals pruned']).toBe(1);
    expect(before.counts['sites.client_contact_name nulled']).toBe(0);
    expect(await siteRow(s.siteId)).toEqual({
      name: 'Jordan',
      email: next,
      keys: [await keyOf(next)],
    });
    expect(after.counts['sites.report_refusals pruned']).toBe(0);
  });

  it('the current contact erased: name and address null, and their entry gone', async () => {
    const contact = address('current');
    const s = await clientSite(contact);
    await refuse(s.siteId, contact, { declined_at: P_NOW });
    const { before, after } = await erase(contact);
    expect(before.counts).toMatchObject({
      'sites.report_refusals pruned': 1,
      'sites.client_contact_name nulled': 1,
      'sites.client_contact_email nulled': 1,
    });
    expect(await siteRow(s.siteId)).toEqual({ name: null, email: null, keys: [] });
    expect(after.counts).toMatchObject({
      'sites.report_refusals pruned': 0,
      'sites.client_contact_name nulled': 0,
      'sites.client_contact_email nulled': 0,
    });
  });

  it('a variant of the address (case, surrounding space) reaches the same rows, in the entry and in the erasure', async () => {
    const contact = address('variant');
    const s = await clientSite(contact);
    const variant = `  ${contact.toUpperCase()} `;
    await refuse(s.siteId, variant, { declined_at: P_NOW });
    expect((await siteRow(s.siteId)).keys).toEqual([await keyOf(contact)]);
    const { before } = await erase(variant);
    expect(before.counts).toMatchObject({
      'sites.report_refusals pruned': 1,
      'sites.client_contact_name nulled': 1,
    });
    expect(await siteRow(s.siteId)).toEqual({ name: null, email: null, keys: [] });
  });

  it('a site in the person’s own account is not touched by these rules: it goes with the account', async () => {
    const me = await newPerson('own');
    const { rows } = await db.query<{ id: string }>(
      `insert into public.sites (account_id, host, client_contact_name, client_contact_email)
       values ($1, $2, 'Me', $3) returning id`,
      [me.accountId, `own${randomUUID().slice(0, 8)}.example`, me.email],
    );
    await refuse(rows[0]!.id, me.email, { declined_at: P_NOW });
    // And a client site of another account, where the same person is the contact.
    const other = await clientSite(me.email);
    await refuse(other.siteId, me.email, { declined_at: P_NOW });

    const p = await plan(null, me.id);
    expect(p.counts['sites.report_refusals pruned']).toBe(1);
    expect(p.counts['sites.client_contact_name nulled']).toBe(1);
    expect(p.counts['sites deleted']).toBe(1);
    await erase(null, me.id);
    expect(await siteRow(other.siteId)).toEqual({ name: null, email: null, keys: [] });
  });
});

// ═══ §E ═══════════════════════════════════════════════════════════════════════════════════════════

describe('§E accounts.card_last4', () => {
  it.each(['owner', 'account_manager', 'developer'] as const)(
    'an authenticated %s cannot select it, and still reads the row’s other columns',
    async (role) => {
      const owner = await newPerson('card-owner');
      const { account_id } = await startAgency(owner.id);
      const who = role === 'owner' ? owner : await newPerson(role);
      if (role !== 'owner') await seatOn(account_id!, who, role);
      await expect(
        asRole(db, 'authenticated', who.id, (tx) =>
          tx.query('select card_last4 from public.accounts where id = $1', [account_id]),
        ),
      ).rejects.toThrow(/permission denied/);
      const { rows } = await asRole(db, 'authenticated', who.id, (tx) =>
        tx.query<{ id: string }>('select id, tier from public.accounts where id = $1', [
          account_id,
        ]),
      );
      expect(rows.map((r) => r.id)).toEqual([account_id]);
    },
  );

  it('the service role reads it', async () => {
    const owner = await newPerson('card-svc');
    await db.query(`update public.accounts set card_last4 = $2 where id = $1`, [
      owner.accountId,
      ['42', '42'].join(''),
    ]);
    expect(
      await svc<{ card_last4: string }>('select card_last4 from public.accounts where id = $1', [
        owner.accountId,
      ]),
    ).toEqual([{ card_last4: '4242' }]);
  });
});

// ═══ The catalog, the re-run and the revert ═══════════════════════════════════════════════════════

const FUNCTIONS = [
  'public.trial_ledger_refusals(jsonb, timestamptz)',
  'public.start_trial_with_ledger(uuid, jsonb, jsonb)',
  'public.start_agency_trial_account(uuid, text, text)',
  'public.seat_may(uuid, text)',
  'public.erase_rules()',
];

/** Each function's owner, security, settings, language, volatility and who may execute it. */
const pins = async (d: PGlite) =>
  (
    await d.query<Record<string, unknown>>(
      `select f.sig, pg_get_userbyid(p.proowner) as owner, p.prosecdef as definer,
              p.proconfig as config, l.lanname as language, p.provolatile as volatility,
              array(select r from unnest(array['public', 'anon', 'authenticated', 'service_role']) r
                     where case when r = 'public'
                                then exists (select 1 from aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) x
                                              where x.grantee = 0 and x.privilege_type = 'EXECUTE')
                                else has_function_privilege(r, p.oid, 'EXECUTE') end) as execute
         from unnest($1::text[]) with ordinality f(sig, i)
         join pg_proc p on p.oid = f.sig::regprocedure
         join pg_language l on l.oid = p.prolang
        order by f.i`,
      [FUNCTIONS],
    )
  ).rows;

/** What each function was before this migration and is after it: written out, not read. */
const EXPECTED_PINS = [
  {
    sig: FUNCTIONS[0],
    owner: 'postgres',
    definer: false,
    config: ['search_path=""'],
    language: 'sql',
    volatility: 's',
    execute: [],
  },
  {
    sig: FUNCTIONS[1],
    owner: 'postgres',
    definer: true,
    config: ['search_path=pg_catalog, pg_temp', 'lock_timeout=3s'],
    language: 'plpgsql',
    volatility: 'v',
    execute: ['service_role'],
  },
  {
    sig: FUNCTIONS[2],
    owner: 'postgres',
    definer: true,
    config: ['search_path=pg_catalog, pg_temp'],
    language: 'plpgsql',
    volatility: 'v',
    execute: ['service_role'],
  },
  {
    sig: FUNCTIONS[3],
    owner: 'postgres',
    definer: false,
    config: ['search_path=pg_catalog, pg_temp'],
    language: 'plpgsql',
    volatility: 's',
    execute: ['authenticated', 'service_role'],
  },
  {
    sig: FUNCTIONS[4],
    owner: 'postgres',
    definer: false,
    config: ['search_path=pg_catalog, public, pg_temp'],
    language: 'sql',
    volatility: 's',
    execute: [],
  },
];

const definitions = async (d: PGlite) =>
  (
    await d.query<{ def: string }>(
      `select pg_get_functiondef(f::regprocedure) def from unnest($1::text[]) with ordinality t(f, i) order by i`,
      [FUNCTIONS],
    )
  ).rows.map((r) => r.def);

const cardGrant = async (d: PGlite) =>
  (
    await d.query<{ can: boolean }>(
      `select has_column_privilege('authenticated', 'public.accounts', 'card_last4', 'SELECT') can`,
    )
  ).rows[0]!.can;

/** Columns of accounts authenticated may select, by name. */
const readable = async (d: PGlite) =>
  (
    await d.query<{ name: string }>(
      `select a.attname name from pg_attribute a
        where a.attrelid = 'public.accounts'::regclass and a.attnum > 0 and not a.attisdropped
          and has_column_privilege('authenticated', a.attrelid, a.attnum, 'SELECT')
        order by 1`,
    )
  ).rows.map((r) => r.name);

const fingerprint = async (d: PGlite) =>
  Object.fromEntries(
    (await d.query<{ section: string; md5: string }>(FINGERPRINT)).rows.map((r) => [
      r.section,
      r.md5,
    ]),
  );
const differing = (a: Record<string, string>, b: Record<string, string>) =>
  [...new Set([...Object.keys(a), ...Object.keys(b)])].filter((s) => a[s] !== b[s]).sort();

describe('the catalog, the re-run and the revert', () => {
  let own: PGlite;
  beforeAll(async () => {
    own = await freshDb();
    await applyAllMigrations(own, undefined, (f) => f < MIGRATION);
  }, 300_000);
  afterAll(async () => {
    await own?.close();
  });

  it('pins each restated function before and after; narrows one column grant; applies twice; the revert gives back the schema, twice, and the migration applies again', async () => {
    const pre = {
      pins: await pins(own),
      defs: await definitions(own),
      print: await fingerprint(own),
    };
    const columnsBefore = await readable(own);
    expect(pre.pins).toEqual(EXPECTED_PINS);
    expect(await cardGrant(own)).toBe(true);

    await own.exec(readMigration(MIGRATION));
    const applied = await fingerprint(own);
    expect(await pins(own)).toEqual(EXPECTED_PINS);
    expect(await cardGrant(own)).toBe(false);
    expect(await readable(own)).toEqual(columnsBefore.filter((c) => c !== 'card_last4'));
    // Every body changed: the comparison below is of something.
    const defs = await definitions(own);
    for (const [i, d] of defs.entries()) expect(d, FUNCTIONS[i]).not.toBe(pre.defs[i]);

    await own.exec(readMigration(MIGRATION));
    expect(differing(applied, await fingerprint(own))).toEqual([]);

    for (let round = 0; round < 2; round++) {
      await own.exec(readRollback(ROLLBACK));
      expect(await definitions(own)).toEqual(pre.defs);
      expect(await pins(own)).toEqual(EXPECTED_PINS);
      expect(await cardGrant(own)).toBe(true);
      expect(differing(pre.print, await fingerprint(own))).toEqual([]);
    }

    await own.exec(readMigration(MIGRATION));
    expect(differing(applied, await fingerprint(own))).toEqual([]);
  }, 300_000);
});
