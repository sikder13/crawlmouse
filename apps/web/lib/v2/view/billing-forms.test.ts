/**
 * Each billing form an account screen renders names the account it was rendered for (CC-31 D2b), so
 * the route acts on that account whichever one the reader has switched to since. Read from the
 * views' own output: every action that posts to a billing route, wherever it sits in the model.
 */
import { describe, expect, it } from 'vitest';
import {
  ACCOUNT_VIEWERS,
  CLEAN_VIEWER,
} from '../../../app/(v2-preview)/v2-preview/_preview/accounts';
import { fixture } from '../fixtures';
import { viewAt } from './account';
import { accountShellView } from './account-shell';
import { dashboardView } from './dashboard';
import { settingsView } from './settings';
import { trialEndedView, trialEndView } from './trial-end';

const BILLING = /^\/api\/billing\//;

interface Form {
  href: string;
  fields: Record<string, string>;
}

/** Every `{href, fields}` under `v` whose href is a billing route. */
function billingForms(v: unknown, seen = new Set<unknown>()): Form[] {
  if (v === null || typeof v !== 'object' || seen.has(v)) return [];
  seen.add(v);
  const o = v as Record<string, unknown>;
  const own =
    typeof o.href === 'string' && BILLING.test(o.href)
      ? [{ href: o.href, fields: (o.fields ?? {}) as Record<string, string> }]
      : [];
  return [...own, ...Object.values(o).flatMap((x) => billingForms(x, seen))];
}

const bad = fixture('bad-site');
const clean = fixture('clean-site');
const HOME = ACCOUNT_VIEWERS.home();
// The Pro trial's last day and the day after it: the reminder's screen and the ended one.
const LAST_DAY = { ...HOME, now: '2026-11-07T12:00:00.000Z' };
const AFTER = { ...HOME, now: '2026-11-09T12:00:00.000Z' };
/** The same account once its trial has ended: back on Free, as the state machine leaves it. */
const ended = {
  ...bad,
  accounts: bad.accounts.map((a) =>
    a.id === HOME.accountId
      ? {
          ...a,
          state: 'free' as const,
          state_history: [
            ...a.state_history,
            { state: 'free' as const, since: '2026-11-08T02:41:00Z' },
          ],
        }
      : a,
  ),
};

const SCREENS: [name: string, account: string, model: unknown][] = [
  ['Settings, on a trial', HOME.accountId, settingsView(bad, HOME)],
  ['Settings, on Free', CLEAN_VIEWER.accountId, settingsView(clean, CLEAN_VIEWER)],
  ['the dashboard', HOME.accountId, dashboardView(bad, HOME)],
  ['the rail', HOME.accountId, accountShellView(viewAt(bad, LAST_DAY), 'Sites', { role: 'owner' })],
  ['Trial ending', HOME.accountId, trialEndView(bad, LAST_DAY)],
  ['Trial ended', HOME.accountId, trialEndedView(ended, AFTER)],
];

describe('the billing forms of the account screens', () => {
  it.each(SCREENS)('%s: each names its account', (_name, account, model) => {
    const forms = billingForms(model);
    expect(forms.map((f) => [f.href, f.fields.accountId])).toEqual(
      forms.map((f) => [f.href, account]),
    );
  });

  it('are found on these screens: a Keep on the rail and on both trial screens, and Settings’ own', () => {
    const count = Object.fromEntries(
      SCREENS.map(([name, , model]) => [name, billingForms(model).length]),
    );
    for (const name of ['Settings, on a trial', 'the rail', 'Trial ending', 'Trial ended']) {
      expect(count[name], name).toBeGreaterThan(0);
    }
  });
});
