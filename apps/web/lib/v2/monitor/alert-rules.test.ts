/**
 * The alert rules (CC-28 D5): which of a check's changes each of the account's rules fires on. One
 * table per kind; property tests over generated changes and rules; and agreement with the fixtures,
 * whose notified rows were written by hand from the screens (bad-site's weekly check of
 * example-outfitter.com, challenged-site's text drop), and with the Alerts view's crawler verdicts.
 */
import fc from 'fast-check';
import type { Change, Verdict } from '@crawlmouse/types/v2';
import { describe, expect, it } from 'vitest';
import { fixture } from '../fixtures';
import { alertsView } from '../view/alerts';
import {
  BLOCKING_VERDICTS,
  evaluateAlerts,
  textDropPoints,
  type AlertChange,
  type AlertInput,
  type AlertRuleInput,
} from './alert-rules';

const SITE = '50000000-0000-4000-8000-000000000001';
const OTHER_SITE = '50000000-0000-4000-8000-000000000002';
const CHECK = 'c0000000-0000-4000-8000-000000000002';
const PREV = 'c0000000-0000-4000-8000-000000000001';
const OTHER_CHECK = 'c0000000-0000-4000-8000-000000000009';
const FIX = 'f0000000-0000-4000-8000-000000000001';

let n = 0;
const id = (prefix: string) => `${prefix}0000000-0000-4000-8000-${String(++n).padStart(12, '0')}`;

function change(o: Partial<AlertChange> = {}): AlertChange {
  return {
    id: id('9'),
    site_id: SITE,
    check_id: CHECK,
    kind: 'opened',
    subject: 'structure',
    ua: null,
    fix_id: null,
    grade_deltas: [],
    ...o,
  };
}

function rule(kind: AlertRuleInput['kind'], o: Partial<AlertRuleInput> = {}): AlertRuleInput {
  return {
    id: id('7'),
    site_id: null,
    kind,
    enabled: true,
    threshold_points: kind === 'text_drop' ? 10 : null,
    channels: ['email'],
    ...o,
  };
}

function input(o: Partial<AlertInput> = {}): AlertInput {
  return {
    siteId: SITE,
    checkId: CHECK,
    firstCheck: false,
    changes: [],
    rules: [],
    verdicts: { now: {}, before: {} },
    textShare: { before: null, now: null },
    fixEvents: [],
    ...o,
  };
}

const fired = (i: AlertInput) =>
  evaluateAlerts(i).map((a) => [a.kind, [...a.changeIds].sort()] as const);

describe('crawler_blocked: a crawler’s verdict at the check moved into a blocking one', () => {
  const r = rule('crawler_blocked');
  const crawler = (kind: Change['kind'], ua = 'GPTBot') =>
    change({ kind, subject: 'crawler_access', ua });
  it.each<[string, Change['kind'], Verdict | undefined, Verdict, boolean]>([
    ['allowed to disallowed by robots.txt', 'opened', 'allowed', 'disallowed_by_robots', true],
    ['allowed to a user-agent rule', 'opened', 'allowed', 'blocked_by_ua_rule', true],
    ['first measured, blocked', 'opened', undefined, 'blocked_by_ua_rule', true],
    ['challenged to blocked', 'changed', 'challenged_ua', 'blocked_by_ua_rule', true],
    [
      'allowed to challenged: lost access, not blocked',
      'opened',
      'allowed',
      'challenged_ua',
      false,
    ],
    ['allowed to rate limited', 'opened', 'allowed', 'rate_limited', false],
    ['one block to the other', 'changed', 'blocked_by_ua_rule', 'disallowed_by_robots', false],
    ['blocked to allowed', 'resolved', 'disallowed_by_robots', 'allowed', false],
  ])('%s', (_, kind, before, now, fires) => {
    const c = crawler(kind);
    const out = fired(
      input({
        changes: [c],
        rules: [r],
        verdicts: {
          now: { GPTBot: now },
          before: before === undefined ? {} : { GPTBot: before },
        },
      }),
    );
    expect(out).toEqual(fires ? [['crawler_blocked', [c.id]]] : []);
  });

  it('needs a crawler: robots.txt changing on its own does not fire', () => {
    const c = change({ kind: 'changed', subject: 'crawler_access', ua: null });
    expect(fired(input({ changes: [c], rules: [r] }))).toEqual([]);
  });

  it('names the verdicts the Alerts and Site views name for this rule', () => {
    const bad = fixture('bad-site');
    const view = alertsView(bad, {
      accountId: 'a0000000-0000-4000-8000-000000000001',
      now: bad.as_of,
    });
    const row = view.rules.rows.find((x) => x.label === 'A crawler becomes blocked');
    expect(row?.verdicts).toEqual([...BLOCKING_VERDICTS]);
  });
});

