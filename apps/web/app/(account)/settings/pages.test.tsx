/**
 * The live Settings, Settings › Plan, Settings › Delete and Trial ending pages (CC-27b D6, D8). Run on
 * PGlite with every migration applied: the session client is the PostgREST stand-in as the signed-in
 * user (row security applies), the service role is the stand-in without one, and the paged reader is
 * the pipeline's PGlite reader. The delete step reads the erasure's own `erase_person_plan`.
 */
import { randomUUID } from 'node:crypto';
import type { PGlite } from '@electric-sql/pglite';
import type { ReactElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { applyAllMigrations, freshDb } from '../../../__tests__/helpers/pglite-migrations';
import { postgrestOver } from '../../../__tests__/helpers/postgrest-pglite';
import { personalAccount, signUp } from '../../../__tests__/helpers/v2-check-tables';
import { pgliteCheckReader } from '../../../lib/v2/pipeline/test-support/pglite';

const h = vi.hoisted(() => ({
  db: null as unknown,
  user: null as { id: string; email: string } | null,
  /** The switcher cookie's value on this request, or null for none. */
  chosen: null as string | null,
}));

vi.mock('server-only', () => ({}));
// No switcher cookie unless a test sets one: each person acts in their default account.
vi.mock('next/headers', () => ({
  cookies: async () => ({
    get: (name: string) =>
      name === 'cm_account' && h.chosen !== null ? { name, value: h.chosen } : undefined,
  }),
}));
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

import { DELETE_COPY, REFUND_POLICY } from '@/lib/v2/copy/deletion';
import { SETTINGS_COPY } from '@/lib/v2/copy/settings';
import { hashMailAddress } from '@/lib/v2/mail/address-hash';
import {
  OWN_ACCOUNT_COPY,
  REFUSAL_SENTENCES,
  SETTINGS_NOTICES,
} from '@/lib/v2/copy/settings-notices';
import { agencyAccount } from '@/lib/v2/agency/test-support';
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
let shared: Person; // a no-card Pro trial with a manager seated on it
let sharedManager: { id: string; email: string };
let pastDue: Person; // Pro with its last payment failed
let cancelling: Person; // a Pro trial with a card, its subscription set to cancel at the trial's end
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
  cancelling = await person('cancelling');
  await host(cancelling, 'cancelling-site.example');
  await db.query(
    `insert into public.subscriptions (id, account_id, status, plan, interval, current_period_end, trial_end,
                                       cancel_at_period_end)
     values ('sub_cancelling_trial', $1, 'trialing', 'pro', 'month', now() + interval '5 days',
             now() + interval '5 days', true)`,
    [cancelling.accountId],
  );
  await db.query(
    `update public.accounts
        set state = 'pro_trial', tier = 'pro', trial_variant = 'card_required', card_last4 = '4242',
            current_subscription_id = 'sub_cancelling_trial',
            trial_ends_at = now() + interval '5 days', trial_used_at = now(),
            state_history = state_history || jsonb_build_array(jsonb_build_object('state', 'pro_trial',
              'since', (state_history->0->>'since')::timestamptz + interval '1 millisecond'))
      where id = $1`,
    [cancelling.accountId],
  );
  shared = await person('shared');
  await host(shared, 'shared-site.example');
  await db.query(
    `update public.accounts
        set state = 'pro_trial', tier = 'pro', trial_variant = 'no_card',
            trial_ends_at = now() + interval '5 days', trial_used_at = now(),
            state_history = state_history || jsonb_build_array(jsonb_build_object('state', 'pro_trial',
              'since', (state_history->0->>'since')::timestamptz + interval '1 millisecond'))
      where id = $1`,
    [shared.accountId],
  );
  sharedManager = await seat(shared.accountId, 'account_manager');
  pastDue = await person('past-due');
  await host(pastDue, 'past-due-site.example');
  await db.query(
    `insert into public.subscriptions (id, account_id, status, plan, interval, current_period_end)
     values ('sub_past_due', $1, 'past_due', 'pro', 'month', now() + interval '20 days')`,
    [pastDue.accountId],
  );
  await db.query(
    `update public.accounts
        set state = 'past_due', tier = 'pro', past_due_tier = 'pro', past_due_since = now(),
            current_subscription_id = 'sub_past_due',
            state_history = state_history || jsonb_build_array(
              jsonb_build_object('state', 'pro',
                'since', (state_history->0->>'since')::timestamptz + interval '1 millisecond'),
              jsonb_build_object('state', 'past_due',
                'since', (state_history->0->>'since')::timestamptz + interval '2 milliseconds'))
      where id = $1`,
    [pastDue.accountId],
  );
  manager = await seat(owner.accountId, 'account_manager');
  developer = await seat(owner.accountId, 'developer');
}, 300_000);
afterAll(async () => {
  await (h.db as PGlite).close();
});

