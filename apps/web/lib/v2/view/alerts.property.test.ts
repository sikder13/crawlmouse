/**
 * Alerts over generated two-account datasets: the Fired rows are the reader's changes notified by
 * `now`, nothing else; the header's email count is the number of messages that carried email,
 * worked out from the raw dataset; the rows add up to the messages; nothing of the other account
 * appears.
 */
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { instant } from '@crawlmouse/types/v2';
import { accountReads, sitesOf } from '../../../__tests__/v2/_lib/account-datasets';
import { alertsView } from './alerts';

describe('Alerts, generated', () => {
  it('sends only what was sent by now, to the reader, and counts emails by message', () => {
    const reached = new Set<string>();
    fc.assert(
      fc.property(accountReads, ({ d, viewer, other }) => {
        const v = alertsView(d, viewer);
        const now = instant(viewer.now);
        const mine = sitesOf(d, viewer.accountId);
        const siteOf = new Map(d.checks.map((c) => [c.id, c.site_id]));
        const live = new Set(
          d.sites.filter((s) => mine.has(s.id) && instant(s.created_at) <= now).map((s) => s.id),
        );
        const sent = d.changes.filter((c) => {
          const check = d.checks.find((k) => k.id === c.check_id)!;
          return (
            live.has(check.site_id) &&
            check.finished_at !== null &&
            instant(check.finished_at) <= now &&
            instant(c.detected_at) <= now &&
            c.notified !== null &&
            instant(c.notified.sent_at) <= now
          );
        });
        expect(v.fired.rows.map((r) => r.key).sort()).toEqual(sent.map((c) => c.id).sort());
        const emailMessages = new Set(
          sent
            .filter((c) => c.notified!.channels.includes('email'))
            .map((c) => `${siteOf.get(c.check_id)} ${c.check_id}`),
        );
        if (emailMessages.size) {
          expect(v.header.line).toMatch(new RegExp(`^${emailMessages.size} emails? since`));
          reached.add('emails');
        } else reached.add(sent.length ? 'slack only' : 'nothing sent');
        expect(v.fired.messages.flatMap((m) => m.rows)).toEqual(v.fired.rows);
        const otherHosts = new Set(
          d.sites.filter((s) => s.account_id === other).map((s) => s.host),
        );
        for (const r of v.fired.rows) expect(otherHosts.has(r.site)).toBe(false);
        expect(v.header.actions.filter((a) => a.primary).length).toBeLessThanOrEqual(1);
      }),
      { numRuns: 300 },
    );
    expect([...reached].sort()).toEqual(['emails', 'nothing sent', 'slack only']);
  });
});
