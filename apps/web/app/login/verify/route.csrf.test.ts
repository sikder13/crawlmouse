import type { PGlite } from '@electric-sql/pglite';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// CC-06c D9, end to end: an attacker's sign-in link opened in the victim's browser. The real route,
// the real landing and first-login hook, and PGlite with every migration applied. Stand-ins: Supabase
// Auth (the verified user), the anonymous-session cookie, Sentry, the door's dependencies (the PGlite
// stores of __tests__/v2/_lib in place of the supabase-js ones, a no-op reporter) and the admin
// client, whose one query here, the v1 claim, runs as the same SQL against the same database.

const h = vi.hoisted(() => ({
  db: null as PGlite | null,
  user: null as Record<string, unknown> | null,
  anonId: null as string | null,
  clearAnonSession: (() => {}) as () => void,
  // The clock every dependency reads: injected, never the real one.
  now: new Date('2026-11-14T12:00:00.000Z'),
}));

vi.mock('server-only', () => ({}));
vi.mock('@/lib/supabase/server', () => ({
  supabaseServer: async () => ({
    auth: {
      verifyOtp: async () => ({ data: { user: h.user }, error: null }),
      exchangeCodeForSession: async () => ({ data: { user: h.user }, error: null }),
      getUser: async () => ({ data: { user: h.user } }),
    },
  }),
}));
// The one admin query the route makes: the v1 claim, update audits ... where eq and is null.
vi.mock('@/lib/supabase/admin', () => ({
  supabaseAdmin: () => ({
    from: (table: string) => {
      if (table !== 'audits') throw new Error(`unexpected table ${table}`);
      return {
        update: (v: { user_id: string }) => ({
          eq: (col: string, val: string) => ({
            is: async (isCol: string, isVal: null) => {
              if (col !== 'anonymous_session_id' || isCol !== 'user_id' || isVal !== null)
                throw new Error('unexpected claim query');
              await h.db!.query(
                `update public.audits set user_id = $1 where anonymous_session_id = $2 and user_id is null`,
                [v.user_id, val],
              );
              return { error: null };
            },
          }),
        }),
      };
    },
  }),
}));
vi.mock('@/lib/anon-session', () => ({
  readAnonSessionId: async () => h.anonId,
  clearAnonSession: async () => h.clearAnonSession(),
}));
vi.mock('@sentry/nextjs', () => ({ captureMessage: () => {} }));
vi.mock('@/lib/auth/door-deps', async () => {
  const pg = await import('../../../__tests__/v2/_lib/door-pglite');
  return {
    doorDeps: () => ({
      firstLogin: {
        store: pg.pgliteDoorStore(h.db!),
        entitlement: pg.pgliteEntitlementStore(h.db!),
        admit: async () => true,
        report: () => {},
        pepper: 'k'.repeat(40),
        now: () => h.now,
      },
      claim: { store: pg.pgliteDoorStore(h.db!), now: () => h.now },
    }),
  };
});

import { POST } from './route';
import { claimNext, emailBinding } from '../../../lib/auth/continue-intent';
import { hashLedgerValue } from '../../../lib/auth/ledger';
import {
  accountOf,
  anonymousCheck,
  count,
  doorDb,
  signUp,
} from '../../../__tests__/v2/_lib/door-pglite';

// Addresses built from parts, as the brief asks of sample data.
const ATTACKER = ['attacker', 'example.net'].join('@');
const VICTIM = ['victim', 'example.com'].join('@');

const ORIGIN = 'https://crawlmouse.com';
const PEPPER = 'k'.repeat(40);
const VICTIM_DEVICE = 'victim-browser-device';
const VICTIM_ANON = 'victim-anon-session';

let auditId: string;
let attackerId: string;
const cleared = vi.fn();

beforeEach(async () => {
  h.db = await doorDb();
  process.env.V2_ACCOUNT_DOOR = '1';
  attackerId = await signUp(h.db, ATTACKER);
  const now = h.now.toISOString();
  h.user = {
    id: attackerId,
    email: ATTACKER,
    email_confirmed_at: now,
    last_sign_in_at: now,
  };
  h.anonId = VICTIM_ANON;
  cleared.mockClear();
  h.clearAnonSession = cleared;
  const { rows } = await h.db.query<{ id: string }>(
    `insert into public.audits (anonymous_session_id, url) values ($1, 'https://victim.example') returning id`,
    [VICTIM_ANON],
  );
  auditId = rows[0]!.id;
}, 120_000);

