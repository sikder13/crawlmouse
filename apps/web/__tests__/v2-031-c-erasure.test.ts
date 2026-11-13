/**
 * CC-31 D9: the erasure covers what the agency workspace writes. No SQL is added for it: the rules
 * are CC-27b's (`erase_rules()`, migration 20261112000002 section B), run here unchanged on PGlite
 * with every migration applied, through the sequence the script and the purge run (`erasePerson`,
 * lib/v2/account/erase.ts), over ports that do in SQL what the Storage and Auth APIs do.
 *
 * Four people, each erased in turn from one world (an Agency account with two client sites, their
 * checks, reports and schedules: `scopeWorld`):
 *   (a) invited to that agency, not yet accepted;
 *   (b) holding an active seat on it;
 *   (c) the owner of an agency of their own, with invited seats, reports with stored files, share
 *       links and a client contact;
 *   (d) the client contact and report recipient of that agency: once with an account of their own,
 *       once with none (erased by address).
 * For each: the plan's counts name the rows, the erasure removes or blanks them, and a plan read
 * again counts none.
 *
 * And (e), the mailer's record of an invitation that was sent (`email_sends`, CC-28): found by the
 * invited address's hash when the invitee is erased, and by its account when the owner is.
 */
import { createHash, randomUUID } from 'node:crypto';
import type { PGlite } from '@electric-sql/pglite';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  erasePerson,
  MAIL_SENDS_KEY,
  type ErasurePlan,
  type ErasurePorts,
  type ErasureTarget,
  type MailRecordCounts,
  type StorageObject,
} from '../lib/v2/account/erase';
import {
  addSeat,
  adminOver,
  keptSite,
  person,
  scopeWorld,
  type Person,
  type ScopeWorld,
} from '../lib/v2/account/sites-test-support';
import { supabaseSeatsStore } from '../lib/v2/agency/seats-store';
import { agencyAccount } from '../lib/v2/agency/test-support';
import { hashMailAddress } from '../lib/v2/mail/address-hash';
import { mailHandlers } from '../lib/v2/mail/handlers';
import { supabaseMailLedger } from '../lib/v2/mail/ledger';
import { memoryTransport } from '../lib/v2/mail/memory';
import { supabaseMailStore } from '../lib/v2/mail/store';
import { applyAllMigrations, freshDb } from './helpers/pglite-migrations';
import { insertRow, ROWS } from './helpers/v2-check-tables';

const MAIL_PEPPER = 'cc31-erasure-test-pepper';

let db: PGlite;
let world: ScopeWorld;

beforeAll(async () => {
  db = await freshDb();
  await applyAllMigrations(db);
  world = await scopeWorld(db);
}, 300_000);
afterAll(async () => {
  await db?.close();
});

const n = async (sql: string, params: unknown[] = []) =>
  Number((await db.query<{ count: string }>(sql, params)).rows[0]!.count);

const plan = async (target: ErasureTarget): Promise<ErasurePlan> =>
  (
    await db.query<{ r: ErasurePlan }>(`select public.erase_person_plan($1, $2) as r`, [
      target.userId ?? null,
      target.email ?? null,
    ])
  ).rows[0]!.r;

