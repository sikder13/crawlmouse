import { describe, expect, it, vi } from 'vitest';
import { GATES } from '../../entitlement-v2';
import {
  inviteMailEvent,
  inviteSeat,
  parseChangeBody,
  parseInviteBody,
  resendInvite,
  type SeatAccount,
  type SeatDeps,
} from './seats';
import { inngestInviteMail, type SeatsStore } from './seats-store';

vi.mock('../../../../../inngest/client', () => ({ inngest: { send: vi.fn() } }));

const A = '6f1c2a8e-0000-4000-8000-00000000000a';
const B = '6f1c2a8e-0000-4000-8000-00000000000b';
const SEAT = '6f1c2a8e-0000-4000-8000-0000000000f1';

describe('parseInviteBody', () => {
  it('reads JSON: the address trimmed and in lower case, a role, and every client or a list of ids', () => {
    expect(
      parseInviteBody({ email: ' Dana@Example.COM ', role: 'developer', scope: 'all' }),
    ).toEqual({
      email: 'dana@example.com',
      role: 'developer',
      scope: 'all',
    });
    expect(
      parseInviteBody({ email: 'd@example.com', role: 'account_manager', scope: [A, B] }),
    ).toEqual({ email: 'd@example.com', role: 'account_manager', scope: [A, B] });
  });

  it('reads a form: scope=some is the boxes ticked; scope=all drops them', () => {
    const base = { email: 'd@example.com', role: 'developer' };
    expect(
      parseInviteBody({ ...base, scope: 'some', [`site_${A}`]: 'on', [`site_${B}`]: 'on' }),
    ).toEqual({
      ...base,
      scope: [A, B],
    });
    expect(parseInviteBody({ ...base, scope: 'all', [`site_${A}`]: 'on' })).toEqual({
      ...base,
      scope: 'all',
    });
  });

  it('refuses what is not that body', () => {
    const base = { email: 'd@example.com', role: 'developer', scope: 'all' };
    const refused = [
      { ...base, role: 'owner' },
      { ...base, role: 'admin' },
      { ...base, email: 'no at sign' },
      { ...base, email: `${'a'.repeat(250)}@example.com` },
      { ...base, scope: [] },
      { ...base, scope: 'some' },
      { ...base, scope: ['not-an-id'] },
      { ...base, scope: Array.from({ length: GATES.agency.maxSites + 1 }, () => A) },
      { ...base, scope: [A], [`site_${B}`]: 'on' },
      { email: base.email, role: base.role, [`site_${A}`]: 'on' },
      { ...base, cap: 100 },
      { ...base, accountId: A },
      { role: base.role, scope: base.scope },
    ];
    expect(refused.map((b) => parseInviteBody(b))).toEqual(refused.map(() => null));
  });
});

describe('parseChangeBody', () => {
  it('reads a role and a scope, and nothing else', () => {
    expect(parseChangeBody({ role: 'developer', scope: [A] })).toEqual({
      role: 'developer',
      scope: [A],
    });
    expect(
      parseChangeBody({ role: 'account_manager', scope: 'some', [`site_${A}`]: 'on' }),
    ).toEqual({
      role: 'account_manager',
      scope: [A],
    });
    for (const body of [
      { role: 'owner', scope: 'all' },
      { role: 'developer' },
      { scope: 'all' },
      { role: 'developer', scope: 'all', email: 'x@example.com' },
    ]) {
      expect(parseChangeBody(body), JSON.stringify(body)).toBeNull();
    }
  });
});

describe('the invitation mail’s request', () => {
  it('names the seat and the invitation’s number, and holds nothing else', () => {
    expect(inviteMailEvent({ seatId: SEAT, seq: 3 })).toEqual({
      id: `seat_invite:${SEAT}:3`,
      name: 'seat.invite.requested',
      data: { seat_id: SEAT, seq: 3 },
    });
  });

  it('has one id for one invitation, and another for the resend that follows it', () => {
    const first = inviteMailEvent({ seatId: SEAT, seq: 1 });
    expect(inviteMailEvent({ seatId: SEAT, seq: 1 }).id).toBe(first.id);
    expect(inviteMailEvent({ seatId: SEAT, seq: 2 }).id).not.toBe(first.id);
    expect(inviteMailEvent({ seatId: A, seq: 1 }).id).not.toBe(first.id);
  });

  it('is sent as that event', async () => {
    const send = vi.fn(async (_e: unknown) => undefined);
    await inngestInviteMail(send).request({ seatId: SEAT, seq: 2 });
    expect(send.mock.calls).toEqual([[inviteMailEvent({ seatId: SEAT, seq: 2 })]]);
  });
});

describe('the routes’ answers', () => {
  const account: SeatAccount = { accountId: A, tier: 'agency', seatLimit: 5, canBuySeats: true };
  const body = {
    kind: 'json' as const,
    fields: { email: 'd@example.com', role: 'developer', scope: 'all' },
  };

  function deps(store: Partial<SeatsStore>) {
    const request = vi.fn(async (_i: { seatId: string; seq: number }) => undefined);
    const capture = vi.fn(async (..._a: unknown[]) => undefined);
    const allowed = async () => ({ allowed: true, resetAt: new Date(0) });
    const d: SeatDeps = {
      store: store as SeatsStore,
      capture,
      mail: { request },
      limits: { perAccount: allowed, perIp: allowed },
      now: () => new Date('2026-11-12T12:00:00.000Z'),
    };
    return { d, request, capture };
  }

  it('asks for the mail of the invitation written, with the limit the viewer read', async () => {
    const invite = vi.fn(async (_r: Parameters<SeatsStore['invite']>[0]) => ({
      outcome: 'invited' as const,
      seatId: SEAT,
      seq: 1,
    }));
    const { d, request } = deps({ invite });
    const res = await inviteSeat(d, { ...account, seatLimit: 7 }, body);
    expect(res.status).toBe(201);
    expect(invite.mock.calls[0]![0]).toMatchObject({ accountId: A, cap: 7, siteIds: null });
    expect(request.mock.calls).toEqual([[{ seatId: SEAT, seq: 1 }]]);
  });

  it('an account marked for deletion between the caller’s check and the write is the 404 of no account', async () => {
    const { d, request, capture } = deps({ invite: async () => ({ outcome: 'marked' }) });
    const res = await inviteSeat(d, account, body);
    expect(res.status).toBe(404);
    expect(request).not.toHaveBeenCalled();
    expect(capture).not.toHaveBeenCalled();
    const resent = await resendInvite(
      deps({ resend: async () => ({ outcome: 'marked' }) }).d,
      A,
      SEAT,
      'json',
    );
    expect(resent.status).toBe(404);
  });

  it('asks for the mail of the number a resend returned', async () => {
    const { d, request } = deps({ resend: async () => ({ outcome: 'resent', seq: 4 }) });
    await resendInvite(d, A, SEAT, 'json');
    expect(request.mock.calls).toEqual([[{ seatId: SEAT, seq: 4 }]]);
  });
});
