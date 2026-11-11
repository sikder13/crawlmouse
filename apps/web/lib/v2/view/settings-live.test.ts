/**
 * What Settings and its delete step add for a live account (CC-27b D6): a paid plan set to end at
 * its period's end, and the accounts a deletion removes. Values worked out by hand on the
 * challenged-site fixture's Northwind account (Agency, America/Indiana/Indianapolis) and bad-site.
 */
import { describe, expect, it } from 'vitest';
import { ACCOUNT_VIEWERS } from '../../../app/(v2-preview)/v2-preview/_preview/accounts';
import { fixture } from '../fixtures';
import { deleteStepView, settingsView } from './settings';

describe('Settings, a paid plan set to end at its period’s end', () => {
  const ch = fixture('challenged-site');
  // Northwind on 31 Oct, on Agency: it goes past due on 1 Nov (state_history).
  const viewer = { accountId: ACCOUNT_VIEWERS.withheld().accountId, now: '2026-10-31T12:00:00Z' };

  it('shows the plan until that date, and offers no second cancel', () => {
    // 10 Dec 2026 15:00Z is Thu 10 Dec 10:00 in Indianapolis.
    const p = settingsView(ch, viewer, { billingEnd: '2026-12-10T15:00:00.000Z' }).plan;
    expect(p.name).toBe('Agency');
    expect(p.note).toBe('Agency until Thu 10 Dec, then Free. Nothing more is charged.');
    expect(p.terms[0]).toEqual({
      label: 'Cancel',
      text: 'Cancelled; it takes effect Thu 10 Dec. Nothing you can see is deleted; evidence older than 90 days is condensed to headers and the parts of pages that changed.',
      action: null,
    });
  });

  it('without an end, is the plan card it was', () => {
    expect(settingsView(ch, viewer, { billingEnd: null })).toEqual(settingsView(ch, viewer));
  });

  it('an end on a Free account changes nothing: there is no paid plan to show', () => {
    const bad = fixture('clean-site');
    const free = ACCOUNT_VIEWERS.clean();
    expect(settingsView(bad, free, { billingEnd: '2026-12-10T15:00:00.000Z' })).toEqual(
      settingsView(bad, free),
    );
  });
});

describe('the delete step, with the accounts the deletion removes', () => {
  const bad = fixture('bad-site');
  const viewer = ACCOUNT_VIEWERS.home();

  it('names each account by its primary site, one with none by what it is', () => {
    const v = deleteStepView(bad, viewer, {
      removes: [{ host: 'example-outfitter.com' }, { host: null }],
    });
    expect(v.removes).toBe(
      'Deleting removes 2 accounts you alone hold: example-outfitter.com and an account with no site.',
    );
  });

  it('one account', () => {
    expect(deleteStepView(bad, viewer, { removes: [{ host: 'a.example' }] }).removes).toBe(
      'Deleting removes 1 account you alone hold: a.example.',
    );
  });

  it('none given, as in a preview, says nothing', () => {
    expect(deleteStepView(bad, viewer).removes).toBeNull();
  });
});
