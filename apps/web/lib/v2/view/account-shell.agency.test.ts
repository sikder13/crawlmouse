/**
 * The account frame for a person with several seats and for an Agency account: the switcher, the
 * agency rail and its plan card. The rail of every other account is pinned in account-shell.test.ts.
 */
import { describe, expect, it } from 'vitest';
import {
  ACCOUNT_VIEWERS,
  DATASET,
  NORTHWIND_ACCOUNT_ID,
} from '../../../app/(v2-preview)/v2-preview/_preview/accounts';
import { AGENCY_MONTHLY, AGENCY_YEARLY } from '../../billing/prices';
import { fixture } from '../fixtures';
import { viewAt, type AccountView } from './account';
import { ACCOUNT_NAV, AGENCY_NAV } from './account-actions';
import {
  accountShellView,
  switcherView,
  withSwitcher,
  type SwitcherAccount,
} from './account-shell';

const view = (name: keyof typeof ACCOUNT_VIEWERS): AccountView =>
  viewAt(fixture(DATASET[name]), ACCOUNT_VIEWERS[name]());

const account = (n: string, kind: SwitcherAccount['kind'], name: string | null) => ({
  id: `a0000000-0000-4000-8000-0000000000${n}`,
  kind,
  name,
});
const PERSONAL = account('01', 'personal', null);
const SUMMIT = account('aa', 'agency', 'Summit');
const ATLAS = account('ab', 'agency', 'Atlas');
const UNNAMED = account('ac', 'agency', null);
const BLANK = account('ad', 'personal', '  ');

describe('switcherView', () => {
  it('is nothing for a person with one seat, and for a list that does not hold the account acted in', () => {
    expect(switcherView([], PERSONAL.id)).toBeNull();
    expect(switcherView([PERSONAL], PERSONAL.id)).toBeNull();
    expect(switcherView([SUMMIT, ATLAS], PERSONAL.id)).toBeNull();
  });

  it('names the account acted in and offers each other one as a POST to the switch', () => {
    expect(switcherView([PERSONAL, SUMMIT], SUMMIT.id)).toEqual({
      current: 'Summit',
      others: [
        {
          label: 'Personal account',
          route: '/api/seats/switch',
          href: '/api/seats/switch',
          method: 'post',
          fields: { accountId: PERSONAL.id },
          primary: false,
          context: null,
        },
      ],
      visiting: null,
    });
  });

  it('on a page of an account not acted in: names both and offers the switch to the one shown', () => {
    const s = switcherView([PERSONAL, SUMMIT, ATLAS], SUMMIT.id, PERSONAL.id)!;
    expect(s.current).toBe('Summit');
    expect(s.visiting).toEqual({
      acting: 'Personal account',
      switchTo: {
        label: 'Switch to Summit',
        route: '/api/seats/switch',
        href: '/api/seats/switch',
        method: 'post',
        fields: { accountId: SUMMIT.id },
        primary: false,
        context: null,
      },
    });
    expect(switcherView([PERSONAL, SUMMIT], SUMMIT.id, ATLAS.id)).toBeNull();
  });

  it('lists the others by name, then id, whatever order the seats were read in', () => {
    const names = (accounts: SwitcherAccount[]) =>
      switcherView(accounts, PERSONAL.id)!.others.map((o) => o.label);
    expect(names([SUMMIT, PERSONAL, ATLAS])).toEqual(['Atlas', 'Summit']);
    expect(names([ATLAS, UNNAMED, SUMMIT, PERSONAL])).toEqual([
      'Agency account',
      'Atlas',
      'Summit',
    ]);
  });

  it('reads an account with no name, or a blank one, by its kind', () => {
    expect(switcherView([UNNAMED, BLANK], UNNAMED.id)).toMatchObject({
      current: 'Agency account',
      others: [{ label: 'Personal account' }],
    });
  });

  it('has no orange element', () => {
    const s = switcherView([PERSONAL, SUMMIT, ATLAS], PERSONAL.id)!;
    expect(s.others.map((o) => o.primary)).toEqual([false, false]);
  });
});