afterEach(async () => {
  delete process.env.V2_ACCOUNT_DOOR;
  await h.db?.close();
});

/**
 * The Continue page's POST from the victim's browser, carrying the attacker's link token. `next` is
 * the browser's `post_login_next` (a Keep's claim target); `json` is the scripted Continue page.
 */
function openInVictimBrowser(boundTo: string | null, opts: { next?: string; json?: boolean } = {}) {
  const jar: Record<string, string> = {
    cm_auth_otp: JSON.stringify({ kind: 'token_hash', value: 'attacker-token', type: 'magiclink' }),
    cm_auth_device: VICTIM_DEVICE,
  };
  if (boundTo !== null) jar.cm_auth_for = boundTo;
  if (opts.next !== undefined) jar.post_login_next = opts.next;
  return POST(
    new Request(`${ORIGIN}/login/verify`, {
      method: 'POST',
      headers: {
        origin: ORIGIN,
        'x-forwarded-for': '198.51.100.20',
        ...(opts.json ? { accept: 'application/json' } : {}),
        cookie: Object.entries(jar)
          .map(([k, v]) => `${k}=${encodeURIComponent(v)}`)
          .join('; '),
      },
    }),
  );
}

const deviceRows = () =>
  count(h.db!, `select 1 from public.trial_ledger where kind = 'device' and value_hash = $1`, [
    hashLedgerValue(PEPPER, 'device', VICTIM_DEVICE),
  ]);
const auditOwner = async () =>
  (
    await h.db!.query<{ u: string | null }>(
      `select user_id as u from public.audits where id = $1`,
      [auditId],
    )
  ).rows[0]!.u;

describe("a sign-in link for another address, opened in a browser bound to the victim's (D9)", () => {
  it("records no device row for the victim's browser and claims none of its audits", async () => {
    await openInVictimBrowser(emailBinding(VICTIM));
    const account = await accountOf(h.db!, attackerId);
    // The attacker's sign-in itself goes ahead: the trial starts on the email and the network.
    expect(account.state).toBe('pro_trial');
    expect(
      await count(h.db!, `select 1 from public.trial_ledger where account_id = $1`, [account.id]),
    ).toBe(2);
    expect(await deviceRows()).toBe(0);
    expect(await auditOwner()).toBeNull();
    expect(cleared).not.toHaveBeenCalled();
  });

  // A-8: the v1 victim never asked for a link, so the browser holds no binding at all. Before, that
  // read as "nothing known" and the audit moved into the attacker's account.
  it('a browser that asked for no link claims none of its audits', async () => {
    await openInVictimBrowser(null);
    expect(await auditOwner()).toBeNull();
    expect(cleared).not.toHaveBeenCalled();
  });

  it('control: with the binding of the address the link verified, the device is recorded and the audit claimed', async () => {
    await openInVictimBrowser(emailBinding(ATTACKER));
    expect(await deviceRows()).toBe(1);
    expect(await auditOwner()).toBe(attackerId);
    expect(cleared).toHaveBeenCalledTimes(1);
  });
});

/** The victim's anonymous v2 check, which their browser's Keep asks to claim. */
async function victimKeep() {
  const later = new Date(h.now.getTime() + 24 * 60 * 60 * 1000);
  const check = await anonymousCheck(h.db!, 'victim-shop.example', later);
  return { ...check, next: claimNext(check.checkId) };
}
const siteOwner = async (siteId: string) =>
  (
    await h.db!.query<{ a: string | null; s: string | null }>(
      `select account_id as a, owner_seat_id as s from public.sites where id = $1`,
      [siteId],
    )
  ).rows[0]!;
const checkExpiry = async (checkId: string) =>
  (
    await h.db!.query<{ e: Date | null }>(
      `select expires_at as e from public.checks where id = $1`,
      [checkId],
    )
  ).rows[0]!.e;

