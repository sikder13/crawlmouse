/**
 * The live Settings, Settings › Plan, Settings › Delete and Trial ending pages (CC-27b D6, D8). Run on
 * PGlite with every migration applied: the session client is the PostgREST stand-in as the signed-in
 * user (row security applies), the service role is the stand-in without one, and the paged reader is
 * the pipeline's PGlite reader. `erase_person_plan` is workstream B's; until it merges, a stand-in
 * answers its `accounts` key from the person's owner seats.
 */
import { randomUUID } from 'node:crypto';
import type { PGlite } from '@electric-sql/pglite';
import type { ReactElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { applyAllMigrations, freshDb } from '../../__tests__/helpers/pglite-migrations';
import { postgrestOver } from '../../__tests__/helpers/postgrest-pglite';
import { personalAccount, signUp } from '../../__tests__/helpers/v2-check-tables';
import { pgliteCheckReader } from '../../lib/v2/pipeline/test-support/pglite';

const h = vi.hoisted(() => ({
  db: null as unknown,
  user: null as { id: string; email: string } | null,
}));

vi.mock('server-only', () => ({}));
vi.mock('@/lib/supabase/server', () => ({
  supabaseServer: async () => ({
    ...postgrestOver(h.db as PGlite, h.user ? { as: { userId: h.user.id } } : {}),
    auth: { getUser: async () => ({ data: { user: h.user }, error: null }) },
  }),
}));
vi.mock('@/lib/supabase/admin', () => ({ supabaseAdmin: () => postgrestOver(h.db as PGlite) }));
vi.mock('@/lib/v2/pipeline/load', () => ({
  supabaseCheckReader: () => pgliteCheckReader(h.db as PGlite),
}));

import { DeleteScreen } from '@/components/v2/screens/settings/DeleteScreen';
import { PlanScreen } from '@/components/v2/screens/settings/PlanScreen';
import { SettingsScreen } from '@/components/v2/screens/settings/SettingsScreen';
import { TrialEndedScreen, TrialEndScreen } from '@/components/v2/screens/trial-end/TrialEndScreen';
import DeletePage from './delete/page';
import SettingsPage from './page';
import PlanPage from './plan/page';
import TrialEndedPage from '../trial-ended/page';

interface Person {
  id: string;
  email: string;
  accountId: string;
}

let owner: Person; // a Free account with one site
let empty: Person; // a Free account with no site
let trialing: Person; // a no-card Pro trial with one site
let ended: Person; // back on Free after a Pro trial, one site
let manager: { id: string; email: string };
let developer: { id: string; email: string };

async function person(tag: string): Promise<Person> {
  const db = h.db as PGlite;
  const email = `${tag}-${randomUUID().slice(0, 8)}@example.com`;
  const id = await signUp(db, email);
  const { accountId } = await personalAccount(db, id);
  return { id, email, accountId };
}

async function seat(accountId: string, role: 'account_manager' | 'developer') {
  const db = h.db as PGlite;
  const email = `${role}-${randomUUID().slice(0, 8)}@example.com`;
  const id = await signUp(db, email);
  // Their own personal account is not the default, so the viewer acts in this one.
  await db.query(
    `insert into public.seats (account_id, user_id, invited_email, role, status, accepted_at)
     values ($1, $2, $3, $4, 'active', now())`,
    [accountId, id, email, role],
  );
  await db.query(`update public.users set default_account_id = $1 where id = $2`, [accountId, id]);
  return { id, email };
}

const host = (p: Person, name: string) =>
  (h.db as PGlite).query(
    `insert into public.sites (account_id, host, created_at) values ($1, $2, now() - interval '30 days')`,
    [p.accountId, name],
  );

beforeAll(async () => {
  const db = await freshDb();
  await applyAllMigrations(db);
  h.db = db;
  const { rows } = await db.query<{ n: number }>(
    `select count(*)::int n from pg_proc where proname = 'erase_person_plan'`,
  );
  if (rows[0]!.n === 0) {
    await db.exec(`
      create function public.erase_person_plan(p_user uuid, p_email text) returns json
      language sql stable as $$
        select json_build_object('accounts', coalesce(json_agg(s.account_id::text order by s.account_id::text), '[]'::json))
          from public.seats s where s.user_id = p_user and s.role = 'owner' and s.status = 'active'
      $$;`);
  }
  owner = await person('owner');
  await host(owner, 'owner-site.example');
  empty = await person('empty');
  trialing = await person('trial');
  await host(trialing, 'trial-site.example');
  await db.query(
    `update public.accounts
        set state = 'pro_trial', tier = 'pro', trial_variant = 'no_card',
            trial_ends_at = now() + interval '5 days', trial_used_at = now(),
            state_history = state_history || jsonb_build_array(jsonb_build_object('state', 'pro_trial',
              'since', (state_history->0->>'since')::timestamptz + interval '1 millisecond'))
      where id = $1`,
    [trialing.accountId],
  );
  ended = await person('ended');
  await host(ended, 'ended-site.example');
  await db.query(
    `update public.accounts
        set trial_used_at = now(),
            state_history = state_history || jsonb_build_array(
              jsonb_build_object('state', 'pro_trial',
                'since', (state_history->0->>'since')::timestamptz + interval '1 millisecond'),
              jsonb_build_object('state', 'free',
                'since', (state_history->0->>'since')::timestamptz + interval '2 milliseconds'))
      where id = $1`,
    [ended.accountId],
  );
  manager = await seat(owner.accountId, 'account_manager');
  developer = await seat(owner.accountId, 'developer');
}, 300_000);

afterEach(() => vi.unstubAllEnvs());

const as = (u: { id: string; email: string } | null) => {
  h.user = u === null ? null : { id: u.id, email: u.email };
  vi.stubEnv('V2_CHECKS_PUBLIC', '1');
};
const notFoundError = { digest: expect.stringMatching(/404/) };
const redirectTo = (path: string) => ({ digest: expect.stringContaining(`;${path};`) });
const screen = (el: unknown) => (el as ReactElement<{ children: ReactElement }>).props.children;

const PAGES = [
  ['/settings', SettingsPage],
  ['/settings/plan', PlanPage],
  ['/settings/delete', DeletePage],
  ['/trial-ended', TrialEndedPage],
] as const;

describe('with V2_CHECKS_PUBLIC off', () => {
  it.each(PAGES)('%s is a 404, even for the owner', async (_path, Page) => {
    h.user = { id: owner.id, email: owner.email };
    vi.stubEnv('V2_CHECKS_PUBLIC', '');
    await expect(Page()).rejects.toMatchObject(notFoundError);
  });
});

describe('signed out', () => {
  it.each(PAGES)('%s sends the caller to sign in', async (_path, Page) => {
    as(null);
    await expect(Page()).rejects.toMatchObject(redirectTo('/login'));
  });
});

describe('/settings', () => {
  it('renders Settings for the owner and for an account manager, from the account’s records', async () => {
    for (const u of [owner, manager]) {
      as(u);
      const el = screen(await SettingsPage());
      expect(el.type).toBe(SettingsScreen);
      const html = renderToStaticMarkup(el);
      expect(html).toContain(owner.email);
      expect(html).toContain('action="/api/account"');
    }
  });

  it('is a 404 for a developer', async () => {
    as(developer);
    await expect(SettingsPage()).rejects.toMatchObject(notFoundError);
  });
});

describe('/settings/plan', () => {
  it('answers for an account that holds no site', async () => {
    as(empty);
    const el = screen(await PlanPage());
    expect(el.type).toBe(PlanScreen);
    expect(renderToStaticMarkup(el)).toContain('0 of 1');
  });

  it('is a 404 for an account manager and a developer', async () => {
    for (const u of [manager, developer]) {
      as(u);
      await expect(PlanPage()).rejects.toMatchObject(notFoundError);
    }
  });
});

describe('/settings/delete', () => {
  it('renders the step for the owner, with the hostname to type and the account it removes', async () => {
    as(owner);
    const el = screen(await DeletePage());
    expect(el.type).toBe(DeleteScreen);
    const html = renderToStaticMarkup(el);
    expect(html).toContain('Type owner-site.example to confirm');
    expect(html).toContain('Deleting removes 1 account you alone hold: owner-site.example.');
  });

  it('an account with no site is retyped by its sign-in address', async () => {
    as(empty);
    const html = renderToStaticMarkup(screen(await DeletePage()));
    expect(html).toContain(`Type ${empty.email} to confirm`);
  });

  it('is a 404 for an account manager and a developer', async () => {
    for (const u of [manager, developer]) {
      as(u);
      await expect(DeletePage()).rejects.toMatchObject(notFoundError);
    }
  });
});

describe('/trial-ended', () => {
  it('a trial still running: the before state', async () => {
    as(trialing);
    const el = screen(await TrialEndedPage());
    expect(el.type).toBe(TrialEndScreen);
    expect(renderToStaticMarkup(el)).toContain('of Pro left');
  });

  it('after the trial: back on Free', async () => {
    as(ended);
    const el = screen(await TrialEndedPage());
    expect(el.type).toBe(TrialEndedScreen);
    expect(renderToStaticMarkup(el)).toContain('Back on Free: the Pro trial ended');
  });

  it('an account with no trial is sent to the plan card, a non-owner to the dashboard', async () => {
    as(owner);
    await expect(TrialEndedPage()).rejects.toMatchObject(redirectTo('/settings/plan'));
    as(manager);
    await expect(TrialEndedPage()).rejects.toMatchObject(redirectTo('/dashboard'));
  });
});