afterEach(() => {
  vi.unstubAllEnvs();
  h.chosen = null;
});

const as = (u: { id: string; email: string } | null) => {
  h.user = u === null ? null : { id: u.id, email: u.email };
  vi.stubEnv('V2_CHECKS_PUBLIC', '1');
};
const notFoundError = { digest: expect.stringMatching(/404/) };
const redirectTo = (path: string) => ({ digest: expect.stringContaining(`;${path};`) });
/** A page's query, as Next hands it over. */
const q = (query: Record<string, string> = {}) => ({ searchParams: Promise.resolve(query) });
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
    await expect((Page as (p: unknown) => Promise<unknown>)(q())).rejects.toMatchObject(
      notFoundError,
    );
  });
});

describe('signed out', () => {
  it.each(PAGES)('%s sends the caller to sign in', async (_path, Page) => {
    as(null);
    await expect((Page as (p: unknown) => Promise<unknown>)(q())).rejects.toMatchObject(
      redirectTo('/login'),
    );
  });
});

describe('/settings', () => {
  it('renders Settings for the owner and for an account manager, from the account’s records', async () => {
    for (const u of [owner, manager]) {
      as(u);
      const el = screen(await SettingsPage(q()));
      expect(el.type).toBe(SettingsScreen);
      const html = renderToStaticMarkup(el);
      expect(html).toContain(owner.email);
      expect(html).toContain('action="/api/account"');
    }
  });

  it('offers the owner Delete… and the address to change, and a manager neither', async () => {
    as(owner);
    const mine = renderToStaticMarkup(screen(await SettingsPage(q())));
    expect(mine).toContain('href="/settings/delete"');
    expect(mine).not.toMatch(
      /<input[^>]*name="newEmail"[^>]*readOnly|<input[^>]*readonly[^>]*name="newEmail"/i,
    );
    as(manager);
    const theirs = renderToStaticMarkup(screen(await SettingsPage(q())));
    expect(theirs).not.toContain('href="/settings/delete"');
    expect(theirs).toMatch(/<input(?=[^>]*name="newEmail")(?=[^>]*readonly)[^>]*>/i);
  });

  it('says what the form did: saved, the link sent, or why it was refused', async () => {
    as(owner);
    const text = async (query: Record<string, string>) =>
      renderToStaticMarkup(screen(await SettingsPage(q(query))));
    expect(await text({ saved: '1' })).toContain(SETTINGS_NOTICES.saved);
    expect(await text({ email: 'sent' })).toContain(SETTINGS_NOTICES.emailSent);
    expect(await text({ error: 'deletion_pending' })).toContain(
      renderToStaticMarkup(<>{REFUSAL_SENTENCES.deletion_pending}</>),
    );
    expect(await text({ error: 'nonsense' })).toContain(SETTINGS_NOTICES.unknown);
    expect(await text({})).not.toContain(SETTINGS_NOTICES.saved);
  });

  it('is a 404 for a developer', async () => {
    as(developer);
    await expect(SettingsPage(q())).rejects.toMatchObject(notFoundError);
  });

  it('says when mail to the reader’s own address is suppressed, and names that address (CC-28 D7)', async () => {
    const PEPPER = 'a-settings-test-pepper-of-32-chars-';
    await (h.db as PGlite).query(
      `insert into public.email_suppressions (address_hash, reason, first_at, last_at)
       values ($1, 'complaint', now(), now())`,
      [hashMailAddress(PEPPER, manager.email)],
    );
    const text = async (u: { id: string; email: string }) => {
      as(u);
      vi.stubEnv('TRIAL_LEDGER_PEPPER', PEPPER);
      return renderToStaticMarkup(screen(await SettingsPage(q())));
    };
    const line = renderToStaticMarkup(
      <>{SETTINGS_COPY.undeliverable(manager.email, 'complaint')}</>,
    );
    expect(await text(manager)).toContain(line);
    // The owner's own address is not suppressed: no line on their page, though they share the account.
    expect(await text(owner)).not.toContain('reported as spam');
    // With no pepper the hash cannot be made: nothing is said either way.
    as(manager);
    vi.stubEnv('TRIAL_LEDGER_PEPPER', '');
    expect(renderToStaticMarkup(screen(await SettingsPage(q())))).not.toContain(line);
  });
});

