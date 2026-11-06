import { describe, expect, it } from 'vitest';
import { FixtureDatasetSchema } from '@crawlmouse/types/v2';
import { fixture } from '../fixtures';
import { firstRunNow, primarySite, resultChecks, viewAt, type Viewer } from './account';

const BAD_ACCOUNT = 'a0000000-0000-4000-8000-000000000001';
const C9 = 'a0000000-0000-4000-8000-0000000000c9';

describe('viewAt', () => {
  const d = fixture('bad-site');

  it('opens the first-run dashboard when the account begins, not before it exists', () => {
    // The first audit finished at 02:34Z; the account and its trial began at 02:41Z (Q9).
    expect(firstRunNow(d, { accountId: BAD_ACCOUNT })).toBe('2026-10-25T02:41:00Z');
    expect(() => viewAt(d, { accountId: BAD_ACCOUNT, now: '2026-10-25T02:40:00Z' })).toThrow(
      /did not exist/,
    );
  });

  it('holds, at day 0, one site, one check, one first-audit change and thirteen fixes', () => {
    const v = viewAt(d, {
      accountId: BAD_ACCOUNT,
      now: firstRunNow(d, { accountId: BAD_ACCOUNT }),
    });
    expect(v.d.sites.map((s) => s.host)).toEqual(['example-outfitter.com']);
    expect(v.d.checks.map((c) => c.trigger)).toEqual(['first_audit']);
    // Change 7, a first-audit finding, is there; it is not a change since anything (dashboard).
    expect(v.d.changes.map((c) => c.previous_check_id)).toEqual([null]);
    // Fixes 1 to 13 were first seen at the first audit; 0, 14 and 15 at Friday's check.
    expect(v.d.fixes.map((f) => f.number).sort((a, b) => a - b)).toEqual([
      1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13,
    ]);
    // Fix 2 was marked done on Wednesday, after day 0: it reads open then.
    expect(v.d.fixes.find((f) => f.number === 2)!.status).toBe('open');
    expect(v.account.state).toBe('pro_trial');
  });

  it('keeps a check that has not finished by now out of the history, and says it is under way', () => {
    // drivepei.ca's manual check is queued at as_of.
    const v = viewAt(d, { accountId: BAD_ACCOUNT, now: d.as_of });
    expect(v.d.checks.some((c) => c.status === 'queued')).toBe(false);
    expect(v.inFlight).toEqual([
      { siteId: '50000000-0000-4000-8000-000000000004', status: 'queued' },
    ]);
    // 10:01:00Z: Friday's checks of three sites have started and not finished.
    const mid = viewAt(d, { accountId: BAD_ACCOUNT, now: '2026-10-30T10:01:00Z' });
    expect(mid.inFlight.map((f) => f.status)).toEqual(['running', 'running', 'running', 'running']);
  });

  it('holds a check, and the changes it found, from the instant it finished', () => {
    // Friday's check of example-outfitter.com finished at 10:02:00Z; its four changes carry that
    // same instant. A millisecond before, none of them is there.
    const at = viewAt(d, { accountId: BAD_ACCOUNT, now: '2026-10-30T10:02:00Z' });
    expect(at.d.checks.map((c) => c.id)).toContain('c0000000-0000-4000-8000-000000000006');
    expect(at.d.changes.filter((c) => c.detected_at === '2026-10-30T10:02:00Z')).toHaveLength(4);
    const before = viewAt(d, { accountId: BAD_ACCOUNT, now: '2026-10-30T10:01:59.999Z' });
    expect(before.d.checks.map((c) => c.id)).not.toContain('c0000000-0000-4000-8000-000000000006');
    expect(before.d.changes.filter((c) => c.detected_at === '2026-10-30T10:02:00Z')).toEqual([]);
  });

  it('shows only the viewer’s own account', () => {
    const c = fixture('challenged-site');
    const v = viewAt(c, { accountId: C9, now: c.as_of });
    expect(v.d.sites.map((s) => s.host)).toEqual(['granitepeak.example', 'harborlight.example']);
    expect(v.d.accounts.map((a) => a.id)).toEqual([C9]);
    expect(v.d.checks.every((ch) => v.d.sites.some((s) => s.id === ch.site_id))).toBe(true);
  });

  it('reads past_due as the tier it had, within the seven-day grace (J3)', () => {
    const c = fixture('challenged-site');
    expect(viewAt(c, { accountId: C9, now: c.as_of }).tier).toBe('agency');
    // past_due since 1 Nov 14:00Z; grace ends 8 Nov 14:00Z.
    expect(viewAt(c, { accountId: C9, now: '2026-11-08T14:00:00Z' }).tier).toBe('free');
  });

  it('is a valid dataset at every moment it is asked for', () => {
    for (const now of [
      firstRunNow(d, { accountId: BAD_ACCOUNT }),
      '2026-10-28T20:03:00Z',
      d.as_of,
    ]) {
      const v = viewAt(d, { accountId: BAD_ACCOUNT, now });
      expect(() => FixtureDatasetSchema.parse(v.d)).not.toThrow();
    }
  });

  it('lets a preview adopt an unkept audit under a stated account', () => {
    const c = fixture('clean-site');
    const site = c.sites[0]!;
    const account = {
      ...fixture('bad-site').accounts[0]!,
      id: 'a0000000-0000-4000-8000-0000000000ff',
    };
    const viewer: Viewer = { accountId: account.id, now: c.as_of, account, adopt: [site.id] };
    const v = viewAt(c, viewer);
    expect(v.d.sites.map((s) => s.account_id)).toEqual([account.id]);
    expect(() => viewAt(c, { accountId: account.id, now: c.as_of })).toThrow(/No account/);
  });
});