describe('text_drop: the site’s share of text without JavaScript fell by more than the threshold', () => {
  const opened = () => change({ kind: 'opened', subject: 'text_without_js' });
  it.each<[string, number | null, number | null, number, boolean]>([
    ['71% to 59% against 10 points', 0.71, 0.59, 10, true],
    ['exactly 10 points against 10: not more than', 0.7, 0.6, 10, false],
    ['10.1 points against 10', 0.701, 0.6, 10, true],
    ['a rise', 0.4, 0.6, 0, false],
    ['no earlier share', null, 0.2, 0, false],
    ['no share now', 0.9, null, 0, false],
  ])('%s', (_, before, now, threshold, fires) => {
    const c = opened();
    const out = fired(
      input({
        changes: [c],
        rules: [rule('text_drop', { threshold_points: threshold })],
        textShare: { before, now },
      }),
    );
    expect(out).toEqual(fires ? [['text_drop', [c.id]]] : []);
  });

  it('names only opened text-without-JavaScript rows, and needs one', () => {
    const resolved = change({ kind: 'resolved', subject: 'text_without_js' });
    const other = change({ kind: 'opened', subject: 'structure' });
    const i = input({
      rules: [rule('text_drop')],
      textShare: { before: 0.9, now: 0.1 },
      changes: [resolved, other],
    });
    expect(fired(i)).toEqual([]);
  });

  it('reads points as percentage points, rounded so float error cannot cross the threshold', () => {
    expect(textDropPoints({ before: 0.7, now: 0.6 })).toBe(10);
    expect(textDropPoints({ before: 0.71, now: 0.59 })).toBe(12);
    expect(textDropPoints({ before: null, now: 0.5 })).toBeNull();
  });
});

describe('grade_letter_moved: a grade’s letter moved, not only its plus or minus', () => {
  const delta = (from: string, to: string) =>
    change({
      kind: 'changed',
      subject: 'grade',
      grade_deltas: [
        {
          grade: 'ai_readability',
          from_score: 50,
          to_score: 40,
          from_grade: from as never,
          to_grade: to as never,
        },
      ],
    });
  it.each<[string, string, boolean]>([
    ['D', 'F', true],
    ['B+', 'C+', true],
    ['A-', 'B+', true],
    ['C', 'B', true],
    ['B', 'B+', false],
    ['B+', 'B-', false],
    ['C', 'C', false],
  ])('%s → %s', (from, to, fires) => {
    const c = delta(from, to);
    expect(fired(input({ changes: [c], rules: [rule('grade_letter_moved')] }))).toEqual(
      fires ? [['grade_letter_moved', [c.id]]] : [],
    );
  });
});

describe('new_orphans: an opened orphan-pages row', () => {
  it.each<[Change['kind'], Change['subject'], boolean]>([
    ['opened', 'orphans', true],
    ['resolved', 'orphans', false],
    ['opened', 'structure', false],
  ])('%s %s', (kind, subject, fires) => {
    const c = change({ kind, subject });
    expect(fired(input({ changes: [c], rules: [rule('new_orphans')] }))).toEqual(
      fires ? [['new_orphans', [c.id]]] : [],
    );
  });
});

