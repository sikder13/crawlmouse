/**
 * F-103: a new trial says what it includes, and its end-of-trial line is right for no site, one site
 * and several. Worked out by hand from bad-site's account: a Pro trial with no card, ending Sat 7 Nov
 * in Indiana, with four primary sites.
 */
import type { FixtureDataset } from '@crawlmouse/types/v2';
import { describe, expect, it } from 'vitest';
import {
  ACCOUNT_VIEWERS,
  noSiteDataset,
} from '../../../app/(v2-preview)/v2-preview/_preview/accounts';
import { fixture } from '../fixtures';
import { viewAt } from './account';
import { accountShellView, isFirstRun } from './account-shell';
import { dashboardView } from './dashboard';

const BAD = 'a0000000-0000-4000-8000-000000000001';
const bad = fixture('bad-site');
const viewer = ACCOUNT_VIEWERS.home();
const ADD_NOTE =
  'Adding a site starts its first check. Its grades, crawlers and fixes appear here when that check ends.';
const PRO =
  // Competitors are not built (CAPABILITIES.competitors is coming), so the sentence names none (D-16);
  // the account's Slack is connected, so it is named (review 5).
  'You have Pro until Sat 7 Nov: weekly checks, every fix with its packet and Slack alerts, on up to 5 sites.';

const withAccount = (
  d: FixtureDataset,
  change: Partial<FixtureDataset['accounts'][number]>,
): FixtureDataset => ({
  ...d,
  accounts: d.accounts.map((a) => (a.id === BAD ? { ...a, ...change } : a)),
});

const railNote = (d: FixtureDataset) =>
  accountShellView(viewAt(d, viewer), 'Sites', { role: 'owner' }).trial!.note;

describe('a new trial with no site', () => {
  it('says what the trial includes, until when, and that no card is held', () => {
    expect(dashboardView(noSiteDataset(), viewer).sites.foot).toBe(`${PRO} No card. ${ADD_NOTE}`);
  });

  it('names Slack whether or not it is connected, since its Connect page is served (#167)', () => {
    const account = bad.accounts.find((a) => a.id === BAD)!;
    const d = withAccount(noSiteDataset(), {
      integrations: account.integrations.map((i) => ({ ...i, connected: false })),
    });
    expect(dashboardView(d, viewer).sites.foot).toBe(`${PRO} No card. ${ADD_NOTE}`);
  });

  it('does not say "no card" on a trial with a card', () => {
    const d = withAccount(noSiteDataset(), { card_last4: '4242' });
    expect(dashboardView(d, viewer).sites.foot).toBe(`${PRO} ${ADD_NOTE}`);
  });

  it('reads an Agency trial from the Agency gates', () => {
    const account = bad.accounts.find((a) => a.id === BAD)!;
    const d = withAccount(noSiteDataset(), {
      state: 'agency_trial',
      limits: { ...account.limits, sites: 25, competitors_per_site: 3 },
      state_history: [
        ...account.state_history.slice(0, -1),
        { state: 'agency_trial', since: account.state_history.at(-1)!.since },
      ],
    });
    expect(dashboardView(d, viewer).sites.foot).toContain(
      'You have Agency until Sat 7 Nov: weekly checks, every fix with its packet and Slack alerts, on up to 25 sites.',
    );
  });

  it('leaves the plain note on Free', () => {
    const d = withAccount(noSiteDataset(), {
      state: 'free',
      trial_ends_at: null,
      state_history: [{ state: 'free', since: '2026-10-01T00:00:00.000Z' }],
    });
    expect(dashboardView(d, viewer).sites.foot).toBe(ADD_NOTE);
  });

  it('does not call a site "this site" on the rail when there is none', () => {
    expect(railNote(noSiteDataset())).toBe(
      'No card on file. When it ends, the account moves to Free: one site, with monthly checks. Nothing you can see is deleted.',
    );
  });
});

describe('a new trial with several sites, none checked twice', () => {
  const firstOfEach: FixtureDataset = {
    ...bad,
    checks: bad.sites.flatMap((s) => {
      const first = bad.checks
        .filter((c) => c.site_id === s.id && c.finished_at !== null)
        .sort((x, y) => Date.parse(x.finished_at!) - Date.parse(y.finished_at!))[0];
      return first ? [first] : [];
    }),
  };

  it('names the site that stays and the ones that pause', () => {
    expect(isFirstRun(viewAt(firstOfEach, viewer))).toBe(true);
    expect(railNote(firstOfEach)).toBe(
      "No card on file. Then Free: example-outfitter.com keeps monthly checks; the other three sites pause until you choose Pro or remove them. Nothing you can see is deleted. We'll email you three days before.",
    );
  });
});
