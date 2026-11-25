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

  it('a seat that is not the owner’s is not told to email about the owner’s plan', () => {
    const terms = settingsView(paid, home, { ...closed, role: 'account_manager' }).plan.terms;
    expect(terms.find((t) => t.label === 'Cancel')!.text).toBe('Managed by the account owner.');
  });

  it('a no-card trial’s Cancel row names no control it does not have', () => {
    const cancel = settingsView(bad, home, closed).plan.terms.find((t) => t.label === 'Cancel')!;
    expect(cancel.text).toBe(
      'Nothing to cancel on a trial; it ends by itself. Nothing you can see is deleted.',
    );
    expect(cancel.action).toBeNull();
  });

  it('lists the trial reminder, which the clock sends, and no receipts it cannot have', () => {
    const email = settingsView(bad, home, closed).email;
    expect(email.rows.map((r) => r.kind)).toContain('trial_reminder');
    expect(email.foot).toMatch(/^Those are the three kinds from us\. There is no newsletter/);
  });

  it('lists all three with plans open', () => {
    const email = settingsView(bad, home, { billingOpen: true }).email;
    expect(email.rows.map((r) => r.kind)).toContain('trial_reminder');
    expect(email.foot).toContain('Those are the three kinds from us. If you pay');
  });

  it('passes the closed state to its own frame, whatever the deployment says', () => {
    vi.stubEnv('V2_BILLING', '1');
    const note = settingsView(bad, home, closed).shell.trial!.note;
    expect(note).not.toContain('choose Pro');
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
      // One item is offered (Slack, connected): the others are not built (D-16).
      'It stops when the 14 days end. The site, its audits and its monthly check do not.',
    );
    expect(v.threeKinds!.body).not.toContain('keep Pro');
  });

  it('says the reminder, which the clock sends', () => {
    const v = dashboardView(bad, day0);
    expect(v.threeKinds!.body).toContain('one reminder on');
    expect(v.threeKinds!.lead).toBe('You will hear from us three ways and no others:');
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
      'It stops when the 14 days end. The site and its audits do not.',
    );
  });
});

