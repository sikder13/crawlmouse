/**
 * The lookups a view model needs that do not need the contract fixtures themselves: the dataset type,
 * a check by id, a check's site, and the fixes a finished check knew about. `fixtures.ts` re-exports
 * them. Nothing here imports the fixture JSON, so a production view model (the dashboard) can use
 * them without bundling the four datasets (`view/dashboard-imports.test.ts`).
 */
import { instant, type Check, type Fix, type FixtureDataset } from '@crawlmouse/types/v2';

/**
 * What a view function reads: the collections of a contract fixture, whatever says where they came
 * from. A fixture, a persisted check read back by the pipeline (`provenance: 'measured'`) and an
 * account's checks read together each satisfy it. No view reads `provenance`.
 */
export type ViewDataset = Omit<FixtureDataset, 'provenance'> & {
  provenance: 'fixture' | 'measured';
};

export function findCheck(d: ViewDataset, id: string): Check {
  const c = d.checks.find((x) => x.id === id);
  if (!c) throw new Error(`No check ${id} in the fixture`);
  return c;
}

export function siteOf(d: ViewDataset, check: Check) {
  const s = d.sites.find((x) => x.id === check.site_id);
  if (!s) throw new Error(`No site ${check.site_id} for check ${check.id}`);
  return s;
}

/**
 * The fixes a finished check knew about: first seen at or before it, and not resolved at its finish,
 * in the engine's order of impact. A fix is resolved when the latest `verified` or `reopened` event
 * at or before the finish is `verified`; marking a fix done is not a measurement and does not count.
 * Ranks are stored once, at each fix's last measured check, so an earlier check reuses that order
 * with the later fixes left out.
 */
export function fixesAsOf(d: ViewDataset, check: Check): Fix[] {
  if (check.finished_at === null) throw new Error(`Check ${check.id} has not finished`);
  const end = instant(check.finished_at);
  const queued = (id: string) => instant(findCheck(d, id).queued_at);
  const asOf = instant(check.queued_at);
  const resolvedBy = (fix: Fix) => {
    const measured = d.fix_events
      .filter((e) => e.fix_id === fix.id && (e.kind === 'verified' || e.kind === 'reopened'))
      .filter((e) => instant(e.at) <= end)
      .sort((a, b) => instant(a.at) - instant(b.at));
    return measured.at(-1)?.kind === 'verified';
  };
  return d.fixes
    .filter((f) => f.site_id === check.site_id && queued(f.first_seen_check_id) <= asOf)
    .filter((f) => !resolvedBy(f))
    .sort((a, b) => (a.rank ?? Infinity) - (b.rank ?? Infinity) || a.number - b.number);
}
