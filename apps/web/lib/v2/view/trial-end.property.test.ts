/**
 * Trial ending over generated two-account datasets, read by the bad-site account at any moment of
 * its trial: "Checks run" and "Changes caught" are the reader's checks finished and changes opened or
 * resolved between the trial's start and `now`, worked out from the raw dataset; the stays and
 * pauses together name every site the reader holds; nothing of the other account appears.
 */
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { instant } from '@crawlmouse/types/v2';
import { BAD, accountReads, sitesOf } from '../../../__tests__/v2/_lib/account-datasets';
import { trialEndView } from './trial-end';

describe('Trial ending, generated', () => {
  it('counts the window’s checks and changes from the rows, and names every site the reader holds', () => {
    const reached = new Set<string>();
    fc.assert(
      fc.property(accountReads, ({ d, viewer, other }) => {
        const now = instant(viewer.now);
        const mine = sitesOf(d, BAD);
        const live = d.sites.filter((s) => mine.has(s.id) && instant(s.created_at) <= now);
        const account = d.accounts.find((a) => a.id === BAD)!;
        const start = instant(account.state_history.at(-1)!.since);
        fc.pre(viewer.accountId === BAD && now >= start);
        fc.pre(live.some((s) => s.staging_of_site_id === null));
        const v = trialEndView(d, viewer);

        const ended = d.checks.filter(
          (c) =>
            live.some((s) => s.id === c.site_id) &&
            c.finished_at !== null &&
            instant(c.finished_at) >= start &&
            instant(c.finished_at) <= now &&
            instant(c.queued_at) <= now,
        );
        const endedIds = new Set(
          d.checks
            .filter((c) => live.some((s) => s.id === c.site_id))
            .filter((c) => c.finished_at !== null && instant(c.finished_at) <= now)
            .map((c) => c.id),
        );
        const caught = d.changes.filter(
          (c) =>
            endedIds.has(c.check_id) &&
            (c.kind === 'opened' || c.kind === 'resolved') &&
            instant(c.detected_at) >= start &&
            instant(c.detected_at) <= now,
        );
        const [checks, changes] = v.did.rows;
        expect(checks!.value).toBe(String(ended.length));
        expect(changes!.value).toBe(String(caught.length));

        const named = [...v.stays, ...v.pauses].map((r) => r.what).join(' | ');
        for (const s of live)
          expect(named.split(s.host).length - 1, s.host).toBeGreaterThanOrEqual(1);
        for (const s of d.sites.filter((x) => x.account_id === other)) {
          expect(named.includes(s.host), s.host).toBe(false);
        }
        reached.add(ended.length ? 'checks' : 'no checks');
        if (caught.length) reached.add('changes');
      }),
      { numRuns: 300 },
    );
    expect([...reached].sort()).toEqual(['changes', 'checks', 'no checks']);
  });
});