describe('a fix’s status at a moment', () => {
  const VIEWERS = {
    'bad-site': { accountId: BAD_ACCOUNT },
    'challenged-site': { accountId: C9 },
  } as const;

  it.each(Object.keys(VIEWERS) as (keyof typeof VIEWERS)[])(
    '%s: read at its own as_of, every fix keeps the status, last state and rank the fixture records',
    (name) => {
      const d = fixture(name);
      const v = viewAt(d, { ...VIEWERS[name], now: d.as_of });
      for (const f of v.d.fixes) {
        const recorded = d.fixes.find((x) => x.id === f.id)!;
        expect([f.status, f.last_state, f.rank], `fix ${f.number}`).toEqual([
          recorded.status,
          recorded.last_state,
          recorded.rank,
        ]);
      }
    },
  );

  // The contract: status follows the fix's last event (packages/types/src/v2/fix.ts). One case per
  // event kind, so the mapping is checked for each kind, not only those the fixtures happen to hold.
  it.each([
    ['marked_done', 'marked_done'],
    ['verified', 'verified_resolved'],
    ['unable_to_verify', 'unable_to_verify'],
    ['reopened', 'reopened'],
  ] as const)('a last event %s reads as %s', (kind, status) => {
    const d = structuredClone(fixture('bad-site'));
    const fix = d.fixes.find((f) => f.number === 3)!; // open, no events of its own
    const check = 'c0000000-0000-4000-8000-000000000005';
    d.fix_events.push(
      kind === 'marked_done'
        ? {
            id: 'b0000000-0000-4000-8000-0000000000f0',
            fix_id: fix.id,
            at: '2026-10-29T12:42:15Z',
            kind,
            by_seat_id: null,
          }
        : {
            id: 'b0000000-0000-4000-8000-0000000000f0',
            fix_id: fix.id,
            at: '2026-10-29T12:42:15Z',
            kind,
            check_id: check,
          },
    );
    const v = viewAt(d, { accountId: BAD_ACCOUNT, now: '2026-10-29T13:00:00Z' });
    const seen = v.d.fixes.find((f) => f.id === fix.id)!;
    expect(seen.status).toBe(status);
    expect(() => FixtureDatasetSchema.parse(v.d)).not.toThrow();
  });
});

describe('the primary site and its result checks', () => {
  const d = fixture('bad-site');
  const v = viewAt(d, { accountId: BAD_ACCOUNT, now: d.as_of });

  it('is the oldest site that is not a staging copy (ARCH-2 §3.2, the one kept on Free)', () => {
    expect(primarySite(v).host).toBe('example-outfitter.com');
  });

  it('lists the checks with a result, oldest first', () => {
    expect(resultChecks(v, primarySite(v).id).map((c) => c.trigger)).toEqual([
      'first_audit',
      'manual',
      'manual',
      'fix_recheck',
      'manual',
      'scheduled',
    ]);
  });
});