describe('/settings of an account that is not the caller’s own personal account (CC-31 D2b)', () => {
  let boss: Person;
  let agencyId: string;

  beforeAll(async () => {
    boss = await person('agency-owner');
    agencyId = (await agencyAccount(h.db as PGlite, boss, 'Summit Digital')).accountId;
  });

  const NEW_EMAIL = /<input(?=[^>]*name="newEmail")[^>]*>/i;
  const settings = async () => renderToStaticMarkup(screen(await SettingsPage(q())));

  it('acting in their own account: the address can be changed and Delete… is offered, as before', async () => {
    as(boss);
    const html = await settings();
    expect(html.match(NEW_EMAIL)![0]).not.toMatch(/readonly/i);
    expect(html).toContain('href="/settings/delete"');
    expect(html).not.toContain(OWN_ACCOUNT_COPY.address);
    expect(html).not.toContain(OWN_ACCOUNT_COPY.deletion);
  });

  it('acting in their agency: the address change is not offered, and the page says where it belongs', async () => {
    as(boss);
    h.chosen = agencyId;
    const html = await settings();
    expect(html.match(NEW_EMAIL)![0]).toMatch(/readonly/i);
    expect(html).toContain(OWN_ACCOUNT_COPY.address);
    // The rest of the form is the agency's own: its name is saved to the account acted in.
    expect(html).toContain('action="/api/account"');
  });

  it('acting in their agency: Delete… is not offered; the page says where it belongs and offers the switch', async () => {
    as(boss);
    h.chosen = agencyId;
    const html = await settings();
    expect(html).not.toContain('href="/settings/delete"');
    expect(html).toContain(OWN_ACCOUNT_COPY.deletion);
    const main = html.slice(html.indexOf('<main'));
    const form = main.match(/<form [^>]*action="\/api\/seats\/switch"[\s\S]*?<\/form>/)![0];
    expect(form).toContain(`name="accountId" value="${boss.accountId}"`);
    expect(form).toContain(OWN_ACCOUNT_COPY.switchTo);
  });

  it('acting in their agency: the delete step sends them to Settings', async () => {
    as(boss);
    h.chosen = agencyId;
    await expect(DeletePage(q())).rejects.toMatchObject(redirectTo('/settings'));
    h.chosen = null;
    expect(screen(await DeletePage(q())).type).toBe(DeleteScreen);
  });

  it('the rail has the switcher, naming the account acted in', async () => {
    as(boss);
    h.chosen = agencyId;
    expect(await settings()).toMatch(/data-v2-account-switcher=""[\s\S]*?Summit Digital/);
    as(owner);
    h.chosen = null;
    expect(await settings()).not.toContain('data-v2-account-switcher');
  });
});

describe('/settings/plan', () => {
  it('answers for an account that holds no site', async () => {
    as(empty);
    const el = screen(await PlanPage());
    expect(el.type).toBe(PlanScreen);
    expect(renderToStaticMarkup(el)).toContain('0 of 1');
  });

  it('the plan page is a 404 for an account manager and a developer', async () => {
    for (const u of [manager, developer]) {
      as(u);
      await expect(PlanPage()).rejects.toMatchObject(notFoundError);
    }
  });
});

