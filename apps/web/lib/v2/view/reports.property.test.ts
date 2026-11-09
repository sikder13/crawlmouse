/**
 * Reports over generated two-account datasets: "Reports made" and "Scheduled" are the reader's
 * reports by `now`, split by status, the public link left out; the header's site count is the
 * reader's sites; nothing of the other account appears; making needs the exports gate.
 */
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { instant } from '@crawlmouse/types/v2';
import { accountReads, sitesOf } from '../../../__tests__/v2/_lib/account-datasets';
import { reportsView } from './reports';

describe('Reports, generated', () => {
  it('lists the reader’s reports by now and nothing else, and counts the reader’s sites', () => {
    const reached = new Set<string>();
    fc.assert(
      fc.property(accountReads, ({ d, viewer, other }) => {
        const v = reportsView(d, viewer, {}, '/x');
        const now = instant(viewer.now);
        const mine = sitesOf(d, viewer.accountId);
        const live = d.sites.filter((s) => mine.has(s.id) && instant(s.created_at) <= now);
        const ended = new Set(
          d.checks.filter((c) => c.finished_at && instant(c.finished_at) <= now).map((c) => c.id),
        );
        const reports = d.reports.filter(
          (r) =>
            r.account_id === viewer.accountId &&
            live.some((s) => s.id === r.site_id) &&
            instant(r.created_at) <= now &&
            r.covers_check_ids.every((id) => ended.has(id)),
        );
        const made = reports.filter(
          (r) => r.kind !== 'public_link' && (r.status === 'ready' || r.status === 'sent'),
        );
        const scheduled = reports.filter((r) => r.status === 'scheduled' || r.status === 'held');
        expect(v.made.rows.map((r) => r.key).sort()).toEqual(made.map((r) => r.id).sort());
        expect(v.scheduled.rows.map((r) => r.key).sort()).toEqual(
          scheduled.map((r) => r.id).sort(),
        );
        expect(v.header.line).toMatch(new RegExp(`^${live.length} sites? · `));
        const otherHosts = new Set(
          d.sites.filter((s) => s.account_id === other).map((s) => s.host),
        );
        for (const r of [...v.made.rows, ...v.scheduled.rows])
          expect(otherHosts.has(r.site)).toBe(false);
        for (const o of v.make.sites) expect(otherHosts.has(o.label)).toBe(false);
        if (v.make.pdf.action?.primary) expect(v.make.pdf.action.href).toBe('/api/reports');
        reached.add(made.length ? 'made' : 'none made');
        if (scheduled.length) reached.add('scheduled');
      }),
      { numRuns: 300 },
    );
    expect([...reached].sort()).toEqual(['made', 'none made', 'scheduled']);
  });
});
