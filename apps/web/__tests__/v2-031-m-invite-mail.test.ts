import type { PGlite } from '@electric-sql/pglite';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { adminOver, makePaid, person, type Person } from '../lib/v2/account/sites-test-support';
import { hashToken } from '../lib/v2/account/tokens';
import { INVITE_LINK_DAYS } from '../lib/v2/agency/seats';
import { supabaseSeatsStore } from '../lib/v2/agency/seats-store';
import { hashMailAddress } from '../lib/v2/mail/address-hash';
import { mailHandlers } from '../lib/v2/mail/handlers';
import { supabaseMailLedger } from '../lib/v2/mail/ledger';
import { memoryTransport } from '../lib/v2/mail/memory';
import type { MailDeps } from '../lib/v2/mail/send';
import { supabaseMailStore } from '../lib/v2/mail/store';
import { applyAllMigrations, freshDb } from './helpers/pglite-migrations';

/**
 * A seat's invitation mail, end to end over the migrated schema (docs/specs/v2/31-agency.md §6): the
 * seats routes' store writes the invitation, and the mail handler runs over production's store and
 * ledger (`supabaseMailStore`, `supabaseMailLedger`) through the PostgREST stand-in, so the SQL is the
 * real `issue_seat_invite`, `read_seat_invite` and `claim_email_send`. The transport is in memory:
 * nothing here can reach an inbox.
 */

const PEPPER = 'p'.repeat(40);
const NOW = new Date('2026-11-14T12:00:00.000Z');
const DAY_MS = 24 * 60 * 60 * 1000;

let db: PGlite;

beforeAll(async () => {
  db = await freshDb();
  await applyAllMigrations(db);
}, 300_000);
afterAll(async () => db.close());

const seats = () => supabaseSeatsStore(adminOver(db));

function mailer() {
  const transport = memoryTransport();
  const log = vi.fn();
  const mail: MailDeps = {
    ledger: supabaseMailLedger(adminOver(db)),
    transport,
    pepper: PEPPER,
    now: () => NOW,
    log,
  };
  const h = mailHandlers({
    mail,
    store: supabaseMailStore(adminOver(db)),
    capture: async () => undefined,
  });
  return { h, transport, log };
}

async function agency(): Promise<Person> {
  const owner = await person(db, 'm-owner');
  await makePaid(db, owner.accountId, 'agency');
  await db.query(`update public.accounts set name = 'Summit Digital' where id = $1`, [
    owner.accountId,
  ]);
  return owner;
}

let invitees = 0;
/** An invitation written as the route writes it: the seat and its number, and the invited address. */
async function invitation(owner: Person, email = `m-invitee-${++invitees}@example.com`) {
  const r = await seats().invite({
    accountId: owner.accountId,
    email,
    role: 'developer',
    siteIds: null,
    cap: 100,
    now: NOW,
  });
  if (r.outcome !== 'invited') throw new Error(`not invited: ${r.outcome}`);
  return { seatId: r.seatId, seq: r.seq, email };
}

/** The token in a sent invitation's link. */
const tokenIn = (text: string) =>
  /https:\/\/crawlmouse\.com\/invite\/([A-Za-z0-9_-]{43})\b/.exec(text)![1]!;

const seatRow = async (seatId: string) =>
  (
    await db.query<{ invite_token_hash: string | null; invite_expires_at: Date | null }>(
      `select invite_token_hash, invite_expires_at from public.seats where id = $1`,
      [seatId],
    )
  ).rows[0]!;

const ledgerRows = async (seatId: string) =>
  (
    await db.query<{
      idempotency_key: string;
      kind: string;
      status: string;
      error_code: string | null;
    }>(
      `select idempotency_key, kind, status, error_code from public.email_sends
        where idempotency_key like $1 order by idempotency_key`,
      [`seat_invite:${seatId}:%`],
    )
  ).rows;

describe('one invitation, one mail', () => {
  it('goes to the invited address with a link the invitation page reads, stored as its hash', async () => {
    const owner = await agency();
    const inv = await invitation(owner);
    const { h, transport } = mailer();
    expect(await h.seatInvite(inv.seatId, inv.seq)).toBe('sent');
    expect(transport.sent).toHaveLength(1);
    const m = transport.sent[0]!;
    expect(m.to).toBe(inv.email);
    expect(m.subject).toBe('You are invited to an account on Crawlmouse');
    expect(m.text).toContain('Its owner calls it “Summit Digital”.');
    expect(m.idempotencyKey).toBe(`seat_invite:${inv.seatId}:1`);

    const token = tokenIn(m.text);
    const row = await seatRow(inv.seatId);
    expect(row.invite_token_hash).toBe(hashToken(token));
    expect(row.invite_expires_at!.getTime()).toBe(NOW.getTime() + INVITE_LINK_DAYS * DAY_MS);
    expect(await seats().readInvite(token, NOW)).toEqual({
      accountName: 'Summit Digital',
      role: 'developer',
      everyClient: true,
    });
    expect(await ledgerRows(inv.seatId)).toEqual([
      {
        idempotency_key: `seat_invite:${inv.seatId}:1`,
        kind: 'seat_invite',
        status: 'sent',
        error_code: null,
      },
    ]);
  });

  it('the same event a second time sends nothing and leaves the delivered link the stored one', async () => {
    const owner = await agency();
    const inv = await invitation(owner);
    const { h, transport } = mailer();
    await h.seatInvite(inv.seatId, inv.seq);
    const before = await seatRow(inv.seatId);
    expect(await h.seatInvite(inv.seatId, inv.seq)).toBe('done');
    expect(await mailer().h.seatInvite(inv.seatId, inv.seq)).toBe('done');
    expect(transport.sent).toHaveLength(1);
    expect((await seatRow(inv.seatId)).invite_token_hash).toBe(before.invite_token_hash);
    expect(await seats().readInvite(tokenIn(transport.sent[0]!.text), NOW)).not.toBeNull();
  });
});

