/**
 * The account frame on the pages CC-28 makes live reads the reader's own seat role (spec 27b known
 * gaps): the rail's trial card offers Keep and Billing to the owner only, so a developer reading
 * Alerts, the Changes log, the dashboard or a site's first-check page gets neither. (The site page
 * with a result takes its frame from app/sites/[id]/page.tsx.)
 */
import { describe, expect, it } from 'vitest';
import { ACCOUNT_VIEWERS } from '../../../app/(v2-preview)/v2-preview/_preview/accounts';
import { fixture } from '../fixtures';
import { alertsView } from './alerts';
import { changesLogView } from './changes-log';
import { dashboardView } from './dashboard';
import { sitePage } from './site';

const OUTFITTER = '50000000-0000-4000-8000-000000000001';
const DEVELOPER = 'e0000000-0000-4000-8000-0000000000d1';

// bad-site at its as_of is in its Pro trial past the first run: the owner's card carries Keep.
const d = structuredClone(fixture('bad-site'));
const owner = d.seats[0]!;
d.seats.push({ ...owner, id: DEVELOPER, email: 'dev@company.com', role: 'developer' });

// A site with no check yet: its page is the first-check view, which carries its own frame.
const fresh = structuredClone(d);
fresh.checks = fresh.checks.filter((c) => c.site_id !== OUTFITTER);
fresh.changes = fresh.changes.filter((c) => fresh.checks.some((k) => k.id === c.check_id));
fresh.fixes = fresh.fixes.filter((f) => fresh.checks.some((k) => k.id === f.first_seen_check_id));

const shells = (seatId: string) => {
  const viewer = { ...ACCOUNT_VIEWERS.home(), seatId };
  const first = sitePage(fresh, viewer, OUTFITTER);
  if (first.kind !== 'first_check') throw new Error('expected the first-check page');
  return {
    alerts: alertsView(d, viewer).shell,
    changes: changesLogView(d, viewer, {}, '/changes').shell,
    dashboard: dashboardView(d, viewer).shell,
    firstCheck: first.first.shell,
  };
};

describe('the rail’s trial card by the reader’s seat', () => {
  it('the owner’s seat is offered Keep on every page', () => {
    for (const [page, shell] of Object.entries(shells(owner.id))) {
      expect(shell.trial?.keep, page).toMatchObject({ href: '/api/billing/checkout' });
    }
  });

  it('a developer’s seat is offered neither Keep nor Billing on any page', () => {
    for (const [page, shell] of Object.entries(shells(DEVELOPER))) {
      expect(shell.trial, page).not.toBeNull();
      expect([shell.trial!.keep, shell.trial!.billing], page).toEqual([null, null]);
    }
  });
});
