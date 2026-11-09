/**
 * Generated two-account datasets for CC-27's property tests: bad-site and challenged-site merged
 * (their ids do not collide), with any subset of the sites moved to the other account (a staging
 * copy with the site it copies), read by
 * either account at any moment both accounts exist. A view reading one account must show nothing
 * of the other, whichever sites it holds, including none.
 */
import fc from 'fast-check';
import { instant, type FixtureDataset } from '@crawlmouse/types/v2';
import { fixture } from '../../../lib/v2/fixtures';
import type { Viewer } from '../../../lib/v2/view/account';

export const BAD = 'a0000000-0000-4000-8000-000000000001';
export const NORTHWIND = 'a0000000-0000-4000-8000-0000000000c9';

const bad = fixture('bad-site');
const challenged = fixture('challenged-site');

const KEYS = [
  'accounts',
  'seats',
  'sites',
  'checks',
  'page_results',
  'link_edges',
  'access_tests',
  'fixes',
  'fix_events',
  'changes',
  'alert_rules',
  'reports',
  'usage_events',
  'withheld',
] as const satisfies readonly (keyof FixtureDataset)[];

/** The two fixtures as one dataset, as of the later one. */
export const MERGED: FixtureDataset = {
  ...bad,
  as_of: challenged.as_of,
  ...Object.fromEntries(KEYS.map((k) => [k, [...bad[k], ...challenged[k]]])),
} as FixtureDataset;

/** The sites that can move: a staging copy moves with the site it copies, never on its own. */
const OWNED = MERGED.sites.filter(
  (s) => (s.account_id === BAD || s.account_id === NORTHWIND) && s.staging_of_site_id === null,
);

/** The moments both accounts exist: from the later account's start to the merged as_of. */
const START = Math.max(
  ...[BAD, NORTHWIND].map((id) =>
    instant(MERGED.accounts.find((a) => a.id === id)!.state_history[0]!.since),
  ),
);
const END = instant(MERGED.as_of);

export interface AccountRead {
  d: FixtureDataset;
  viewer: Viewer;
  /** The other account, whose records must not appear. */
  other: string;
}

/** A generated dataset and who reads it when. */
export const accountReads: fc.Arbitrary<AccountRead> = fc
  .record({
    moved: fc.subarray(OWNED.map((s) => s.id)),
    reader: fc.constantFrom(BAD, NORTHWIND),
    now: fc.oneof(
      fc.integer({ min: START, max: END }),
      fc.constantFrom(START, END, instant(bad.as_of), instant(bad.as_of) + 1),
    ),
  })
  .map(({ moved, reader, now }) => {
    const swap = new Set([
      ...moved,
      ...MERGED.sites.filter((s) => moved.includes(s.staging_of_site_id ?? '')).map((s) => s.id),
    ]);
    const d: FixtureDataset = {
      ...MERGED,
      sites: MERGED.sites.map((s) =>
        swap.has(s.id) ? { ...s, account_id: s.account_id === BAD ? NORTHWIND : BAD } : s,
      ),
    };
    const read: AccountRead = {
      d,
      viewer: { accountId: reader, now: new Date(now).toISOString() },
      other: reader === BAD ? NORTHWIND : BAD,
    };
    // A counterexample names what was generated, not the whole dataset.
    return Object.assign(read, {
      [fc.toStringMethod]: () =>
        `read by ${reader.slice(-3)} at ${read.viewer.now}, sites moved: [${moved.map((m) => m.slice(-3)).join(', ')}]`,
    });
  });

/** The ids of the sites `accountId` holds in `d`. */
export const sitesOf = (d: FixtureDataset, accountId: string) =>
  new Set(d.sites.filter((s) => s.account_id === accountId).map((s) => s.id));
