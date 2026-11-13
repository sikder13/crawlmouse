import { randomUUID } from 'node:crypto';
import type { PGlite } from '@electric-sql/pglite';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { applyAllMigrations, freshDb } from '@/__tests__/helpers/pglite-migrations';
import {
  addSeat,
  adminOver,
  person,
  sessionOver,
  type Person,
} from '@/lib/v2/account/sites-test-support';
import { MAGIC_LINK_PER_EMAIL_PER_HOUR } from '@/lib/limits';
import { operatorPerson, recordLines } from '@/lib/v2/ops/console-test-support';

// POST /api/internal/accounts/[id]/sign-in-link (CC-33 D2). The session and service-role clients are
// the PostgREST stand-in over PGlite with every migration applied; the rate limit and the request to
// Supabase Auth are fakes, each of which reads the record when it is called, so the order is seen.

const h = vi.hoisted(() => ({
  log: [] as string[],
  db: null as unknown as PGlite,
  user: null as { id: string; email: string } | null,
  allowed: true,
  answer: 'sent' as 'sent' | 'refused' | 'throw',
  linesAtRate: -1,
  linesAtLink: -1,
  rate: vi.fn(),
  link: vi.fn(),
}));

vi.mock('server-only', () => ({}));
vi.mock('@/lib/supabase/server', () => ({
  supabaseServer: async () => {
    h.log.push('supabaseServer');
    return sessionOver(h.db, h.user);
  },
}));
vi.mock('@/lib/supabase/admin', () => ({
  supabaseAdmin: () => {
    h.log.push('supabaseAdmin');
    return adminOver(h.db);
  },
}));
vi.mock('@/lib/rate-limit', () => ({
  checkRateLimit: async (...args: unknown[]) => {
    h.rate(...args);
    h.linesAtRate = (await h.db.query('select 1 from public.operator_actions')).rows.length;
    return { allowed: h.allowed };
  },
}));
vi.mock('@/lib/v2/ops/sign-in-link', () => ({
  requestSignInLink: async (email: string) => {
    h.link(email);
    h.linesAtLink = (await h.db.query('select 1 from public.operator_actions')).rows.length;
    if (h.answer === 'throw') throw new Error('network');
    return h.answer;
  },
}));

import { POST } from './route';

beforeAll(async () => {
  h.db = await freshDb();
  await applyAllMigrations(h.db);
}, 300_000);
afterAll(async () => {
  await h.db?.close();
});
beforeEach(() => {
  h.log.length = 0;
  h.user = null;
  h.allowed = true;
  h.answer = 'sent';
  h.linesAtRate = -1;
  h.linesAtLink = -1;
  h.rate.mockClear();
  h.link.mockClear();
});

const as = (p: Person | null) => {
  h.user = p && { id: p.id, email: p.email };
};

const resend = (accountId: string, fields: Record<string, string>) =>
  POST(
    new Request(`https://crawlmouse.com/api/internal/accounts/${accountId}/sign-in-link`, {
      method: 'POST',
      headers: {
        origin: 'https://crawlmouse.com',
        'content-type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams(fields).toString(),
    }),
    { params: Promise.resolve({ id: accountId }) },
  );

const HOUR_MS = 60 * 60 * 1000;

describe('anyone but an operator gets 404, and nothing is read or sent', () => {
  it.each(['signed out', 'signed in', 'a member of the account'] as const)('%s', async (who) => {
    const owner = await person(h.db, 'owner');
    as(who === 'signed out' ? null : who === 'signed in' ? await person(h.db, 'x') : owner);
    const before = (await recordLines(h.db)).length;
    const res = await resend(owner.accountId, { userId: owner.id, reason: 'locked out' });
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ code: 'not_found' });
    expect(h.log).not.toContain('supabaseAdmin');
    expect(h.rate).not.toHaveBeenCalled();
    expect(h.link).not.toHaveBeenCalled();
    expect((await recordLines(h.db)).length).toBe(before);
  });
});

