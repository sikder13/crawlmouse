/**
 * Settings over generated two-account datasets: the plan card's counts are the reader's primary
 * sites and the most pages any of its latest results crawled, worked out from the raw dataset; the
 * deletion names every site it removes; the email kinds are CC-25's three.
 */
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { instant } from '@crawlmouse/types/v2';
import { EMAIL_KINDS } from '../../auth/constants';
import { numberWord } from '../words';
import { accountReads, sitesOf } from '../../../__tests__/v2/_lib/account-datasets';
import { settingsView } from './settings';

describe('Settings, generated', () => {
  it('counts the reader’s slots, its largest crawl and the sites a deletion removes', () => {
    fc.assert(
      fc.property(accountReads, ({ d, viewer }) => {
        const v = settingsView(d, viewer);
        const now = instant(viewer.now);
        const mine = sitesOf(d, viewer.accountId);
        const live = d.sites.filter((s) => mine.has(s.id) && instant(s.created_at) <= now);
        const latestPages = live.map((s) => {
          const results = d.checks
            .filter((c) => c.site_id === s.id && c.finished_at && instant(c.finished_at) <= now)
            .filter((c) => c.status === 'finished' || c.status === 'partial')
            .sort((a, b) => instant(a.finished_at!) - instant(b.finished_at!));
          return results.at(-1)?.coverage?.pages_crawled ?? 0;
        });
        const [sites, pages] = v.plan.usage.map(([, value]) => value);
        expect(sites).toMatch(
          new RegExp(`^${live.filter((s) => s.staging_of_site_id === null).length} of `),
        );
        expect(pages).toMatch(
          new RegExp(`^${Math.max(0, ...latestPages).toLocaleString('en-US')} of `),
        );
        expect(v.danger.text).toContain(
          live.length === 0
            ? 'Removes the account and its reports.'
            : live.length === 1
              ? 'Removes the site,'
              : `Removes all ${numberWord(live.length)} sites,`,
        );
        expect(v.email.rows.map((r) => r.kind)).toEqual([...EMAIL_KINDS]);
        expect(
          v.header.line.startsWith(d.accounts.find((a) => a.id === viewer.accountId)!.email),
        ).toBe(true);
      }),
      { numRuns: 300 },
    );
  });
});