describe('/settings/delete', () => {
  it('renders the step for an owner alone on the account, with the hostname and the account it removes', async () => {
    as(trialing);
    const el = screen(await DeletePage(q()));
    expect(el.type).toBe(DeleteScreen);
    const html = renderToStaticMarkup(el);
    expect(html).toContain('Type trial-site.example to confirm');
    expect(html).toContain('Deleting removes 1 account you alone hold: trial-site.example.');
  });

  it('an account others sit on: the step names no account, says why, and offers no form', async () => {
    as(owner);
    const html = renderToStaticMarkup(screen(await DeletePage(q())));
    expect(html).not.toContain('Deleting removes');
    expect(html).toContain(renderToStaticMarkup(<>{REFUSAL_SENTENCES.others_seated}</>));
    expect(html).not.toContain('action="/api/account"');
  });

  it('says the link was sent, and shows a refusal the route sent back', async () => {
    as(trialing);
    const sent = renderToStaticMarkup(screen(await DeletePage(q({ sent: '1' }))));
    expect(sent).toContain(SETTINGS_NOTICES.deleteSent);
    const refused = renderToStaticMarkup(
      screen(await DeletePage(q({ error: 'hostname_mismatch' }))),
    );
    expect(refused).toContain(REFUSAL_SENTENCES.hostname_mismatch);
  });

  it('an account with no site is retyped by its sign-in address', async () => {
    as(empty);
    const html = renderToStaticMarkup(screen(await DeletePage(q())));
    expect(html).toContain(`Type ${empty.email} to confirm`);
  });

  it('the delete page is a 404 for an account manager and a developer', async () => {
    for (const u of [manager, developer]) {
      as(u);
      await expect(DeletePage(q())).rejects.toMatchObject(notFoundError);
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

  it('seeds the account’s default alert rules before it reads them, so alerts by email read as on (Q13)', async () => {
    const db = h.db as PGlite;
    await db.query(`delete from public.alert_rules where account_id = $1`, [ended.accountId]);
    as(ended);
    const html = renderToStaticMarkup(screen(await TrialEndedPage()));
    const { rows } = await db.query<{ n: number }>(
      `select count(*)::int n from public.alert_rules where account_id = $1 and site_id is null`,
      [ended.accountId],
    );
    expect(rows[0]!.n).toBe(6);
    // "What stays": email alerts are listed only while an enabled rule sends by email.
    expect(html).toContain('still sent by email');
  });

  it('an account with no trial is sent to the plan card, a non-owner to the dashboard', async () => {
    as(owner);
    await expect(TrialEndedPage()).rejects.toMatchObject(redirectTo('/settings/plan'));
    as(manager);
    await expect(TrialEndedPage()).rejects.toMatchObject(redirectTo('/dashboard'));
  });
});

describe('a trial with a card whose subscription is set to cancel at its end', () => {
  const CHARGE = /charged (then|on)|unless you cancel|Cancel before/;

  it('/settings says the card is not charged, and offers no cancel', async () => {
    as(cancelling);
    const html = renderToStaticMarkup(screen(await SettingsPage(q())));
    expect(html).toContain('The card ending 4242 is not charged.');
    expect(html).not.toMatch(CHARGE);
    expect(html).not.toContain('action="/api/billing/cancel"');
  });

  it('/trial-ended says the trial is cancelled and the card not charged', async () => {
    as(cancelling);
    const html = renderToStaticMarkup(screen(await TrialEndedPage()));
    expect(html).toContain('The trial is cancelled: it ends on');
    expect(html).not.toMatch(CHARGE);
    expect(html).not.toContain('href="/settings/plan"');
  });
});

describe('/trial-ended for a seat that is not the owner’s', () => {
  it('offers the owner the checkout, and the manager neither it nor a link to Settings › Plan', async () => {
    as(shared);
    expect(renderToStaticMarkup(screen(await TrialEndedPage()))).toContain(
      'action="/api/billing/checkout"',
    );
    as(sharedManager);
    const html = renderToStaticMarkup(screen(await TrialEndedPage()));
    expect(html).toContain('of Pro left');
    expect(html).not.toContain('action="/api/billing/checkout"');
    expect(html).not.toContain('href="/settings/plan"');
  });
});

describe('the money on the delete step, by the subscription’s state (fix round 2, item 5)', () => {
  const html = async (p: Person) => {
    as(p);
    return renderToStaticMarkup(screen(await DeletePage(q())));
  };
  const text = (t: string) => renderToStaticMarkup(<>{t}</>);

  it('a plan whose payment failed: cancelled when the account is erased, not set to end', async () => {
    const page = await html(pastDue);
    expect(page).toContain(text(DELETE_COPY.moneyNotCollected));
    expect(page).not.toContain(text(DELETE_COPY.moneyEnds));
    expect(page).toContain(text(REFUND_POLICY));
  });

  it('/settings says the same in its danger zone for a plan whose payments are overdue', async () => {
    as(pastDue);
    const page = renderToStaticMarkup(screen(await SettingsPage(q())));
    expect(page).toContain(text(DELETE_COPY.moneyNotCollected));
    expect(page).not.toContain(text(DELETE_COPY.moneyEnds));
  });

  it('a trialing plan: set to end at the end of the period', async () => {
    const page = await html(cancelling);
    expect(page).toContain(text(DELETE_COPY.moneyEnds));
    expect(page).not.toContain(text(DELETE_COPY.moneyNotCollected));
  });

  it('no subscription: nothing about money', async () => {
    expect(await html(trialing)).not.toContain(text(REFUND_POLICY));
  });
});