/** The erasure's ports over PGlite, with each call recorded in `calls`, in order. */
function ports(calls: string[]): ErasurePorts {
  return {
    plan,
    apply: async (target, expected) => {
      calls.push('apply');
      await db.query(`select public.erase_person_apply($1, $2, $3::jsonb, false)`, [
        target.userId ?? null,
        target.email ?? null,
        JSON.stringify(expected),
      ]);
    },
    // The Storage API's delete: a direct delete is refused unless the transaction allows it.
    removeStorage: async (objects) => {
      calls.push(`removeStorage ${objects.map((o) => `${o.bucket}/${o.name}`).join(' ')}`);
      await db.transaction(async (tx) => {
        await tx.query(`select set_config('storage.allow_delete_query', 'true', true)`);
        for (const o of objects) {
          await tx.query(`delete from storage.objects where bucket_id = $1 and name = $2`, [
            o.bucket,
            o.name,
          ]);
        }
      });
    },
    // The Auth admin API's delete: public.users, and the person's seats, go with the Auth user.
    deleteAuthUser: async (userId) => {
      calls.push('deleteAuthUser');
      await db.query(`delete from auth.users where id = $1`, [userId]);
    },
    sweepAuditLog: async (p) => {
      await db.query(`select public.erase_auth_audit_log($1, $2)`, [p.userId, p.emails]);
    },
    recount: async (p) =>
      (
        await db.query<{ r: { counts: Record<string, number>; storage: StorageObject[] } }>(
          `select public.erase_person_counts($1, $2, $3) as r`,
          [p.userId, p.emails, p.accounts],
        )
      ).rows[0]!.r,
    // The mailer's records of the person's address hashes (CC-28): the real function, with a pepper
    // of the test's own.
    mailPepper: MAIL_PEPPER,
    mailRecords: async (hashes, apply) =>
      (
        await db.query<{ r: MailRecordCounts }>(
          `select public.erase_mail_records($1::text[], $2) as r`,
          [[...hashes], apply],
        )
      ).rows[0]!.r,
  };
}

/** Runs the erasure and returns the plan it acted on and its calls, in order. */
async function erase(target: ErasureTarget) {
  const calls: string[] = [];
  const result = await erasePerson(ports(calls), target);
  if (!result.ok) throw new Error(`the erasure was refused: ${result.refusals.join('; ')}`);
  return { before: result.before, after: result.after, calls };
}

/** The counts of a plan that are not zero. */
const counted = (p: Pick<ErasurePlan, 'counts'>) =>
  Object.fromEntries(Object.entries(p.counts).filter(([, v]) => v !== 0));

/** What is left of an address once its person is erased: a plan by address counts nothing. */
async function nothingLeftOf(email: string) {
  const again = await plan({ email });
  expect(again.userId).toBeNull();
  expect(counted(again)).toEqual({});
  expect(again.storage).toEqual([]);
  expect(again.accounts).toEqual([]);
}

/** Rows of `table` whose `column` holds `email`, whatever its case. */
const holding = (table: string, column: string, email: string) =>
  n(`select count(*) from public.${table} where lower(${column}) = lower($1)`, [email]);

const sha = (s: string) => createHash('sha256').update(s).digest('hex');

async function storedReport(accountId: string, siteId: string, checkId: string, path: string) {
  const id = randomUUID();
  await insertRow(db, 'reports', {
    ...ROWS.reports(id, accountId, siteId, checkId),
    file_state: 'stored',
    storage_path: path,
  });
  await db.query(`insert into storage.objects (bucket_id, name) values ('reports', $1)`, [path]);
  return id;
}

const stored = (path: string) =>
  n(`select count(*) from storage.objects where bucket_id = 'reports' and name = $1`, [path]);

/** The line of `erase_person_counts`' storage list that names a report's file. */
const REPORTS_LINE = `    select 'reports', rp.storage_path from public.reports rp
     where rp.account_id = any(v_accounts) and rp.storage_path is not null
    union all
`;

