/**
 * F-108, the sentences: with paid plans closed, the account pages name no price for the wrong plan,
 * offer no route that refuses, and promise neither a plan to keep nor a reminder nothing sends yet.
 * bad-site's account is a no-card Pro trial ending Sat 7 Nov.
 */
import type { FixtureDataset } from '@crawlmouse/types/v2';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ACCOUNT_VIEWERS } from '../../../app/(v2-preview)/v2-preview/_preview/accounts';
import { noticeLine } from '../copy/notices';
import { fixture } from '../fixtures';
import { viewAt } from './account';
import { accountShellView } from './account-shell';
import { dashboardView } from './dashboard';
import { settingsView } from './settings';
import { trialEndView, trialEndViewer, trialPage } from './trial-end';

const BAD = 'a0000000-0000-4000-8000-000000000001';
const OLDEST = '50000000-0000-4000-8000-000000000001';
const bad = fixture('bad-site');
const home = ACCOUNT_VIEWERS.home();
const day0 = ACCOUNT_VIEWERS.day0();

const withAccount = (
  d: FixtureDataset,
  change: Partial<FixtureDataset['accounts'][number]>,
): FixtureDataset => ({
  ...d,
  accounts: d.accounts.map((a) => (a.id === BAD ? { ...a, ...change } : a)),
});
const free = withAccount(bad, {
  state: 'free',
  trial_ends_at: null,
  state_history: [{ state: 'free', since: '2026-10-01T00:00:00.000Z' }],
});
const paid = withAccount(bad, {
  state: 'pro',
  trial_ends_at: null,
  card_last4: '4242',
  billing_period_months: 1,
  renews_at: '2026-11-25T00:00:00.000Z',
  state_history: [{ state: 'pro', since: '2026-10-01T00:00:00.000Z' }],
});
const closed = { billingOpen: false } as const;

beforeEach(() => {
  vi.stubEnv('V2_CHECKS_PUBLIC', '1');
  vi.stubEnv('V2_BILLING', '');
});
afterEach(() => vi.unstubAllEnvs());

describe('Settings › Plan with paid plans closed', () => {
  it('a Free owner reads Pro’s price as Pro’s', () => {
    const other = settingsView(free, home, closed).plan.other;
    expect(other).toContain('Pro is $19 a month, or $190 a year.');
    expect(other).not.toContain('Free is');
  });

  it('a no-card trial is not told it can add a card and choose a plan', () => {
    expect(settingsView(bad, home, closed).plan.note).toBe(
      'Ends Sat 7 Nov. No card on file; nothing is charged.',
    );
  });

  it('keeps that sentence with plans open', () => {
    expect(settingsView(bad, home, { billingOpen: true }).plan.note).toContain(
      'unless you add one and choose Pro',
    );
  });

  it('offers no control that posts to a billing route', () => {
    for (const d of [bad, free, paid]) {
      expect(JSON.stringify(settingsView(d, home, closed).plan)).not.toContain('/api/billing/');
    }
  });

  it('a paid account is told how to cancel, and is not promised a portal', () => {
    const terms = settingsView(paid, home, closed).plan.terms;
    const cancel = terms.find((t) => t.label === 'Cancel')!;
    expect(cancel.action).toBeNull();
    expect(cancel.text).toMatch(/^To cancel, email /);
    const receipts = terms.find((t) => t.label === 'Receipts')!;
    expect(receipts.action).toBeNull();
    expect(receipts.text).not.toContain('portal');
  });

  it('offers cancel and the portal with plans open', () => {
    const json = JSON.stringify(settingsView(paid, home, { billingOpen: true }).plan);
    expect(json).toContain('/api/billing/cancel');
    expect(json).toContain('/api/billing/portal');
  });
});

describe('the first-run dashboard with paid plans closed', () => {
  it('does not mention keeping Pro', () => {
    const v = dashboardView(bad, day0);
    expect(v.setup!.foot).toBe(
      'All five stop when the 14 days end. The site, its audits and its monthly check do not.',
    );
    expect(v.threeKinds!.body).not.toContain('keep Pro');
  });

  it('does not promise a reminder nothing sends yet', () => {
    const v = dashboardView(bad, day0);
    expect(v.threeKinds!.body).not.toContain('reminder');
    expect(v.threeKinds!.lead).toBe('You will hear from us two ways and no others:');
  });

  it('is as it was with plans open', () => {
    vi.stubEnv('V2_BILLING', '1');
    const v = dashboardView(bad, day0);
    expect(v.setup!.foot).toContain('unless you keep Pro');
    expect(v.threeKinds!.body).toContain('one reminder on');
    expect(v.threeKinds!.body).toContain('If you keep Pro, Stripe sends the receipts.');
  });

  it('does not promise a monthly check to an oldest site the person paused', () => {
    const d: FixtureDataset = {
      ...bad,
      sites: bad.sites.map((s) => (s.id === OLDEST ? { ...s, paused: true } : s)),
    };
    expect(dashboardView(d, day0).setup!.foot).toBe(
      'All five stop when the 14 days end. The site and its audits do not.',
    );
  });
});

describe('the reminder, until something sends it', () => {
  it('the rail does not promise it', () => {
    const note = accountShellView(viewAt(bad, home), 'Sites', { role: 'owner', ...closed }).trial!
      .note;
    expect(note).not.toContain("We'll email");
  });

  it('Trial ending does not promise it', () => {
    const v = trialEndView(bad, trialEndViewer(bad, BAD), closed);
    expect(v.banner.sub).not.toContain('reminder');
  });

  it('both still say it with plans open', () => {
    const open = { billingOpen: true };
    expect(
      accountShellView(viewAt(bad, home), 'Sites', { role: 'owner', ...open }).trial!.note,
    ).toContain("We'll email");
    expect(trialEndView(bad, trialEndViewer(bad, BAD), open).banner.sub).toContain('reminder');
  });
});

describe('Trial ending, other cases with paid plans closed', () => {
  it('a card trial is not told to add Pro', () => {
    const card = withAccount(bad, { card_last4: '4242', billing_period_months: 1 });
    expect(trialEndView(card, trialEndViewer(card, BAD), closed).endText).not.toContain('add Pro');
  });

  it('after the end, an oldest site that is paused is not said to be as the person left it', () => {
    // Removing the oldest site after the end leaves a `trial_ended` site oldest, which they never paused.
    const ended: FixtureDataset = {
      ...withAccount(bad, {
        state: 'free',
        trial_ends_at: null,
        state_history: [
          ...bad.accounts.find((a) => a.id === BAD)!.state_history,
          { state: 'free', since: '2026-11-08T02:41:00.000Z' },
        ],
      }),
      sites: bad.sites.map((s) => (s.id === OLDEST ? { ...s, paused: true } : s)),
    };
    const shown = trialPage(ended, { accountId: BAD, now: '2026-11-09T15:00:00.000Z' }, closed);
    if (shown?.kind !== 'after') throw new Error('expected the after state');
    const row = shown.view.stays.find((r) => r.what === 'example-outfitter.com')!;
    expect(row.how).toBe('paused');
  });
});

describe('a refused trial', () => {
  it('does not say the device or network was the reason when the email could be', () => {
    const line = noticeLine({ notice: 'refused' }, 'UTC');
    expect(JSON.stringify(line)).toContain('this email address, device or network');
  });
});