describe('the reminder, which the clock sends with paid plans closed', () => {
  it('the rail says it', () => {
    const note = accountShellView(viewAt(bad, home), 'Sites', { role: 'owner', ...closed }).trial!
      .note;
    expect(note).toContain("We'll email you three days before.");
  });

  it('the rail does not promise it to a seat that will not get it', () => {
    const note = accountShellView(viewAt(bad, home), 'Sites', {
      role: 'developer',
      ...closed,
    }).trial!.note;
    expect(note).not.toContain("We'll email");
  });

  it('the first-run dashboard does not promise it to a seat that will not get it', () => {
    const owner = bad.seats.find((s) => s.account_id === BAD && s.role === 'owner')!;
    const devId = 'c0000000-0000-4000-8000-000000000093';
    const d: FixtureDataset = {
      ...bad,
      seats: [...bad.seats, { ...owner, id: devId, role: 'developer', email: 'dev@example.com' }],
    };
    const v = dashboardView(d, { ...day0, seatId: devId });
    expect(v.threeKinds!.body).not.toContain('reminder');
  });

  it('the first-run dashboard does not name a reminder day that has passed', () => {
    const late = { ...day0, now: '2026-11-07T15:00:00.000Z' };
    const firstOnly: FixtureDataset = {
      ...bad,
      checks: bad.sites.flatMap((s) => {
        const first = bad.checks
          .filter((c) => c.site_id === s.id && c.finished_at !== null)
          .sort((x, y) => Date.parse(x.finished_at!) - Date.parse(y.finished_at!))[0];
        return first ? [first] : [];
      }),
    };
    const v = dashboardView(firstOnly, late);
    expect(v.firstRun).toBe(true);
    expect(v.threeKinds!.body).not.toContain('reminder');
  });

  it('the rail does not promise it to an owner who turned it off', () => {
    const off = withAccount(bad, {
      email_prefs: {
        ...bad.accounts.find((a) => a.id === BAD)!.email_prefs,
        trial_reminder: false,
      },
    });
    const note = accountShellView(viewAt(off, home), 'Sites', { role: 'owner', ...closed }).trial!
      .note;
    expect(note).not.toContain("We'll email");
  });

  it('Trial ending says it', () => {
    const v = trialEndView(bad, trialEndViewer(bad, BAD), closed);
    expect(v.banner.sub).toBe(
      'The reminder is due once, on Wed 4 Nov. No card is on file, so nothing is charged.',
    );
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
  it('a no-card trial is not told "either way", with one way to go', () => {
    const v = trialEndView(bad, trialEndViewer(bad, BAD), closed);
    expect(v.banner.sub).toContain('No card is on file, so nothing is charged.');
    expect(v.banner.sub).not.toContain('either way');
  });

  it('names the seats the move to Free removes, and not an invitation', () => {
    const owner = bad.seats.find((s) => s.account_id === BAD && s.role === 'owner')!;
    const seat = (id: string, accepted: string | null) => ({
      ...owner,
      id,
      role: 'developer' as const,
      email: `${id.slice(-4)}@example.com`,
      accepted_at: accepted,
    });
    const withSeats: FixtureDataset = {
      ...bad,
      seats: [
        ...bad.seats.filter((s) => s.account_id !== BAD || s.role === 'owner'),
        seat('c0000000-0000-4000-8000-000000000091', owner.accepted_at),
        seat('c0000000-0000-4000-8000-000000000092', null),
      ],
    };
    const v = trialEndView(withSeats, trialEndViewer(withSeats, BAD), closed);
    expect(v.endText).toContain('The 1 other person with a seat on this account loses access.');
    // Not under "Pauses, until Pro": choosing Pro later does not bring the seat back.
    expect(JSON.stringify(v.pauses)).not.toContain('seat');
    // The page serves any member, and to a member "the other person" would be the owner.
    for (const role of ['account_manager', 'developer'] as const) {
      const read = trialEndView(withSeats, trialEndViewer(withSeats, BAD), { ...closed, role });
      expect(read.endText).not.toContain('loses access');
    }
  });

  describe('a member reads what the end does to their own seat', () => {
    const roles = ['account_manager', 'developer'] as const;
    const END = 'Sat 7 Nov';
    const read = (d: FixtureDataset, reading: Parameters<typeof trialEndView>[2]) =>
      trialEndView(d, trialEndViewer(d, BAD), reading);
    const card = withAccount(bad, {
      card_last4: '4242',
      billing_period_months: 1,
      renews_at: '2026-11-07T00:00:00.000Z',
    });

    it.each(roles)('%s, no card, plans closed: the access ends', (role) => {
      expect(read(bad, { ...closed, role }).endText).toContain(
        `Your access to this account ends on ${END}.`,
      );
    });

    it.each(roles)('%s, no card, plans open: it ends unless the owner keeps Pro', (role) => {
      expect(read(bad, { billingOpen: true, role }).endText).toContain(
        `Your access to this account ends on ${END} unless the owner keeps Pro.`,
      );
    });

    it.each(roles)('%s, a card that will be charged: only if the owner cancels', (role) => {
      const text = read(card, { billingOpen: true, role }).endText;
      expect(text).toContain(`If the owner cancels, your access to this account ends on ${END}.`);
      expect(text).not.toContain(`Your access to this account ends`);
    });

    it.each(roles)('%s, a card trial set to cancel: the access ends', (role) => {
      const text = read(card, {
        billingOpen: true,
        role,
        billingEnd: '2026-11-07T00:00:00.000Z',
      }).endText;
      expect(text).toContain(`Your access to this account ends on ${END}`);
      expect(text).not.toContain('If the owner cancels');
    });

    it.each(roles)('%s, a card on file with no renewal recorded: as the owner is told', (role) => {
      const noMirror = withAccount(bad, { card_last4: '4242', billing_period_months: 1 });
      expect(read(noMirror, { billingOpen: true, role: 'owner' }).banner.sub).toContain(
        'is charged on Sat 7 Nov unless you cancel',
      );
      expect(read(noMirror, { billingOpen: true, role }).endText).toContain(
        `If the owner cancels, your access to this account ends on ${END}.`,
      );
    });

    it('the owner keeps their seat, and is not told otherwise', () => {
      for (const d of [bad, card]) {
        expect(read(d, { ...closed, role: 'owner' }).endText).not.toMatch(/your access/i);
      }
    });

    it('only the owner is told a reminder is due, since only the owner is sent it', () => {
      const banner = (role: 'owner' | 'developer' | 'account_manager') =>
        read(bad, { ...closed, role }).banner.sub;
      expect(banner('owner')).toContain('The reminder is due once');
      for (const role of roles) expect(banner(role)).not.toContain('reminder');
    });
  });

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
