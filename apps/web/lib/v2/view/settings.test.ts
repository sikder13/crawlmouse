/**
 * Settings (Final-Settings) against values worked out by hand: bad-site at its as_of (Fri 30 Oct
 * 10:05Z), and the stand-in Free account.
 */
import { describe, expect, it } from 'vitest';
import {
  ACCOUNT_VIEWERS,
  CLEAN_VIEWER,
} from '../../../app/(v2-preview)/v2-preview/_preview/accounts';
import { fixture } from '../fixtures';
import { settingsView } from './settings';

const home = () => settingsView(fixture('bad-site'), ACCOUNT_VIEWERS.home());
const free = () => settingsView(fixture('clean-site'), CLEAN_VIEWER);

describe('Settings, the account', () => {
  it('names the address and the trial in the header', () => {
    expect(home().header.line).toBe('you@company.com · Pro trial, 8 days left');
    expect(free().header.line).toBe('owner@trailhead.example · Free');
  });

  it('fills the form from the account and saves it with Save, the page’s orange action', () => {
    const a = home().account;
    expect(a.email).toMatchObject({ label: 'Email', name: 'newEmail', value: 'you@company.com' });
    expect(a.name).toMatchObject({
      label: 'Name',
      name: 'name',
      value: '',
      placeholder: 'Optional',
    });
    expect(a.signIn.text).toBe(
      'Email link only; there is no password to lose. Links work once, for 15 minutes.',
    );
    expect(a.save).toMatchObject({
      label: 'Save',
      href: '/api/account',
      method: 'post',
      primary: true,
      fields: { _method: 'PATCH' },
    });
  });
});

describe('Settings, email', () => {
  it('lists the three kinds, each sender from CC-25’s constants, and the reminder three days before', () => {
    // trial_ends_at 8 Nov 02:41Z; three days before is 5 Nov 02:41Z, Wed 4 Nov 21:41 in Indiana.
    expect(home().email.rows.map((r) => [r.label, r.detail, r.control])).toEqual([
      ['Sign-in links', 'when you ask for one · magic@crawlmouse.com', { always: 'always' }],
      [
        'A note when a check finds a change',
        'alerts@crawlmouse.com · per the rules under Alerts',
        expect.objectContaining({ name: 'change_notes', on: true }),
      ],
      [
        'One reminder three days before the 14 days end',
        'Wed 4 Nov',
        expect.objectContaining({ name: 'trial_reminder', on: true }),
      ],
    ]);
    expect(home().email.foot).toBe(
      'Those are the three kinds from us. If you pay, Stripe sends the receipts. There is no newsletter and no product-update mail to unsubscribe from.',
    );
  });

  it('dates no reminder for an account with no trial', () => {
    expect(free().email.rows[2]!.detail).toBe('only during a trial');
  });
});

describe('Settings, the plan', () => {
  it('reads the trial, the slots and the largest site against the plan’s page cap', () => {
    const p = home().plan;
    expect([p.name, p.left, p.note]).toEqual([
      'Pro, trial',
      '8 days left',
      'Ends Sat 7 Nov. No card on file; nothing is charged unless you add one and choose Pro.',
    ]);
    // Four primary sites (staging holds no slot, Q10) of the plan's five; 214 pages, the most crawled.
    expect(p.usage).toEqual([
      ['Sites', '4 of 5'],
      ['Pages crawled, largest site', '214 of 2,000'],
    ]);
    expect(p.keep).toMatchObject({ label: 'Keep Pro, $19 a month', href: '/api/billing/checkout' });
    expect(p.other).toBe(
      'Or $190 a year. Agency, $99 a month: 25 sites, 5 seats, reports under your brand.',
    );
    expect(p.terms.map((t) => [t.label, t.text, t.action?.label ?? null])).toEqual([
      [
        'Cancel',
        'Nothing to cancel on a trial; it ends by itself. On Pro or Agency, "Cancel, back to Free" sits here: two clicks, effective at the end of the paid month. Nothing you can see is deleted; evidence older than 90 days is condensed to headers and the parts of pages that changed.',
        null,
      ],
      // No card, so no charge yet and no Stripe customer whose portal lists receipts.
      ['Receipts', 'Emailed by Stripe after each charge; there has been no charge yet.', null],
    ]);
  });

  it('reads 0 pages for a site whose first audit has not finished', () => {
    // The stand-in account began 15:30Z on 27 Oct; its audit finished 15:31Z.
    const p = settingsView(fixture('clean-site'), {
      ...CLEAN_VIEWER,
      now: '2026-10-27T15:30:30Z',
    }).plan;
    expect(p.usage[1]).toEqual(['Pages crawled, largest site', '0 of 500']);
  });

  it('on Free, reads Free’s limits and offers Pro', () => {
    const p = free().plan;
    expect([p.name, p.left]).toEqual(['Free', null]);
    expect(p.usage).toEqual([
      ['Sites', '1 of 1'],
      ['Pages crawled, largest site', '38 of 500'],
    ]);
    expect(p.keep).toMatchObject({ label: 'Choose Pro, $19 a month' });
  });
});

describe('Settings, the danger zone', () => {
  it('counts every site the deletion removes, staging included, and says how long it can be undone', () => {
    const d = home().danger;
    expect(d.text).toBe(
      'Removes all five sites, their history and reports. Takes effect after a confirmation link. For seven days the sign-in email can undo it; after that nothing is kept.',
    );
    // "Delete…" opens the confirmation step, where the owner re-types the hostname.
    expect(d.action).toMatchObject({ label: 'Delete…', href: '/settings/delete', method: 'get' });
    expect(free().danger.text).toMatch(/^Removes the site, its history and reports\. /);
  });
});

describe('Settings, on a trial with a card and on a plan past due (challenged-site)', () => {
  const ch = fixture('challenged-site');

  it('on Kestrel’s Agency trial: no Keep, a cancel, the billing portal, and Agency’s yearly price', () => {
    const p = settingsView(ch, {
      accountId: 'a0000000-0000-4000-8000-0000000000ca',
      now: ch.as_of,
    }).plan;
    expect(p.name).toBe('Agency, trial');
    expect(p.note).toBe('Ends Mon 16 Nov. The card ending 4242 is charged then unless you cancel.');
    expect(p.keep).toBeNull();
    expect(p.other).toBe('Or $990 a year.');
    expect(p.terms.map((t) => [t.label, t.action?.label ?? null, t.action?.href ?? null])).toEqual([
      ['Cancel', 'Cancel, back to Free', '/api/billing/cancel'],
      ['Receipts', 'Billing portal', '/api/billing/portal'],
    ]);
    expect(p.terms[0]!.text).toMatch(
      /^The trial ends Mon 16 Nov and the card is charged unless you cancel: two clicks/,
    );
  });

  it('on Northwind, past due since Sun 1 Nov: the plan holds for the grace days', () => {
    // past_due since 1 Nov 14:00Z (09:00 EST); seven days on, 8 Nov 14:00Z.
    const p = settingsView(ch, ACCOUNT_VIEWERS.withheld()).plan;
    expect(p.name).toBe('Agency');
    expect(p.note).toBe(
      'The last payment failed on Sun 1 Nov. Agency stays until Sun 8 Nov; update the card in the billing portal to keep it.',
    );
    expect(p.terms.map((t) => t.action?.label ?? null)).toEqual([
      'Cancel, back to Free',
      'Billing portal',
    ]);
  });
});
