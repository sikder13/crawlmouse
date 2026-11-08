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
        now: () => new Date(),
      },
      claim: { store: pg.pgliteDoorStore(h.db!), now: () => new Date() },
    }),
  };
});

import { POST } from './route';
import { emailBinding } from '../../../lib/auth/continue-intent';
import { hashLedgerValue } from '../../../lib/auth/ledger';
import { accountOf, count, doorDb, signUp } from '../../../__tests__/v2/_lib/door-pglite';

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
  attackerId = await signUp(h.db, 'attacker@example.net');
  const now = new Date().toISOString();
  h.user = {
    id: attackerId,
    email: 'attacker@example.net',
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

/** The Continue page's POST from the victim's browser, carrying the attacker's link token. */
function openInVictimBrowser(boundTo: string) {
  const jar: Record<string, string> = {
    cm_auth_otp: JSON.stringify({ kind: 'token_hash', value: 'attacker-token', type: 'magiclink' }),
    cm_auth_for: boundTo,
    cm_auth_device: VICTIM_DEVICE,
  };
  return POST(
    new Request(`${ORIGIN}/login/verify`, {
      method: 'POST',
      headers: {
        origin: ORIGIN,
        'x-forwarded-for': '198.51.100.20',
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
    await openInVictimBrowser(emailBinding('victim@example.com'));
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

  it('control: with the binding of the address the link verified, the device is recorded and the audit claimed', async () => {
    await openInVictimBrowser(emailBinding('attacker@example.net'));
    expect(await deviceRows()).toBe(1);
    expect(await auditOwner()).toBe(attackerId);
    expect(cleared).toHaveBeenCalledTimes(1);
  });
});
