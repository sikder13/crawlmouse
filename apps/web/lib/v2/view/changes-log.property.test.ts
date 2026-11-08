/**
 * The Changes log over generated two-account datasets (__tests__/v2/_lib/account-datasets.ts): its
 * rows are exactly the reader's changes found by `now`, under any filter; its headline counts the
 * rows it shows; and nothing of the other account appears.
 */
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { instant } from '@crawlmouse/types/v2';
import { MERGED, accountReads, sitesOf } from '../../../__tests__/v2/_lib/account-datasets';
import { changesLogView, CHANGES_LOG_SINCE, type ChangesLogView } from './changes-log';

const siteLinks = (v: ChangesLogView) => v.filters[0]!.links;

const KINDS = ['opened', 'resolved', 'changed', 'baseline'] as const;

describe('the Changes log, generated', () => {
  it('shows the reader’s changes found by now, filtered as asked, and counts what it shows', () => {
    const reached = new Set<string>();
    fc.assert(
      fc.property(
        accountReads,
        fc.option(fc.constantFrom(...KINDS), { nil: undefined }),
        fc.constantFrom(...CHANGES_LOG_SINCE.map((s) => s.key)),
        fc.nat(),
        ({ d, viewer, other }, kind, since, pick) => {
          const mine = sitesOf(d, viewer.accountId);
          const site = pick % 3 === 0 ? undefined : [...mine][pick % Math.max(mine.size, 1)];
          const v = changesLogView(d, viewer, { kind, since, site }, '/x');
          const now = instant(viewer.now);
          const days = CHANGES_LOG_SINCE.find((s) => s.key === since)!.days;
          // The rows worked out from the raw dataset, without the view's helpers.
          const checkSite = new Map(d.checks.map((c) => [c.id, c.site_id]));
          const ended = new Set(
            d.checks.filter((c) => c.finished_at && instant(c.finished_at) <= now).map((c) => c.id),
          );
          const live = new Set(
            d.sites.filter((s) => mine.has(s.id) && instant(s.created_at) <= now).map((s) => s.id),
          );
          const expected = d.changes
            .filter((c) => ended.has(c.check_id) && live.has(checkSite.get(c.check_id)!))
            .filter((c) => instant(c.detected_at) <= now)
            .filter((c) => !kind || c.kind === kind)
            // A site the account does not hold at now is ignored, as the view documents.
            .filter((c) => !site || !live.has(site) || checkSite.get(c.check_id) === site)
            .filter((c) => days === null || instant(c.detected_at) >= now - days * 86_400_000)
            .map((c) => c.id)
            .sort();
          expect([...v.rows.map((r) => r.key)].sort()).toEqual(expected);
          reached.add(v.rows.length ? 'rows' : 'no rows');
          if (site && live.has(site)) reached.add('a site filter applied');
          const before = new Map(MERGED.sites.map((s) => [s.id, s.account_id]));
          if (d.sites.some((s) => s.account_id === viewer.accountId && before.get(s.id) === other))
            reached.add('another account’s site moved in');
          if (v.rows.length) expect(v.headline).toMatch(new RegExp(`^${v.rows.length}\\b`));
          else expect(v.empty).not.toBeNull();
          const otherHosts = new Set(
            d.sites.filter((s) => s.account_id === other).map((s) => s.host),
          );
          for (const r of v.rows) expect(otherHosts.has(r.site!)).toBe(false);
          for (const l of siteLinks(v).slice(1)) expect(otherHosts.has(l.label)).toBe(false);
        },
      ),
      { numRuns: 300 },
    );
    expect([...reached].sort()).toEqual(
      ['a site filter applied', 'another account’s site moved in', 'no rows', 'rows'].sort(),
    );
  });
});
