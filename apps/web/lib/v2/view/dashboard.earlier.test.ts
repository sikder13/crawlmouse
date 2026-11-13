/**
 * CC-36 D5: the dashboard's "Your earlier audits are still at their links" line, for a viewer whose
 * own user id has v1 audits. The dates are worked out by hand in the account's zone
 * (bad-site: America/Indiana/Indianapolis), so a test cannot pass by agreeing with the code.
 */
import { describe, expect, it } from 'vitest';
import { fixture } from '../fixtures';
import { dashboardView, type EarlierAudit } from './dashboard';
import { noSiteDataset } from '../../../app/(v2-preview)/v2-preview/_preview/accounts';

const BAD_ACCOUNT = 'a0000000-0000-4000-8000-000000000001';
const bad = fixture('bad-site');
const viewer = { accountId: BAD_ACCOUNT, now: bad.as_of };

const EARLIER: EarlierAudit[] = [
  {
    id: 'c0000000-0000-4000-8000-000000000002',
    url: 'https://www.shop.example/collections/',
    grade: 'B',
    // 03:30Z on 14 Jun is 23:30 on 13 Jun in Indiana (EDT, UTC−4).
    completedAt: '2026-06-14T03:30:00.000Z',
  },
  {
    id: 'c0000000-0000-4000-8000-000000000001',
    url: 'https://blog.example/',
    grade: null,
    // 15:00Z on 2 Nov is 10:00 on 2 Nov in Indiana (EST, UTC−5).
    completedAt: '2026-11-02T15:00:00.000Z',
  },
];

describe('the earlier-audits line', () => {
  it('is absent for a viewer with no earlier audits, in the empty and the sites state', () => {
    expect(dashboardView(noSiteDataset(), viewer).earlier).toBeNull();
    expect(dashboardView(bad, viewer, undefined, []).earlier).toBeNull();
  });

  it('in the empty state lists each earlier audit: host, date in the account’s zone, earlier grade, its v1 link', () => {
    const v = dashboardView(noSiteDataset(), viewer, undefined, EARLIER);
    expect(v.earlier).toEqual({
      line: 'Your earlier audits are still at their links',
      label: 'Earlier audits',
      rows: [
        {
          key: 'c0000000-0000-4000-8000-000000000002',
          host: 'www.shop.example',
          date: '13 Jun 2026',
          grade: 'earlier grade B',
          href: '/audit/c0000000-0000-4000-8000-000000000002',
        },
        {
          key: 'c0000000-0000-4000-8000-000000000001',
          host: 'blog.example',
          date: '2 Nov 2026',
          grade: 'not graded',
          href: '/audit/c0000000-0000-4000-8000-000000000001',
        },
      ],
    });
  });

  it('in the sites state carries the same line, in the order the reader gave', () => {
    const v = dashboardView(bad, viewer, undefined, EARLIER);
    expect(v.sites.rows.length).toBeGreaterThan(0);
    expect(v.earlier?.line).toBe('Your earlier audits are still at their links');
    expect(v.earlier?.rows.map((r) => r.host)).toEqual(['www.shop.example', 'blog.example']);
  });

  it('a url that does not parse is shown as stored rather than dropped', () => {
    const v = dashboardView(noSiteDataset(), viewer, undefined, [
      { ...EARLIER[0]!, url: 'not a url' },
    ]);
    expect(v.earlier?.rows[0]?.host).toBe('not a url');
  });
});
