/**
 * What the trial's end does to an oldest site the person paused (`apply_entitlement_transition`,
 * migration 003): it is not changed and it keeps its place, so it stays paused and no site takes the
 * monthly check. Trial ending and the rail must not say it "keeps" one. On a trial the oldest primary
 * site can only be paused by the person: `pause_others` and `pause_over_limit` never pause it.
 */
import type { FixtureDataset } from '@crawlmouse/types/v2';
import { describe, expect, it } from 'vitest';
import { ACCOUNT_VIEWERS } from '../../../app/(v2-preview)/v2-preview/_preview/accounts';
import { fixture } from '../fixtures';
import { viewAt } from './account';
import { accountShellView } from './account-shell';
import { trialEndView, trialEndViewer } from './trial-end';

const BAD = 'a0000000-0000-4000-8000-000000000001';
const OLDEST = '50000000-0000-4000-8000-000000000001';
const bad = fixture('bad-site');

const oldestPaused: FixtureDataset = {
  ...bad,
  sites: bad.sites.map((s) => (s.id === OLDEST ? { ...s, paused: true } : s)),
};

const page = (d: FixtureDataset) => trialEndView(d, trialEndViewer(d, BAD), { billingOpen: true });
const rail = (d: FixtureDataset) =>
  accountShellView(viewAt(d, ACCOUNT_VIEWERS.home()), 'Sites', {
    role: 'owner',
    billingOpen: true,
  }).trial!.note;

describe('Trial ending, the oldest site paused by the person', () => {
  it('lists it as staying paused, with no check', () => {
    const row = page(oldestPaused).stays.find((r) => r.what === 'example-outfitter.com')!;
    expect(row.how).toBe('stays paused, as you left it');
  });

  it('says so in what happens at the end', () => {
    expect(page(oldestPaused).endText).toContain(
      'example-outfitter.com stays paused, as you left it, so no site keeps a scheduled check, and it keeps its three fixes.',
    );
    expect(page(oldestPaused).endText).not.toContain('keeps its monthly check');
  });

  it('does not promise it email after each check', () => {
    const alerts = page(oldestPaused).stays.filter((r) => r.what.startsWith('Alerts on'));
    expect(alerts).toEqual([]);
  });

  it('is unchanged for a running oldest site', () => {
    expect(page(bad).endText).toContain('example-outfitter.com keeps its monthly check');
    const row = page(bad).stays.find((r) => r.what === 'example-outfitter.com')!;
    expect(row.how).toMatch(/^monthly checks/);
  });
});

describe('the rail, the oldest site paused by the person', () => {
  it('does not say it keeps checks', () => {
    expect(rail(oldestPaused)).toContain(
      'Then Free: example-outfitter.com stays paused, as you left it;',
    );
    expect(rail(oldestPaused)).not.toContain('keeps monthly checks');
  });

  it('is unchanged for a running oldest site', () => {
    expect(rail(bad)).toContain('Then Free: example-outfitter.com keeps monthly checks;');
  });

  it('on a first run with that one site, says it stays paused', () => {
    const first = bad.checks
      .filter((c) => c.site_id === OLDEST && c.finished_at !== null)
      .sort((x, y) => Date.parse(x.finished_at!) - Date.parse(y.finished_at!))[0]!;
    const oneSite: FixtureDataset = {
      ...oldestPaused,
      sites: oldestPaused.sites.filter((s) => s.id === OLDEST),
      checks: [first],
    };
    expect(rail(oneSite)).toBe(
      'No card on file. When it ends, this site stays on Free, paused as you left it. Nothing you can see is deleted.',
    );
  });
});