describe('accountShellView, the switcher', () => {
  it('has none unless the reader’s accounts are given', () => {
    expect(accountShellView(view('home'), 'Sites').switcher).toBeNull();
  });

  it('acts in the view’s own account', () => {
    const accounts = [PERSONAL, account('c9', 'agency', 'Northwind')];
    expect(accounts[1]!.id).toBe(NORTHWIND_ACCOUNT_ID);
    expect(accountShellView(view('withheld'), 'Clients', { accounts }).switcher).toEqual(
      switcherView(accounts, NORTHWIND_ACCOUNT_ID),
    );
  });

  it('withSwitcher adds it to a screen’s data and changes nothing else', () => {
    const v = view('home');
    const data = { shell: accountShellView(v, 'Sites'), other: 1 };
    const accounts = [{ ...PERSONAL, id: v.account.id }, SUMMIT];
    expect(withSwitcher(data, accounts, v.account.id)).toEqual({
      other: 1,
      shell: { ...data.shell, switcher: switcherView(accounts, v.account.id) },
    });
    expect(withSwitcher(data, [accounts[0]!], v.account.id)).toEqual(data);
  });

  it('on a page of an account not acted in, the frame keeps no Keep and no link to billing', () => {
    // bad-site on day 9 of its Pro trial: the rail's card has Keep, which posts to the checkout.
    const v = view('home');
    const shell = accountShellView(v, 'Sites');
    expect(shell.trial!.keep).not.toBeNull();
    const accounts = [{ ...PERSONAL, id: v.account.id }, SUMMIT];
    const visiting = accountShellView(v, 'Sites', { accounts, actingIn: SUMMIT.id });
    expect(visiting.switcher!.visiting!.switchTo.fields).toEqual({ accountId: v.account.id });
    expect(visiting.trial).toEqual({ ...shell.trial, keep: null, billing: null });
    expect(withSwitcher({ shell }, accounts, v.account.id, SUMMIT.id).shell).toEqual(visiting);

    const day0 = accountShellView(view('day0'), 'Sites');
    expect(day0.trial!.billing).not.toBeNull();
    const d0 = [{ ...PERSONAL, id: view('day0').account.id }, SUMMIT];
    expect(
      withSwitcher({ shell: day0 }, d0, view('day0').account.id, SUMMIT.id).shell.trial!.billing,
    ).toBeNull();
  });
});

describe('accountShellView, the rail', () => {
  const links = (v: AccountView) => accountShellView(v, null).nav.map((n) => [n.label, n.href]);
  const current = (v: AccountView, label: Parameters<typeof accountShellView>[1]) =>
    accountShellView(v, label)
      .nav.filter((n) => n.current)
      .map((n) => n.label);

  it('is ACCOUNT_NAV, with no plan card and no badge, for an account that is not on Agency', () => {
    for (const name of ['day0', 'home', 'clean'] as const) {
      const v = view(name);
      expect(v.tier).not.toBe('agency');
      expect(links(v)).toEqual(ACCOUNT_NAV.map((n) => [n.label, n.href]));
      expect(accountShellView(v, 'Sites')).toMatchObject({ plan: null, badge: null });
    }
  });

  it('is the agency rail on Agency: Clients, Changes, Alerts, Reports, Seats, Settings', () => {
    const v = view('withheld');
    expect(v.tier).toBe('agency');
    expect(links(v)).toEqual([
      ['Clients', '/agency'],
      ['Changes', '/changes'],
      ['Alerts', '/alerts'],
      ['Reports', '/reports'],
      ['Seats', '/seats'],
      ['Settings', '/settings'],
    ]);
    expect(links(v)).toEqual(AGENCY_NAV.map((n) => [n.label, n.href]));
    expect(accountShellView(v, null).badge).toBe('Agency');
  });

  it('counts the clients the reader’s records hold, staging copies left out', () => {
    const v = view('withheld');
    expect(accountShellView(v, 'Clients').nav[0]).toMatchObject({
      label: 'Clients',
      count: '2',
      current: true,
    });
    const copy = { ...v.d.sites[0]!, id: 'copy', staging_of_site_id: v.d.sites[0]!.id };
    const withCopy = { ...v, d: { ...v.d, sites: [...v.d.sites, copy] } };
    expect(accountShellView(withCopy, 'Clients').nav[0]!.count).toBe('2');
  });

  it('marks Clients on a page that sits under Sites, and nothing for a page the rail does not hold', () => {
    const v = view('withheld');
    expect(current(v, 'Sites')).toEqual(['Clients']);
    expect(current(v, 'Seats')).toEqual(['Seats']);
    expect(current(v, 'Competitors')).toEqual([]);
    expect(current(view('home'), 'Seats')).toEqual([]);
    expect(current(view('home'), 'Clients')).toEqual(['Sites']);
  });
});