describe("door ON: the victim's Keep and the attacker's link (CC-37 D2)", () => {
  it("does not claim the victim's v2 check and answers with the Signed-in-as state for the attacker", async () => {
    const keep = await victimKeep();
    const expiresBefore = await checkExpiry(keep.checkId);
    const res = await openInVictimBrowser(emailBinding(VICTIM), {
      next: keep.next,
      json: true,
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { next: string; email?: string };
    // The Continue page's "Signed in as <address>." reads this field (25-account-door.md, login CSRF).
    expect(body.email).toBe(ATTACKER);
    // Not a claim's landing: neither the claim target, nor a refused claim's /dashboard?claim=<code>.
    expect(body.next).toBe('/dashboard');
    expect(body.next).not.toContain('/api/checks/');
    expect(body.next).not.toContain('claim=');
    expect(await siteOwner(keep.siteId)).toEqual({ a: null, s: null });
    expect(await checkExpiry(keep.checkId)).toEqual(expiresBefore);
    // The victim's own Keep stays in their browser for the victim's own link (not cleared).
    expect(res.headers.getSetCookie().some((c) => c.startsWith('post_login_next=;'))).toBe(false);
  });

  it('control: the same Keep with the binding of the address the link verified is claimed', async () => {
    const keep = await victimKeep();
    const res = await openInVictimBrowser(emailBinding(ATTACKER), {
      next: keep.next,
      json: true,
    });
    const body = (await res.json()) as { next: string };
    expect(body.next).toBe('/dashboard');
    const account = await accountOf(h.db!, attackerId);
    expect((await siteOwner(keep.siteId)).a).toBe(account.id);
    expect(await checkExpiry(keep.checkId)).toBeNull();
  });

  it('a Keep in a browser that asked for no link is not claimed', async () => {
    const keep = await victimKeep();
    await openInVictimBrowser(null, { next: keep.next, json: true });
    expect(await siteOwner(keep.siteId)).toEqual({ a: null, s: null });
  });

  // CC-06c D9, deliberate: with no binding nothing tells this browser from the attacker's own on
  // another device, so the device is recorded for the attacker's trial. Pinned so a change is seen.
  it('with no binding at all, the first login DOES record the browser device row (CC-06c D9, deliberate)', async () => {
    await openInVictimBrowser(null);
    expect(await deviceRows()).toBe(1);
    expect(await auditOwner()).toBeNull();
  });
});

describe('door OFF (V2_ACCOUNT_DOOR unset): the same attacker link (CC-37 D2)', () => {
  beforeEach(() => {
    delete process.env.V2_ACCOUNT_DOOR;
  });

  it("a foreign binding claims none of the victim's audits", async () => {
    await openInVictimBrowser(emailBinding(VICTIM));
    expect(await auditOwner()).toBeNull();
    expect(cleared).not.toHaveBeenCalled();
    // The door is off: no first-login hook, so no account moved to a trial and no ledger row.
    expect((await accountOf(h.db!, attackerId)).state).toBe('free');
    expect(await count(h.db!, `select 1 from public.trial_ledger`)).toBe(0);
  });

  it("no binding claims none of the victim's audits", async () => {
    await openInVictimBrowser(null);
    expect(await auditOwner()).toBeNull();
    expect(cleared).not.toHaveBeenCalled();
  });

  it("the victim's Keep is not claimed and the landing is the plain dashboard", async () => {
    const keep = await victimKeep();
    const res = await openInVictimBrowser(emailBinding(VICTIM), {
      next: keep.next,
      json: true,
    });
    const body = (await res.json()) as { next: string; email?: string };
    expect(body).toMatchObject({ next: '/dashboard', email: ATTACKER });
    expect(await siteOwner(keep.siteId)).toEqual({ a: null, s: null });
  });

  it('control: with the binding of the address the link verified, the audit is claimed', async () => {
    await openInVictimBrowser(emailBinding(ATTACKER));
    expect(await auditOwner()).toBe(attackerId);
    expect(cleared).toHaveBeenCalledTimes(1);
  });
});