describe('(a) a person invited to another account’s agency, not yet accepted', () => {
  let invitee: Person;
  let seat: string;

  beforeAll(async () => {
    invitee = await person(db, 'invitee');
    seat = randomUUID();
    // As an invitation is stored: no user yet, the address as the owner typed it, a token's hash
    // and its expiry.
    await db.query(
      `insert into public.seats (id, account_id, invited_email, role, status, client_scope_all,
                                 invite_token_hash, invite_expires_at)
       values ($1, $2, $3, 'developer', 'invited', false, $4, now() + interval '7 days')`,
      [seat, world.accountId, invitee.email.toUpperCase(), sha(`invite-${seat}`)],
    );
    await insertRow(db, 'seat_sites', ROWS.seat_sites(seat, world.site1.id, world.accountId));
  });

  it('the plan counts the invitation, and keeps the other account out of what it deletes', async () => {
    const p = await plan({ userId: invitee.id });
    expect(p.counts['seats deleted (invitations in other accounts)']).toBe(1);
    expect(p.accounts).toEqual([invitee.accountId]);
    expect(p.refusals).toEqual([]);
  });

  it('the erasure removes the invitation and its scope, and nothing else of that account', async () => {
    const seatsBefore = await n(`select count(*) from public.seats where account_id = $1`, [
      world.accountId,
    ]);
    await erase({ userId: invitee.id });
    expect(await holding('seats', 'invited_email', invitee.email)).toBe(0);
    expect(await n(`select count(*) from public.seat_sites where seat_id = $1`, [seat])).toBe(0);
    expect(
      await n(`select count(*) from public.seats where account_id = $1`, [world.accountId]),
    ).toBe(seatsBefore - 1);
    await nothingLeftOf(invitee.email);
  });
});

describe('(b) a person with an active seat on another account’s agency', () => {
  let member: Person;
  let seat: string;
  let link: string;

  beforeAll(async () => {
    member = await person(db, 'member');
    seat = await addSeat(db, world.accountId, member, 'account_manager', [world.site1.id]);
    // What an account manager leaves on the agency: a client they own, a report under their seat,
    // and a share link they made for it.
    await db.query(`update public.sites set owner_seat_id = $2 where id = $1`, [
      world.site1.id,
      seat,
    ]);
    await db.query(`update public.reports set owner_seat_id = $2 where id = $1`, [
      world.site1.report,
      seat,
    ]);
    link = sha(`link-${seat}`);
    await insertRow(db, 'share_links', {
      ...ROWS.share_links(link, world.site1.report),
      created_by: member.id,
    });
  });

  it('the plan counts both of the person’s seats and the link, and deletes only their own account', async () => {
    const p = await plan({ userId: member.id });
    expect(p.counts['seats deleted (own)']).toBe(2);
    expect(p.counts['share_links.created_by nulled']).toBe(1);
    expect(p.accounts).toEqual([member.accountId]);
    expect(p.refusals).toEqual([]);
  });

  it('the erasure ends the seat; the agency keeps its client, report and link, with no trace of who', async () => {
    await erase({ userId: member.id });
    expect(await n(`select count(*) from public.seats where id = $1`, [seat])).toBe(0);
    expect(await holding('seats', 'invited_email', member.email)).toBe(0);
    expect(await n(`select count(*) from public.seat_sites where seat_id = $1`, [seat])).toBe(0);
    const kept = await db.query<{ site_owner: string | null; report_owner: string | null }>(
      `select s.owner_seat_id as site_owner, r.owner_seat_id as report_owner
         from public.sites s join public.reports r on r.site_id = s.id
        where s.id = $1 and r.id = $2`,
      [world.site1.id, world.site1.report],
    );
    expect(kept.rows).toEqual([{ site_owner: null, report_owner: null }]);
    const links = await db.query<{ created_by: string | null }>(
      `select created_by from public.share_links where token_hash = $1`,
      [link],
    );
    expect(links.rows).toEqual([{ created_by: null }]);
    expect(await n(`select count(*) from public.accounts where id = $1`, [world.accountId])).toBe(
      1,
    );
    await nothingLeftOf(member.email);
  });
});