describe('fix_regressed: a fix reopened at this check whose state before was marked done', () => {
  const reopened = (checkId = CHECK) => ({
    fix_id: FIX,
    kind: 'reopened' as const,
    at: '2026-11-10T10:00:00Z',
    check_id: checkId,
  });
  const marked = {
    fix_id: FIX,
    kind: 'marked_done' as const,
    at: '2026-11-09T10:00:00Z',
    check_id: null,
  };
  const unable = {
    fix_id: FIX,
    kind: 'unable_to_verify' as const,
    at: '2026-11-09T12:00:00Z',
    check_id: PREV,
  };
  const verified = {
    fix_id: FIX,
    kind: 'verified' as const,
    at: '2026-11-09T12:00:00Z',
    check_id: PREV,
  };
  it.each<[string, AlertInput['fixEvents'], boolean]>([
    ['marked done, then found again', [marked, reopened()], true],
    ['marked done, unverifiable, then found again', [marked, unable, reopened()], true],
    ['resolved by a check, then found again', [verified, reopened()], false],
    ['marked done, verified, then found again', [marked, verified, reopened()], false],
    ['reopened at another check', [marked, reopened(OTHER_CHECK)], false],
    ['never reopened', [marked], false],
  ])('%s', (_, events, fires) => {
    const c = change({ kind: 'opened', subject: 'structure', fix_id: FIX });
    expect(
      fired(input({ changes: [c], rules: [rule('fix_regressed')], fixEvents: events })),
    ).toEqual(fires ? [['fix_regressed', [c.id]]] : []);
  });

  it('orders the events by time, whatever order they are given in', () => {
    const c = change({ kind: 'opened', subject: 'structure', fix_id: FIX });
    expect(
      fired(
        input({ changes: [c], rules: [rule('fix_regressed')], fixEvents: [reopened(), marked] }),
      ),
    ).toEqual([['fix_regressed', [c.id]]]);
  });
});

describe('any_change: every row but a baseline', () => {
  it('fires on each kind of row except baseline', () => {
    const rows = (['opened', 'resolved', 'changed'] as const).map((kind) =>
      change({ kind, subject: 'content' }),
    );
    const base = change({ kind: 'baseline', subject: 'grade' });
    expect(fired(input({ changes: [...rows, base], rules: [rule('any_change')] }))).toEqual([
      ['any_change', rows.map((r) => r.id).sort()],
    ]);
  });
});

describe('which rule applies', () => {
  const orphan = () => change({ kind: 'opened', subject: 'orphans' });

  it('a disabled rule fires nothing', () => {
    expect(
      fired(input({ changes: [orphan()], rules: [rule('new_orphans', { enabled: false })] })),
    ).toEqual([]);
  });

  it('the site’s rule of a kind overrides the account’s, whichever is listed first', () => {
    const c = orphan();
    const account = rule('new_orphans', { channels: ['email', 'slack'] });
    const site = rule('new_orphans', { site_id: SITE, channels: ['slack'] });
    for (const rules of [
      [account, site],
      [site, account],
    ]) {
      expect(evaluateAlerts(input({ changes: [c], rules }))).toEqual([
        { ruleId: site.id, kind: 'new_orphans', channels: ['slack'], changeIds: [c.id] },
      ]);
    }
    const off = rule('new_orphans', { site_id: SITE, enabled: false });
    expect(fired(input({ changes: [c], rules: [account, off] }))).toEqual([]);
  });

  it('another site’s rule does not apply here', () => {
    expect(
      fired(input({ changes: [orphan()], rules: [rule('new_orphans', { site_id: OTHER_SITE })] })),
    ).toEqual([]);
  });

  it('a site’s first check fires nothing, its opened rows included', () => {
    expect(
      fired(input({ firstCheck: true, changes: [orphan()], rules: [rule('new_orphans')] })),
    ).toEqual([]);
  });

  it('a rule with no channel fires nothing', () => {
    expect(
      fired(input({ changes: [orphan()], rules: [rule('new_orphans', { channels: [] })] })),
    ).toEqual([]);
  });
});

