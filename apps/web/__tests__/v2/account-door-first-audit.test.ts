/**
 * The first audit of a site named on Sign-up (CC-22b D7) against every applied migration in PGlite:
 * the first-login hook with the first-audit requester door-deps.ts gives it, over the pipeline's SQL
 * store.
 */
import type { PGlite } from '@electric-sql/pglite';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { afterSignIn } from '../../lib/auth/landing';
import { emailBinding } from '../../lib/auth/continue-intent';
import type { FirstAudit } from '../../lib/auth/door-store';
import { runFirstLogin, type FirstLoginDeps } from '../../lib/auth/first-login';
import { firstAuditId, firstAuditRequester } from '../../lib/v2/pipeline/first-audit';
import { sqlKeepStore } from '../../lib/v2/pipeline/test-support/sql-keep-store';
import { sqlPipelineStore } from '../../lib/v2/pipeline/test-support/sql-store';
import { asService } from '../../lib/v2/pipeline/test-support/stored-check';
import { doorDb, pgliteDoorStore, pgliteEntitlementStore, signUp } from './_lib/door-pglite';

const NOW = new Date('2026-11-05T12:00:00.000Z');
const CONFIRMED = {
  emailConfirmedAt: '2026-11-05T11:59:58.000Z',
  lastSignInAt: '2026-11-05T11:59:58.120Z',
};

let db: PGlite;
beforeEach(async () => {
  db = await doorDb();
}, 60_000);
afterEach(async () => {
  await db?.close();
});

function requester(allowed: (key: string) => boolean = () => true) {
  const sent: { id: string; data: Record<string, unknown> }[] = [];
  const firstAudit = firstAuditRequester({
    request: {
      store: sqlPipelineStore(db),
      send: async (event) => void sent.push(event),
      now: () => NOW.getTime(),
    },
    hasLiveOrGradedCheck: (siteId) => sqlKeepStore(asService(db)).hasLiveOrGradedCheck(siteId),
    limit: async (key) => ({ allowed: allowed(key) }),
    paused: () => false,
  });
  return { firstAudit, sent };
}

function deps(firstAudit: FirstAudit | undefined) {
  const report = vi.fn();
  const d: FirstLoginDeps = {
    store: pgliteDoorStore(db),
    entitlement: pgliteEntitlementStore(db),
    admit: async () => true,
    report,
    pepper: 'k'.repeat(40),
    now: () => NOW,
    dispatch: async () => {},
    firstAudit,
  };
  return { d, report };
}

const inputOf = (userId: string, email: string, site: string) => ({
  userId,
  email,
  ...CONFIRMED,
  device: `dev-${email}`,
  ip: '203.0.113.7',
  signup: { site },
});

const checks = async () =>
  (
    await db.query<{ id: string; site_id: string; status: string; trigger: string }>(
      `select id, site_id, status, trigger from public.checks order by id`,
    )
  ).rows;

describe('a site named on Sign-up gets its first audit', () => {
  it('one queued first_audit check of the attached site, and one event, asked for by the user', async () => {
    const user = await signUp(db, 'named@example.com');
    const { firstAudit, sent } = requester();
    const r = await runFirstLogin(
      deps(firstAudit).d,
      inputOf(user, 'named@example.com', 'Named.example'),
    );
    expect(r.siteId).not.toBeNull();
    expect(await checks()).toEqual([
      { id: firstAuditId(r.siteId!), site_id: r.siteId, status: 'queued', trigger: 'first_audit' },
    ]);
    expect(sent).toHaveLength(1);
    expect(sent[0]!.data).toMatchObject({
      siteId: r.siteId,
      host: 'named.example',
      requestedByUserId: user,
    });
  });

  it('signing in again with the same form starts no second check', async () => {
    const user = await signUp(db, 'again@example.com');
    const { firstAudit, sent } = requester();
    const i = inputOf(user, 'again@example.com', 'again.example');
    await runFirstLogin(deps(firstAudit).d, i);
    const second = await runFirstLogin(deps(firstAudit).d, i);
    expect(second.siteId).toBeNull();
    expect(await checks()).toHaveLength(1);
    expect(sent).toHaveLength(1);
  });

  it('without a first-audit requester (V2_CHECKS_PUBLIC unset) the site is attached and no check is written', async () => {
    const user = await signUp(db, 'flagoff@example.com');
    const r = await runFirstLogin(
      deps(undefined).d,
      inputOf(user, 'flagoff@example.com', 'flagoff.example'),
    );
    expect(r.siteId).not.toBeNull();
    expect(r.events.map((e) => e.name)).toEqual(['trial_started', 'site_added']);
    expect(await checks()).toEqual([]);
  });

  it('no site attached (the SSRF guard refused it): no first audit', async () => {
    const user = await signUp(db, 'refused@example.com');
    const firstAudit = vi.fn<FirstAudit>(async () => 'requested');
    const { d } = deps(firstAudit);
    const r = await runFirstLogin(
      { ...d, admit: async () => false },
      inputOf(user, 'refused@example.com', 'internal.example'),
    );
    expect(r.siteId).toBeNull();
    expect(firstAudit).not.toHaveBeenCalled();
  });

  it('at the daily ceiling the site stays attached and no check starts', async () => {
    const user = await signUp(db, 'ceiling@example.com');
    const { firstAudit, sent } = requester((key) => key !== 'global:audits:day');
    const r = await runFirstLogin(
      deps(firstAudit).d,
      inputOf(user, 'ceiling@example.com', 'ceiling.example'),
    );
    expect(r.siteId).not.toBeNull();
    expect(r.events.map((e) => e.name)).toEqual(['trial_started', 'site_added']);
    expect(await checks()).toEqual([]);
    expect(sent).toEqual([]);
  });

  it('a first audit that throws is reported, and the sign-in keeps its trial and its site', async () => {
    const user = await signUp(db, 'throws@example.com');
    const { d, report } = deps(async () => {
      throw new Error('inngest unavailable');
    });
    const landing = await afterSignIn(
      { firstLogin: d, claim: { store: d.store, now: d.now }, report },
      {
        user: {
          id: user,
          email: 'throws@example.com',
          email_confirmed_at: CONFIRMED.emailConfirmedAt,
          last_sign_in_at: CONFIRMED.lastSignInAt,
        },
        next: undefined,
        boundTo: emailBinding('throws@example.com'),
        signup: { site: 'throws.example' },
        device: 'dev-throws',
        ip: '203.0.113.7',
      },
    );
    expect(landing.events.map((e) => e.name)).toEqual(['trial_started', 'site_added']);
    const calls = report.mock.calls.map((c) => c[0]);
    expect(calls).toEqual(['first-audit-failed']);
    expect(report.mock.calls[0]![1]).toMatchObject({ siteId: expect.any(String) });
  });
});