describe('(c) the owner of an agency with invited seats, stored reports, share links and a client contact', () => {
  let owner: Person;
  let agencyId: string;
  let site: string;
  const invited = `colleague-${randomUUID().slice(0, 8)}@example.com`;
  const contact = `client-${randomUUID().slice(0, 8)}@example.com`;
  const paths = { pdf: '', csv: '', left: '' };
  let outsideLink: string;

  beforeAll(async () => {
    owner = await person(db, 'agency-owner');
    agencyId = (await agencyAccount(db, owner, 'Kestrel Creative')).accountId;
    site = (await keptSite(db, agencyId)).id;
    await db.query(
      `update public.sites set client_name = 'Pinecrest', client_contact_name = 'Rosa',
              client_contact_email = $2 where id = $1`,
      [site, contact],
    );
    await db.query(
      `insert into public.seats (account_id, invited_email, role, status, invite_token_hash,
                                 invite_expires_at)
       values ($1, $2, 'account_manager', 'invited', $3, now() + interval '7 days')`,
      [agencyId, invited, sha(`invite-${agencyId}`)],
    );
    const check = randomUUID();
    await insertRow(db, 'checks', ROWS.checks(check, site));
    paths.pdf = `${agencyId}/${randomUUID()}.pdf`;
    paths.csv = `${agencyId}/${randomUUID()}.csv`;
    const pdf = await storedReport(agencyId, site, check, paths.pdf);
    await storedReport(agencyId, site, check, paths.csv);
    // A report that has no file (a public link): there is nothing in the bucket to remove for it.
    await insertRow(db, 'reports', ROWS.reports(randomUUID(), agencyId, site, check));
    // A report whose file was put and whose row was never marked stored (security review r1, M2):
    // the row names its object from its first write, so the object is found all the same.
    paths.left = `${agencyId}/${randomUUID()}.pdf`;
    await insertRow(db, 'reports', {
      ...ROWS.reports(randomUUID(), agencyId, site, check),
      file_state: 'failed',
      failed_reason: 'object_left',
      storage_path: paths.left,
    });
    await db.query(`insert into storage.objects (bucket_id, name) values ('reports', $1)`, [
      paths.left,
    ]);
    await insertRow(db, 'report_schedules', {
      ...ROWS.report_schedules(site, agencyId),
      page_slug: `kestrel-${site.slice(0, 8)}`,
    });
    await insertRow(db, 'share_links', {
      ...ROWS.share_links(sha(`own-${pdf}`), pdf),
      created_by: owner.id,
    });
    // And a link the person made for another account's report, which stays.
    outsideLink = sha(`outside-${pdf}`);
    await insertRow(db, 'share_links', {
      ...ROWS.share_links(outsideLink, world.site2.report),
      created_by: owner.id,
    });
  });

  it('the plan deletes both of the person’s accounts and lists each stored report’s file', async () => {
    const p = await plan({ userId: owner.id });
    expect([...p.accounts].sort()).toEqual([owner.accountId, agencyId].sort());
    expect(p.counts['accounts deleted']).toBe(2);
    expect(p.counts['reports deleted']).toBe(4);
    expect(p.counts['sites deleted']).toBe(1);
    expect(p.counts['share_links.created_by nulled']).toBe(2);
    // The files are the one thing in the way, and the sequence removes them itself.
    expect(p.refusalCodes).toEqual(['storage']);
  });

  it('lists each report’s object for removal before its row goes: the stored files, and the object of a report that failed after its file was put', async () => {
    const p = await plan({ userId: owner.id });
    expect(p.storage).toEqual(
      [paths.pdf, paths.csv, paths.left].sort().map((name) => ({ bucket: 'reports', name })),
    );
  });

  it('the erasure removes the files first, then the accounts with their seats, reports and links', async () => {
    const { calls } = await erase({ userId: owner.id });
    expect(calls).toEqual([
      `removeStorage ${[paths.pdf, paths.csv, paths.left]
        .sort()
        .map((name) => `reports/${name}`)
        .join(' ')}`,
      'apply',
      'deleteAuthUser',
    ]);
    for (const path of Object.values(paths)) expect(await stored(path), path).toBe(0);
    for (const table of ['seats', 'sites', 'reports', 'report_schedules']) {
      expect(
        await n(`select count(*) from public.${table} where account_id = $1`, [agencyId]),
        table,
      ).toBe(0);
    }
    expect(
      await n(`select count(*) from public.accounts where id = any($1)`, [
        [agencyId, owner.accountId],
      ]),
    ).toBe(0);
    // The addresses the agency held go with it: the colleague it invited, the client it wrote to.
    expect(await holding('seats', 'invited_email', invited)).toBe(0);
    expect(await holding('sites', 'client_contact_email', contact)).toBe(0);
    expect(
      await n(`select count(*) from public.share_links l where not exists
                 (select 1 from public.reports r where r.id = l.report_id)`),
    ).toBe(0);
    await nothingLeftOf(owner.email);
  });

  it('with that line taken out of the migration’s text, the file is listed nowhere and nothing stops the erasure', async () => {
    // The counterfactual, on a second database built from the migrations with the one line removed:
    // the plan no longer lists the file and no longer refuses, so `apply` would delete the report's
    // row and leave its file in the bucket with nothing left that names it.
    const other = await freshDb();
    try {
      let edits = 0;
      await applyAllMigrations(other, (sql) => {
        if (!sql.includes(REPORTS_LINE)) return sql;
        edits += 1;
        return sql.replace(REPORTS_LINE, '');
      });
      expect(edits).toBe(1);
      const p = await person(other, 'no-list');
      const account = (await agencyAccount(other, p)).accountId;
      const kept = await keptSite(other, account);
      const path = `${account}/${randomUUID()}.pdf`;
      await other.query(
        `insert into public.reports (account_id, site_id, kind, format, status, made_by, covers_check_ids,
                                     file_state, storage_path)
         values ($1, $2, 'audit_pdf', 'pdf', 'ready', 'user', array[gen_random_uuid()], 'stored', $3)`,
        [account, kept.id, path],
      );
      await other.query(`insert into storage.objects (bucket_id, name) values ('reports', $1)`, [
        path,
      ]);
      const read = async (db: PGlite) =>
        (
          await db.query<{ r: ErasurePlan }>(`select public.erase_person_plan($1, null) as r`, [
            p.id,
          ])
        ).rows[0]!.r;
      const mutated = await read(other);
      expect(mutated.counts['reports deleted']).toBe(1);
      expect(mutated.storage).toEqual([]);
      expect(mutated.refusalCodes).toEqual([]);
    } finally {
      await other.close();
    }
  }, 300_000);

  it('a link the person made for another account’s report stays, with nobody named on it', async () => {
    const links = await db.query<{ created_by: string | null; report_id: string }>(
      `select created_by, report_id from public.share_links where token_hash = $1`,
      [outsideLink],
    );
    expect(links.rows).toEqual([{ created_by: null, report_id: world.site2.report }]);
  });
});

