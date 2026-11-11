/**
 * Trial ending after the end (CC-27b D8): the account back on Free. Worked out by hand on bad-site's
 * account with its Pro trial run out: trial_ends_at 8 Nov 02:41Z is Sat 7 Nov 21:41 in Indiana (EST),
 * and the account is read on Mon 9 Nov 15:00Z. The fixture records nothing after its as_of (Fri 30
 * Oct), so what stays and pauses is what it was at the reminder.
 */
import type { FixtureDataset } from '@crawlmouse/types/v2';
import { describe, expect, it } from 'vitest';
import { ACCOUNT_VIEWERS } from '../../../app/(v2-preview)/v2-preview/_preview/accounts';
import { fixture } from '../fixtures';
import { trialEndView, trialEndViewer, trialPage } from './trial-end';

const BAD = 'a0000000-0000-4000-8000-000000000001';
const ENDED = '2026-11-08T02:41:00.000Z';
const NOW = '2026-11-09T15:00:00.000Z';

function ended(): FixtureDataset {
  const d = fixture('bad-site');
  return {
    ...d,
    accounts: d.accounts.map((a) =>
      a.id === BAD
        ? {
            ...a,
            state: 'free',
            trial_ends_at: null,
            state_history: [...a.state_history, { state: 'free', since: ENDED }],
          }
        : a,
    ),
  };
}

const after = () => {
  const p = trialPage(ended(), { accountId: BAD, now: NOW });
  if (p?.kind !== 'after') throw new Error(`expected the after state, got ${p?.kind}`);
  return p.view;
};

describe('Trial ended: the account back on Free', () => {
  it('says the trial ended, and when, in the account’s zone', () => {
    const v = after();
    expect(v.header).toEqual({
      title: 'Back on Free: the Pro trial ended',
      line: 'Mon 9 Nov · 5 sites',
    });
    expect(v.banner.title).toBe('Pro ended Sat 7 Nov. Here is what stays, and what is paused.');
    expect(v.banner.sub).toBe(
      'Nothing you can see was deleted. Choose Pro any time to resume what is paused.',
    );
  });

  it('offers Pro at its price through the checkout, as the page’s one orange action', () => {
    expect(after().banner.keep).toMatchObject({
      label: 'Choose Pro, $19 a month',
      href: '/api/billing/checkout',
      method: 'post',
      primary: true,
      fields: { plan: 'pro', interval: 'month' },
    });
  });

  it('what stays and what is paused are the reminder’s, under the paused heading', () => {
    const before = trialEndView(fixture('bad-site'), trialEndViewer(fixture('bad-site'), BAD));
    const v = after();
    expect(v.stays).toEqual(before.stays);
    expect(v.pauses).toEqual(before.pauses);
    expect(v.pauses[0]!.what).toBe('nahltech.com, redbirdaviation.com and drivepei.ca');
    expect([v.staysTitle, v.pausesTitle]).toEqual(['Stays, on Free', 'Paused, until Pro']);
  });
});

describe('which state the page shows', () => {
  it('a trial still running: the before state, read at now', () => {
    const p = trialPage(fixture('bad-site'), { accountId: BAD, now: '2026-11-05T02:41:00.000Z' });
    expect(p?.kind).toBe('before');
  });

  it('a trial, then Pro, then Free is not “the trial ended”: the state before Free was Pro', () => {
    const d = fixture('bad-site');
    const PAID = '2026-11-08T02:41:00.000Z';
    const FREE = '2026-12-08T02:41:00.000Z';
    const lapsed = {
      ...d,
      accounts: d.accounts.map((a) =>
        a.id === BAD
          ? {
              ...a,
              state: 'free' as const,
              trial_ends_at: null,
              state_history: [
                ...a.state_history,
                { state: 'pro' as const, since: PAID },
                { state: 'free' as const, since: FREE },
              ],
            }
          : a,
      ),
    };
    expect(trialPage(lapsed, { accountId: BAD, now: '2026-12-09T15:00:00.000Z' })).toBeNull();
  });

  it('an account that never had a trial, or that went on to pay, has no trial page', () => {
    expect(trialPage(fixture('clean-site'), ACCOUNT_VIEWERS.clean())).toBeNull();
    const d = ended();
    const paid = {
      ...d,
      accounts: d.accounts.map((a) =>
        a.id === BAD
          ? {
              ...a,
              state: 'pro' as const,
              state_history: [
                ...fixture('bad-site').accounts[0]!.state_history,
                { state: 'pro' as const, since: ENDED },
              ],
            }
          : a,
      ),
    };
    expect(trialPage(paid, { accountId: BAD, now: NOW })).toBeNull();
  });

  it('an account with no primary site has no trial page: the plan card answers for it', () => {
    const d = ended();
    expect(trialPage({ ...d, sites: [] }, { accountId: BAD, now: NOW })).toBeNull();
    const running = fixture('bad-site');
    expect(
      trialPage({ ...running, sites: [] }, { accountId: BAD, now: '2026-11-05T02:41:00.000Z' }),
    ).toBeNull();
  });
});