describe('agreement with the fixtures’ notified rows', () => {
  it('bad-site: the weekly check of example-outfitter.com notified the two blocks and the letter, not the content', () => {
    const d = fixture('bad-site');
    const checkId = 'c0000000-0000-4000-8000-000000000006';
    const check = d.checks.find((c) => c.id === checkId)!;
    const prev = d.checks.find((c) => c.id === check.previous_check_id)!;
    const verdicts = (c: typeof check) =>
      Object.fromEntries(c.crawlers.map((x) => [x.ua, x.verdict]));
    const changes = d.changes.filter((c) => c.check_id === checkId);
    const out = evaluateAlerts({
      siteId: check.site_id,
      checkId,
      firstCheck: false,
      changes,
      rules: d.alert_rules,
      verdicts: { now: verdicts(check), before: verdicts(prev) },
      textShare: {
        before: prev.without_js?.site_text_share ?? null,
        now: check.without_js?.site_text_share ?? null,
      },
      fixEvents: d.fix_events,
    });
    const named = new Set(out.flatMap((a) => a.changeIds));
    expect([...named].sort()).toEqual(
      changes
        .filter((c) => c.notified)
        .map((c) => c.id)
        .sort(),
    );
    expect(out.map((a) => a.kind).sort()).toEqual(['crawler_blocked', 'grade_letter_moved']);
  });

  it('challenged-site: the 12-point text drop fired the 10-point rule, as its last_fired names', () => {
    const d = fixture('challenged-site');
    const checkId = 'c0000000-0000-4000-8000-0000000000ca';
    const check = d.checks.find((c) => c.id === checkId)!;
    const prev = d.checks.find((c) => c.id === check.previous_check_id)!;
    const out = evaluateAlerts({
      siteId: check.site_id,
      checkId,
      firstCheck: false,
      changes: d.changes.filter((c) => c.check_id === checkId),
      rules: d.alert_rules,
      verdicts: { now: {}, before: {} },
      textShare: {
        before: prev.without_js?.site_text_share ?? null,
        now: check.without_js?.site_text_share ?? null,
      },
      fixEvents: [],
    });
    const fired = d.alert_rules.filter((r) => r.last_fired_check_id === checkId).map((r) => r.id);
    expect(out.map((a) => a.ruleId)).toEqual(fired);
  });
});

// ── properties ──────────────────────────────────────────────────────────────────────────────────

const KINDS = ['opened', 'resolved', 'changed', 'baseline'] as const;
const SUBJECTS = [
  'crawler_access',
  'text_without_js',
  'grade',
  'orphans',
  'content',
  'structure',
  'deploy',
] as const;
const VERDICTS: Verdict[] = [
  'allowed',
  'allowed_thin',
  'disallowed_by_robots',
  'blocked_by_ua_rule',
  'challenged_ua',
  'rate_limited',
];
const LETTERS = ['A', 'A-', 'B+', 'B', 'B-', 'C+', 'C', 'C-', 'D+', 'D', 'D-', 'F'] as const;
const RULE_KINDS = [
  'crawler_blocked',
  'text_drop',
  'grade_letter_moved',
  'new_orphans',
  'fix_regressed',
  'any_change',
] as const;
const UAS = ['GPTBot', 'ClaudeBot'];

const arbChange = fc.record({
  id: fc.uuid(),
  site_id: fc.constantFrom(SITE, OTHER_SITE),
  check_id: fc.constantFrom(CHECK, OTHER_CHECK),
  kind: fc.constantFrom(...KINDS),
  subject: fc.constantFrom(...SUBJECTS),
  ua: fc.option(fc.constantFrom(...UAS), { nil: null }),
  fix_id: fc.option(fc.constant(FIX), { nil: null }),
  grade_deltas: fc.array(
    fc.record({
      grade: fc.constantFrom('technical_seo' as const, 'ai_readability' as const),
      from_score: fc.integer({ min: 0, max: 100 }),
      to_score: fc.integer({ min: 0, max: 100 }),
      from_grade: fc.constantFrom(...LETTERS),
      to_grade: fc.constantFrom(...LETTERS),
    }),
    { maxLength: 2 },
  ),
});