describe('(d) the client contact and report recipient of another account', () => {
  /** site2 of the world's agency, with `email` as its client contact and two reports sent to it. */
  async function asContact(email: string) {
    await db.query(
      `update public.sites set client_contact_name = 'Jordan', client_contact_email = $2 where id = $1`,
      [world.site2.id, email],
    );
    for (const sent of [true, false]) {
      await insertRow(db, 'reports', {
        ...ROWS.reports(randomUUID(), world.accountId, world.site2.id, world.site2.check),
        kind: 'client_report',
        format: 'html',
        made_by: 'report_schedule',
        status: sent ? 'sent' : 'scheduled',
        sent_at: sent ? '2026-11-02T15:00:00.000Z' : null,
        scheduled_for: sent ? null : '2026-11-09T15:00:00.000Z',
        recipient_email: sent ? email : email.toUpperCase(),
      });
    }
  }

  const contactOf = async () =>
    (
      await db.query<{ name: string | null; email: string | null }>(
        `select client_contact_name as name, client_contact_email as email from public.sites where id = $1`,
        [world.site2.id],
      )
    ).rows[0]!;

  it('a contact with an account of their own: the address is blanked on the site and on each report', async () => {
    const contact = await person(db, 'contact');
    await asContact(contact.email);
    const p = await plan({ userId: contact.id });
    expect(p.counts['sites.client_contact_email nulled']).toBe(1);
    expect(p.counts['reports.recipient_email nulled']).toBe(2);
    expect(p.accounts).toEqual([contact.accountId]);
    const reports = await n(`select count(*) from public.reports where account_id = $1`, [
      world.accountId,
    ]);

    await erase({ userId: contact.id });
    expect((await contactOf()).email).toBeNull();
    expect(await holding('reports', 'recipient_email', contact.email)).toBe(0);
    // The agency's rows stay: the site, and every report, with no address on them.
    expect(
      await n(`select count(*) from public.reports where account_id = $1`, [world.accountId]),
    ).toBe(reports);
    await nothingLeftOf(contact.email);
  });

  it('a contact who confirmed and paused: the schedule keeps no record of them once they are erased', async () => {
    const email = `confirmed-${randomUUID().slice(0, 8)}@client.example`;
    await asContact(email);
    // The schedule as the product leaves it for a contact who confirmed, was mailed a report (the
    // pause link's hash is derived from their address) and then pressed the pause link.
    await db.query(`delete from public.report_schedules where site_id = $1`, [world.site2.id]);
    await insertRow(db, 'report_schedules', {
      ...ROWS.report_schedules(world.site2.id, world.accountId),
      page_slug: `erased-${world.site2.id.slice(0, 8)}`,
      recipient_confirm_hash: sha(`confirm-${email}`),
      recipient_confirm_sent_at: '2026-11-01T10:00:00.000Z',
      recipient_confirmed_at: '2026-11-01T10:05:00.000Z',
      pause_token_hash: sha(`pause-${email}`),
      paused_by_recipient_at: '2026-11-08T10:00:00.000Z',
    });
    await erase({ email });
    const {
      rows: [left],
    } = await db.query(
      `select recipient_confirm_hash, recipient_confirm_sent_at, recipient_confirmed_at,
              pause_token_hash, paused_by_recipient_at
         from public.report_schedules where site_id = $1`,
      [world.site2.id],
    );
    expect(left).toEqual({
      recipient_confirm_hash: null,
      recipient_confirm_sent_at: null,
      recipient_confirmed_at: null,
      pause_token_hash: null,
      paused_by_recipient_at: null,
    });
    await nothingLeftOf(email);
  });

  it('a contact with no account, erased by address: the same two rules', async () => {
    const email = `no-account-${randomUUID().slice(0, 8)}@client.example`;
    await asContact(email);
    const p = await plan({ email });
    expect(p.userId).toBeNull();
    expect(counted(p)).toEqual({
      'sites.client_contact_email nulled': 1,
      'reports.recipient_email nulled': 2,
    });
    const { calls } = await erase({ email });
    expect(calls).toEqual(['apply']);
    expect((await contactOf()).email).toBeNull();
    expect(await holding('reports', 'recipient_email', email)).toBe(0);
    await nothingLeftOf(email);
  });

  it('known gap, reported: the contact’s name stays beside the blanked address (no rule names sites.client_contact_name)', async () => {
    // Rule 30 sets `client_contact_email = null` and nothing else. This pins what the rules do
    // today, so the day a rule covers the name this test says so.
    const email = `named-${randomUUID().slice(0, 8)}@client.example`;
    await asContact(email);
    await erase({ email });
    expect(await contactOf()).toEqual({ name: 'Jordan', email: null });
  });
});

