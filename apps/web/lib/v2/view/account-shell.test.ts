/** The account frame's view model against values worked out by hand from the fixtures. */
import { describe, expect, it } from 'vitest';
import {
  ACCOUNT_VIEWERS,
  CLEAN_VIEWER,
  STAND_IN_FREE_ACCOUNT,
} from '../../../app/(v2-preview)/v2-preview/_preview/accounts';
import { FixtureDatasetSchema } from '@crawlmouse/types/v2';
import { fixture } from '../fixtures';
import { viewAt } from './account';
import { accountShellView, isFirstRun, newChanges } from './account-shell';

const bad = fixture('bad-site');
const shellOf = (name: keyof typeof ACCOUNT_VIEWERS, d = bad) =>
  accountShellView(viewAt(d, ACCOUNT_VIEWERS[name]()), 'Sites');

describe('the rail', () => {
  it('counts the sites and the new changes on day 9: five sites, three changes', () => {
    // Opened: Claude-SearchBot and ClaudeBot (change 1, 2); resolved: nahltech's orphans (change 5).
    const nav = shellOf('home').nav;
    expect(nav.map((n) => [n.label, n.count])).toEqual([
      ['Sites', '5'],
      ['Changes', '3 new'],
      ['Alerts', null],
      ['Competitors', null],
      ['Reports', null],
      ['Integrations', null],
      ['Settings', null],
    ]);
    expect(nav.filter((n) => n.current).map((n) => n.label)).toEqual(['Sites']);
  });

  it('has nothing new on day 0: a first audit’s findings are not changes', () => {
    const v = viewAt(bad, ACCOUNT_VIEWERS.day0());
    expect(isFirstRun(v)).toBe(true);
    expect(newChanges(v)).toEqual([]);
    expect(shellOf('day0').nav.find((n) => n.label === 'Sites')!.count).toBe('1');
  });

  it('marks the page the frame is for', () => {
    const v = viewAt(bad, ACCOUNT_VIEWERS.home());
    expect(
      accountShellView(v, 'Alerts')
        .nav.filter((n) => n.current)
        .map((n) => n.label),
    ).toEqual(['Alerts']);
  });
});

describe('the trial card', () => {
  it('on day 0: fourteen days left, no card on file, a billing link and no price', () => {
    // 25 Oct 02:41Z = Sat 24 Oct in Indiana; the trial ends 8 Nov 02:41Z = Sat 7 Nov.
    expect(shellOf('day0').trial).toMatchObject({
      title: 'Pro, trial · ends Sat 7 Nov',
      left: '14 days left',
      note: 'No card on file. When it ends, this site stays on Free with monthly checks. Nothing you can see is deleted.',
      keep: null,
    });
    expect(shellOf('day0').trial!.billing!.href).toBe('/settings/plan');
  });

  it('on day 9: eight days left, what Free keeps for the four primary sites, and the price', () => {
    // Fri 30 Oct to Sat 7 Nov: eight dates. Four primary sites; staging holds no slot (Q10).
    const t = shellOf('home').trial!;
    expect(t.left).toBe('8 days left');
    expect(t.note).toBe(
      "Then Free: example-outfitter.com keeps monthly checks; the other three sites pause until you choose Pro or remove them. Nothing you can see is deleted. We'll email you three days before.",
    );
    expect(t.keep).toMatchObject({
      label: 'Keep Pro, $19 a month',
      href: '/api/billing/checkout',
      method: 'post',
      fields: { plan: 'pro', interval: 'month' },
    });
    expect(t.billing).toBeNull();
  });

  it('is absent outside a trial', () => {
    expect(shellOf('withheld', fixture('challenged-site')).trial).toBeNull();
    expect(shellOf('clean', fixture('clean-site')).trial).toBeNull();
  });
});

describe('the stand-in Free account (clean-site has none)', () => {
  it('is a valid account that has never had a trial, holding the unkept audit', () => {
    const v = viewAt(fixture('clean-site'), CLEAN_VIEWER);
    expect(() => FixtureDatasetSchema.parse(v.d)).not.toThrow();
    expect(STAND_IN_FREE_ACCOUNT.state_history.map((h) => h.state)).toEqual(['free']);
    expect(v.tier).toBe('free');
    expect(v.d.sites.map((s) => s.account_id)).toEqual([STAND_IN_FREE_ACCOUNT.id]);
  });
});