describe("an operator's re-send", () => {
  it("records the re-send first, then takes the address's magic-link bucket, then asks for the link", async () => {
    const op = await operatorPerson(h.db);
    const owner = await person(h.db, 'owner');
    as(op);
    const before = (await recordLines(h.db)).length;
    const res = await resend(owner.accountId, { userId: owner.id, reason: 'locked out' });
    expect(res.status).toBe(303);
    expect(res.headers.get('location')).toBe(
      `/internal/accounts/${owner.accountId}?done=link_sent`,
    );
    expect(h.linesAtRate).toBe(before + 1);
    expect(h.linesAtLink).toBe(before + 1);
    expect(h.rate).toHaveBeenCalledWith(
      `magic:email:${owner.email}`,
      MAGIC_LINK_PER_EMAIL_PER_HOUR,
      HOUR_MS,
    );
    expect(h.link).toHaveBeenCalledWith(owner.email);
    expect((await recordLines(h.db)).at(-1)).toEqual({
      operator_id: op.id,
      action: 'resend_sign_in',
      account_id: owner.accountId,
      target: owner.id,
      reason: 'locked out',
      outcome: 'sent',
    });
  });

  it('goes to the address of an active seat of the account, a member who is not the owner included', async () => {
    const op = await operatorPerson(h.db);
    const owner = await person(h.db, 'owner');
    const dev = await person(h.db, 'dev');
    await addSeat(h.db, owner.accountId, dev, 'developer');
    as(op);
    await resend(owner.accountId, { userId: dev.id, reason: 'new phone' });
    expect(h.link).toHaveBeenCalledWith(dev.email);
  });

  it('answers 404 for a user with no active seat on the account, and records nothing', async () => {
    const op = await operatorPerson(h.db);
    const owner = await person(h.db, 'owner');
    const stranger = await person(h.db, 'stranger');
    as(op);
    const before = (await recordLines(h.db)).length;
    for (const userId of [stranger.id, randomUUID(), 'nope']) {
      expect((await resend(owner.accountId, { userId, reason: 'x' })).status).toBe(404);
    }
    expect((await resend('nope', { userId: owner.id, reason: 'x' })).status).toBe(404);
    expect((await recordLines(h.db)).length).toBe(before);
    expect(h.link).not.toHaveBeenCalled();
  });

  it('a full bucket sends nothing and is recorded as rate_limited', async () => {
    const op = await operatorPerson(h.db);
    const owner = await person(h.db, 'owner');
    as(op);
    h.allowed = false;
    const res = await resend(owner.accountId, { userId: owner.id, reason: 'again' });
    expect(res.headers.get('location')).toBe(
      `/internal/accounts/${owner.accountId}?done=rate_limited`,
    );
    expect(h.link).not.toHaveBeenCalled();
    expect((await recordLines(h.db)).at(-1)?.outcome).toBe('rate_limited');
  });

  it("Auth's refusal is recorded as refused", async () => {
    const op = await operatorPerson(h.db);
    const owner = await person(h.db, 'owner');
    as(op);
    h.answer = 'refused';
    const res = await resend(owner.accountId, { userId: owner.id, reason: 'x' });
    expect(res.headers.get('location')).toBe(
      `/internal/accounts/${owner.accountId}?done=link_refused`,
    );
    expect((await recordLines(h.db)).at(-1)?.outcome).toBe('refused');
  });

  it('a request that throws is recorded as failed, and the error is not swallowed', async () => {
    const op = await operatorPerson(h.db);
    const owner = await person(h.db, 'owner');
    as(op);
    h.answer = 'throw';
    await expect(resend(owner.accountId, { userId: owner.id, reason: 'x' })).rejects.toThrow(
      /network/,
    );
    expect((await recordLines(h.db)).at(-1)?.outcome).toBe('failed');
  });

  it('refuses a missing reason, and records and sends nothing', async () => {
    const op = await operatorPerson(h.db);
    const owner = await person(h.db, 'owner');
    as(op);
    const before = (await recordLines(h.db)).length;
    const res = await resend(owner.accountId, { userId: owner.id });
    expect(res.headers.get('location')).toBe(
      `/internal/accounts/${owner.accountId}?done=reason_invalid`,
    );
    expect((await recordLines(h.db)).length).toBe(before);
    expect(h.rate).not.toHaveBeenCalled();
  });

  it('no line the console writes holds an address', async () => {
    const lines = await recordLines(h.db);
    expect(lines.length).toBeGreaterThan(0);
    for (const l of lines) for (const v of Object.values(l)) expect(String(v)).not.toContain('@');
  });
});