describe('a resend', () => {
  it('is a second mail with another link; the first link’s hash is no longer the stored one', async () => {
    const owner = await agency();
    const inv = await invitation(owner);
    const { h, transport } = mailer();
    await h.seatInvite(inv.seatId, inv.seq);
    const first = tokenIn(transport.sent[0]!.text);

    const again = await seats().resend(inv.seatId, owner.accountId);
    expect(again).toEqual({ outcome: 'resent', seq: 2 });
    // The link sent before stops working at once, before the new mail is sent.
    expect(await seats().readInvite(first, NOW)).toBeNull();
    expect(await h.seatInvite(inv.seatId, 2)).toBe('sent');

    expect(transport.sent).toHaveLength(2);
    const second = tokenIn(transport.sent[1]!.text);
    expect(second).not.toBe(first);
    const row = await seatRow(inv.seatId);
    expect(row.invite_token_hash).toBe(hashToken(second));
    expect(row.invite_token_hash).not.toBe(hashToken(first));
    expect(await seats().readInvite(first, NOW)).toBeNull();
    expect(await seats().readInvite(second, NOW)).not.toBeNull();
    expect((await ledgerRows(inv.seatId)).map((r) => [r.idempotency_key, r.status])).toEqual([
      [`seat_invite:${inv.seatId}:1`, 'sent'],
      [`seat_invite:${inv.seatId}:2`, 'sent'],
    ]);
  });

  it('the first invitation’s event, arriving after the resend, sends nothing and mints nothing', async () => {
    const owner = await agency();
    const inv = await invitation(owner);
    await seats().resend(inv.seatId, owner.accountId);
    const { h, transport } = mailer();
    expect(await h.seatInvite(inv.seatId, 1)).toBe('not_invited');
    expect(transport.sent).toEqual([]);
    expect((await seatRow(inv.seatId)).invite_token_hash).toBeNull();
    expect(await ledgerRows(inv.seatId)).toEqual([]);
  });
});

describe('an invitation that sends nothing', () => {
  it('an accepted seat', async () => {
    const owner = await agency();
    const guest = await person(db, 'm-guest');
    const inv = await invitation(owner, guest.email);
    const first = mailer();
    await first.h.seatInvite(inv.seatId, inv.seq);
    const accepted = await seats().accept(tokenIn(first.transport.sent[0]!.text), guest.id, NOW);
    expect(accepted.outcome).toBe('accepted');

    const { h, transport } = mailer();
    expect(await h.seatInvite(inv.seatId, inv.seq)).toBe('not_invited');
    expect(await h.seatInvite(inv.seatId, inv.seq + 1)).toBe('not_invited');
    expect(transport.sent).toEqual([]);
  });

  it('a removed seat', async () => {
    const owner = await agency();
    const inv = await invitation(owner);
    expect((await seats().remove(inv.seatId, owner.accountId, NOW)).outcome).toBe('removed');
    const { h, transport } = mailer();
    expect(await h.seatInvite(inv.seatId, inv.seq)).toBe('not_invited');
    expect(transport.sent).toEqual([]);
    expect(await ledgerRows(inv.seatId)).toEqual([]);
  });

  it('a seat of an account marked for deletion: no claim, no link', async () => {
    const owner = await agency();
    const inv = await invitation(owner);
    await db.query(
      `update public.accounts set deletion_confirmed_at = now(), purge_after = now() + interval '7 days' where id = $1`,
      [owner.accountId],
    );
    const { h, transport } = mailer();
    expect(await h.seatInvite(inv.seatId, inv.seq)).toBe('marked');
    expect(transport.sent).toEqual([]);
    expect((await seatRow(inv.seatId)).invite_token_hash).toBeNull();
    expect(await ledgerRows(inv.seatId)).toEqual([]);
  });

  it('a seat that does not exist', async () => {
    const { h, transport } = mailer();
    expect(await h.seatInvite('6f1c2a8e-0000-4000-8000-0000000000f1', 1)).toBe('not_invited');
    expect(transport.sent).toEqual([]);
  });
});

describe('a suppression', () => {
  it('does not stop an invitation: the database lets the claim go for an address that hard-bounced', async () => {
    const owner = await agency();
    const inv = await invitation(owner);
    await db.query(`select public.record_email_suppression($1, 'hard_bounce', $2)`, [
      hashMailAddress(PEPPER, inv.email),
      NOW.toISOString(),
    ]);
    const { h, transport } = mailer();
    expect(await h.seatInvite(inv.seatId, inv.seq)).toBe('sent');
    expect(transport.sent.map((m) => m.to)).toEqual([inv.email]);
  });
});

describe('what is written down', () => {
  it('the ledger row holds the address’s hash and the account, and no log line was written', async () => {
    const owner = await agency();
    const inv = await invitation(owner);
    const { h, log } = mailer();
    await h.seatInvite(inv.seatId, inv.seq);
    const { rows } = await db.query<{ address_hash: string; account_id: string }>(
      `select address_hash, account_id from public.email_sends where idempotency_key = $1`,
      [`seat_invite:${inv.seatId}:1`],
    );
    expect(rows).toEqual([
      { address_hash: hashMailAddress(PEPPER, inv.email), account_id: owner.accountId },
    ]);
    expect(log).not.toHaveBeenCalled();
  });
});
