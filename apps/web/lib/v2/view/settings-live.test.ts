/**
 * What Settings and its delete step add for a live account (CC-27b D6): a paid plan set to end at
 * its period's end, and the accounts a deletion removes. Values worked out by hand on the
 * challenged-site fixture's Northwind account (Agency, America/Indiana/Indianapolis) and bad-site.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ACCOUNT_VIEWERS } from '../../../app/(v2-preview)/v2-preview/_preview/accounts';
import { fixture } from '../fixtures';
import { deleteStepView, settingsView } from './settings';

const WEB = join(__dirname, '../../..');

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

describe('deleting an account with a paid plan: the money (owner ruling Q7)', () => {
  // The period-end sentence is the deletion page's (lib/v2/copy/deletion.ts); the refund sentence is
  // the Terms page's own, read from app/terms/page.tsx below, so a change there turns this red.
  const ch = fixture('challenged-site');
  const viewer = { accountId: ACCOUNT_VIEWERS.withheld().accountId, now: '2026-10-31T12:00:00Z' };
  const MONEY =
    'A paid plan is set to end at the end of the period you have paid for. If that comes after the seven days, the plan is cancelled when the account is erased. We don’t refund partial periods except where the law requires it.';
  const terms = readFileSync(join(WEB, 'app/terms/page.tsx'), 'utf8')
    .replace(/&rsquo;/g, '’')
    .replace(/\s+/g, ' ');
  /** The text's last sentence. */
  const last = (text: string) => text.slice(text.lastIndexOf('. ', text.length - 2) + 2);

  it('the danger zone and the delete step say it on a paid plan', () => {
    expect(settingsView(ch, viewer).danger.text.endsWith(` ${MONEY}`)).toBe(true);
    expect(deleteStepView(ch, viewer).text.endsWith(` ${MONEY}`)).toBe(true);
  });

  it('its refund sentence is the one the Terms page publishes, and nothing is added to it', () => {
    for (const text of [settingsView(ch, viewer).danger.text, deleteStepView(ch, viewer).text]) {
      expect(last(text)).toMatch(/refund/);
      expect(terms).toContain(last(text));
    }
  });

  it('a trial with no card and Free say nothing about money', () => {
    for (const [d, v] of [
      [fixture('bad-site'), ACCOUNT_VIEWERS.home()],
      [fixture('clean-site'), ACCOUNT_VIEWERS.clean()],
    ] as const) {
      expect(settingsView(d, v).danger.text).not.toContain('refund');
      expect(deleteStepView(d, v).text).not.toContain('refund');
    }
  });
});

describe('what each role is offered (CC-27b review, item 5)', () => {
  const home = fixture('bad-site');
  const paid = fixture('challenged-site');
  const onAgency = { accountId: ACCOUNT_VIEWERS.withheld().accountId, now: '2026-10-31T12:00:00Z' };

  it('the owner: the address to change, Delete…, Keep, and on a paid plan Cancel and the portal', () => {
    const v = settingsView(home, ACCOUNT_VIEWERS.home(), { role: 'owner' });
    expect(v.account.email.readOnly).toBe(false);
    expect(v.danger.action).toMatchObject({ href: '/settings/delete' });
    expect(v.plan.keep).not.toBeNull();
    const p = settingsView(paid, onAgency, { role: 'owner' }).plan;
    expect(p.terms.map((t) => t.action?.href ?? null)).toEqual([
      '/api/billing/cancel',
      '/api/billing/portal',
    ]);
  });

  it('an account manager: the address read-only, and no Delete…, Keep, Cancel or portal', () => {
    const v = settingsView(home, ACCOUNT_VIEWERS.home(), { role: 'account_manager' });
    expect(v.account.email.readOnly).toBe(true);
    expect(v.danger.action).toBeNull();
    expect(v.plan.keep).toBeNull();
    const p = settingsView(paid, onAgency, { role: 'account_manager' }).plan;
    expect(p.terms.map((t) => t.action)).toEqual([null, null]);
    // The name and the email kinds stay theirs to change.
    expect(v.account.save.href).toBe('/api/account');
  });

  it('a preview is read as the owner’s', () => {
    expect(settingsView(home, ACCOUNT_VIEWERS.home())).toEqual(
      settingsView(home, ACCOUNT_VIEWERS.home(), { role: 'owner' }),
    );
  });

  it('the delete step’s request is the owner’s alone', () => {
    expect(deleteStepView(home, ACCOUNT_VIEWERS.home(), { role: 'owner' }).submit).not.toBeNull();
    for (const role of ['account_manager', 'developer'] as const)
      expect(deleteStepView(home, ACCOUNT_VIEWERS.home(), { role }).submit).toBeNull();
  });
});