const arbRule = fc.record({
  id: fc.uuid(),
  site_id: fc.option(fc.constantFrom(SITE, OTHER_SITE), { nil: null }),
  kind: fc.constantFrom(...RULE_KINDS),
  enabled: fc.boolean(),
  threshold_points: fc.integer({ min: 0, max: 100 }),
  channels: fc.subarray(['email', 'slack'] as const),
});

const arbVerdicts = fc.dictionary(fc.constantFrom(...UAS), fc.constantFrom(...VERDICTS));

const arbInput = fc.record({
  siteId: fc.constant(SITE),
  checkId: fc.constant(CHECK),
  firstCheck: fc.boolean(),
  changes: fc.array(arbChange, { maxLength: 12 }),
  rules: fc.array(arbRule, { maxLength: 8 }),
  verdicts: fc.record({ now: arbVerdicts, before: fc.option(arbVerdicts, { nil: null }) }),
  textShare: fc.record({
    before: fc.option(fc.double({ min: 0, max: 1, noNaN: true }), { nil: null }),
    now: fc.option(fc.double({ min: 0, max: 1, noNaN: true }), { nil: null }),
  }),
  fixEvents: fc.array(
    fc.record({
      fix_id: fc.constant(FIX),
      kind: fc.constantFrom('marked_done', 'verified', 'unable_to_verify', 'reopened'),
      at: fc.integer({ min: 0, max: 1e6 }).map((s) => new Date(1.7e12 + s * 1000).toISOString()),
      check_id: fc.option(fc.constantFrom(CHECK, PREV, OTHER_CHECK), { nil: null }),
    }),
    { maxLength: 4 },
  ),
}) as fc.Arbitrary<AlertInput>;

describe('properties', () => {
  it('no change, no alert', () => {
    fc.assert(
      fc.property(arbInput, (i) => {
        expect(evaluateAlerts({ ...i, changes: [] })).toEqual([]);
      }),
    );
  });

  it('an alert names only changes of this check and this site, each at most once', () => {
    fc.assert(
      fc.property(arbInput, (i) => {
        const ours = new Set(
          i.changes.filter((c) => c.check_id === CHECK && c.site_id === SITE).map((c) => c.id),
        );
        for (const a of evaluateAlerts(i)) {
          expect(a.changeIds.length).toBeGreaterThan(0);
          expect(new Set(a.changeIds).size).toBe(a.changeIds.length);
          for (const cid of a.changeIds) expect(ours.has(cid)).toBe(true);
        }
      }),
    );
  });

  it('a baseline never fires', () => {
    fc.assert(
      fc.property(arbInput, (i) => {
        const baselines = new Set(i.changes.filter((c) => c.kind === 'baseline').map((c) => c.id));
        for (const a of evaluateAlerts(i))
          for (const cid of a.changeIds) expect(baselines.has(cid)).toBe(false);
      }),
    );
  });

  it('a first check fires nothing, and every alert is an enabled rule with a channel', () => {
    fc.assert(
      fc.property(arbInput, (i) => {
        expect(evaluateAlerts({ ...i, firstCheck: true })).toEqual([]);
        const byId = new Map(i.rules.map((r) => [r.id, r]));
        const kinds = new Set<string>();
        for (const a of evaluateAlerts(i)) {
          const r = byId.get(a.ruleId)!;
          expect(r.enabled).toBe(true);
          expect(r.channels.length).toBeGreaterThan(0);
          expect(r.site_id === null || r.site_id === SITE).toBe(true);
          expect(kinds.has(a.kind)).toBe(false);
          kinds.add(a.kind);
        }
      }),
    );
  });
});