describe('accountShellView, the Agency plan card', () => {
  /** Northwind as a paying Agency account: the fixture's own, with its failed invoice taken out. */
  const paying = (over: Partial<AccountView['account']> = {}): AccountView => {
    const v = view('withheld');
    const a = {
      ...v.account,
      state: 'agency' as const,
      state_history: v.account.state_history.filter((h) => h.state !== 'past_due'),
      ...over,
    };
    return { ...v, account: a, d: { ...v.d, accounts: [a] } };
  };

  it('reads its price from prices.ts, and the plan’s sites and seats from the account’s limits', () => {
    const v = paying({ billing_period_months: 1 });
    const plan = accountShellView(v, 'Clients').plan!;
    expect(plan.title).toBe(`Agency · $${AGENCY_MONTHLY} a month`);
    expect(plan.counts).toBe(
      `${v.account.limits.sites} client sites · ${v.account.limits.seats} seats`,
    );
    expect(plan.counts).toBe('25 client sites · 5 seats');
  });

  it('gives the yearly price to an account billed by the year', () => {
    expect(accountShellView(paying({ billing_period_months: 12 }), 'Clients').plan!.title).toBe(
      `Agency · $${AGENCY_YEARLY} a year`,
    );
  });

  it('tells the owner when it renews and on which card, where the account holds both', () => {
    const both = { renews_at: '2026-12-01T14:00:00Z', card_last4: '4242' };
    const shell = (over: Partial<AccountView['account']>, role?: 'owner' | 'developer') =>
      accountShellView(paying(over), 'Clients', role ? { role } : {});
    expect(shell(both).plan).toMatchObject({
      note: 'Renews 1 Dec. Card ending 4242.',
      billing: { href: '/settings/plan', label: 'Billing' },
    });
    expect(shell({ ...both, renews_at: null }).plan!.note).toBeNull();
    expect(shell({ ...both, card_last4: null }).plan!.note).toBeNull();
    expect(shell(both, 'developer').plan).toMatchObject({ note: null, billing: null });
  });

  it('says nothing of a renewal while a payment is past due', () => {
    const v = view('withheld');
    expect(v.account.state).toBe('past_due');
    expect(accountShellView(v, 'Clients').plan).toMatchObject({
      title: `Agency · $${AGENCY_MONTHLY} a month`,
      note: null,
    });
  });

  it('is left to the trial card during a trial', () => {
    const trial = paying({
      state: 'agency_trial',
      trial_ends_at: '2026-11-20T14:00:00Z',
      state_history: [{ state: 'agency_trial', since: '2026-10-01T14:00:00Z' }],
    });
    const shell = accountShellView(trial, 'Clients');
    expect(shell.plan).toBeNull();
    expect(shell.trial).not.toBeNull();
  });
});