describe('(e) an invitation that was mailed', () => {
  const NOW = new Date('2026-11-14T12:00:00.000Z');

  /**
   * Invites `email` to `accountId` as the seats route does and sends its mail as the mail function
   * does, over production's store and ledger with the erasure's pepper; the transport is in memory.
   */
  async function mailedInvitation(accountId: string, email: string) {
    const invited = await supabaseSeatsStore(adminOver(db)).invite({
      accountId,
      email,
      role: 'developer',
      siteIds: null,
      cap: 100,
      now: NOW,
    });
    if (invited.outcome !== 'invited') throw new Error(`not invited: ${invited.outcome}`);
    const transport = memoryTransport();
    const handlers = mailHandlers({
      mail: {
        ledger: supabaseMailLedger(adminOver(db)),
        transport,
        pepper: MAIL_PEPPER,
        now: () => NOW,
        log: () => undefined,
      },
      store: supabaseMailStore(adminOver(db)),
      capture: async () => undefined,
    });
    expect(await handlers.seatInvite(invited.seatId, invited.seq)).toBe('sent');
    expect(transport.sent.map((m) => m.to)).toEqual([email]);
    return { seatId: invited.seatId, key: `seat_invite:${invited.seatId}:${invited.seq}` };
  }

  /** An agency with seats free, to invite from: the world's own has none left by now. */
  const inviter = async () =>
    (await agencyAccount(db, await person(db, 'inviting-owner'), 'Harbor & Vale')).accountId;

  const sendsTo = (email: string) =>
    n(`select count(*) from public.email_sends where address_hash = $1`, [
      hashMailAddress(MAIL_PEPPER, email),
    ]);
  const sendsKeyed = (key: string) =>
    n(`select count(*) from public.email_sends where idempotency_key = $1`, [key]);

  it('an invitee with an account, erased: no ledger row is left for their address hash', async () => {
    const invitee = await person(db, 'mailed-invitee');
    const agencyId = await inviter();
    const { seatId, key } = await mailedInvitation(agencyId, invitee.email);
    expect(await sendsTo(invitee.email)).toBe(1);

    const { before, after } = await erase({ userId: invitee.id });
    expect(before.counts[MAIL_SENDS_KEY]).toBe(1);
    expect(after.counts[MAIL_SENDS_KEY]).toBe(0);
    expect(await sendsTo(invitee.email)).toBe(0);
    expect(await sendsKeyed(key)).toBe(0);
    expect(await n(`select count(*) from public.seats where id = $1`, [seatId])).toBe(0);
    // The inviting account is another person's and stays.
    expect(await n(`select count(*) from public.accounts where id = $1`, [agencyId])).toBe(1);
    await nothingLeftOf(invitee.email);
  });

  it('an invitee with no account, erased by address in another case: the same', async () => {
    const email = `mailed-${randomUUID().slice(0, 8)}@example.com`;
    const { seatId, key } = await mailedInvitation(await inviter(), email);
    expect(await sendsTo(email)).toBe(1);

    const { before } = await erase({ email: email.toUpperCase() });
    expect(before.userId).toBeNull();
    expect(before.counts[MAIL_SENDS_KEY]).toBe(1);
    expect(await sendsTo(email)).toBe(0);
    expect(await sendsKeyed(key)).toBe(0);
    expect(await n(`select count(*) from public.seats where id = $1`, [seatId])).toBe(0);
    await nothingLeftOf(email);
  });

  it('an owner erased with their agency: no ledger row is left for the account, the invitation’s among them', async () => {
    const owner = await person(db, 'mailing-owner');
    const agencyId = (await agencyAccount(db, owner, 'Fernhill Studio')).accountId;
    const colleague = `colleague-${randomUUID().slice(0, 8)}@example.com`;
    const { key } = await mailedInvitation(agencyId, colleague);
    const ofAccount = () =>
      n(`select count(*) from public.email_sends where account_id = $1`, [agencyId]);
    expect(await ofAccount()).toBe(1);

    const { before } = await erase({ userId: owner.id });
    expect(before.counts['email_sends deleted (accounts)']).toBe(1);
    expect(await ofAccount()).toBe(0);
    // The row is gone, not kept with its account blanked: the colleague's hash finds nothing either.
    expect(await sendsKeyed(key)).toBe(0);
    expect(await sendsTo(colleague)).toBe(0);
  });
});
