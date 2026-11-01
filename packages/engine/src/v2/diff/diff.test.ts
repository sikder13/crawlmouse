import {
  ChangeSchema,
  FixEventSchema,
  FixSchema,
  type Check,
  type Fix,
  type FixEvent,
  type FixType,
  type Verdict,
} from '@crawlmouse/types/v2';
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  checkId,
  draft,
  fingerprint,
  fixWithHistory,
  side,
} from '../../../fixtures/v2/diff/builders.js';
import { diffCheck } from './diff.js';
import type { CheckSide, DetectorOutcome, DiffInput, DiffResult } from './types.js';

const detected = (n: number, type: FixType, rank = 1): DetectorOutcome => ({
  fingerprint: fingerprint(n),
  state: 'detected',
  fix: draft(type, { rank }),
});
const notDetected = (n: number): DetectorOutcome => ({
  fingerprint: fingerprint(n),
  state: 'not_detected',
});

/** Every record the diff returns must be a valid instance of the contract. */
function valid(result: DiffResult): DiffResult {
  for (const f of result.fixes) FixSchema.parse(f);
  for (const e of result.events) FixEventSchema.parse(e);
  for (const c of result.changes) ChangeSchema.parse(c);
  return result;
}
const diff = (input: DiffInput) => valid(diffCheck(input));

/** Sets `ua`'s verdict, adding it as an unscored training crawler if the check did not test it. */
const verdict = (ua: string, v: Verdict) => (c: Check) => {
  const existing = c.crawlers.find((r) => r.ua === ua);
  if (existing) {
    existing.verdict = v;
    return;
  }
  c.crawlers.push({
    ua,
    group: 'ai_training',
    scored: false,
    verdict: v,
    evidence_class: 'declared',
    status: null,
    pages_measured: 20,
    cause: null,
    text_share: null,
    confidence: 'confirmed',
    by_template: [],
  });
};

describe('the first check of a site', () => {
  it('opens every fix it detects, and writes no grade, crawler or robots.txt rows', () => {
    const result = diff({
      previous: null,
      current: side(1, verdict('ClaudeBot', 'disallowed_by_robots')),
      fixes: [],
      events: [],
      outcomes: [
        detected(1, 'robots_txt_blocks_crawler'),
        detected(2, 'deep_pages'),
        detected(3, 'client_rendered_template'),
      ],
    });
    expect(result.fixes.map((f) => f.status)).toEqual(['open', 'open', 'open']);
    expect(result.changes.map((c) => [c.kind, c.subject, c.previous_check_id])).toEqual([
      ['opened', 'crawler_access', null],
      ['opened', 'structure', null],
      ['opened', 'text_without_js', null],
    ]);
  });
});

describe('a change in grade_version', () => {
  const input = (): DiffInput => {
    const resolved = fixWithHistory(1, 'open');
    return {
      previous: side(1),
      current: side(
        2,
        (c) => {
          c.grade_version = '2.1.0';
          c.technical_seo!.score = 60;
          c.technical_seo!.grade = 'C-';
        },
        { robots_txt: 'User-agent: *\nDisallow: /\n' },
      ),
      fixes: [resolved.fix],
      events: resolved.events,
      outcomes: [notDetected(1), detected(2, 'deep_pages')],
    };
  };

  it('writes one baseline row and nothing else', () => {
    const result = diff(input());
    expect(result.changes).toHaveLength(1);
    expect(result.changes[0]).toMatchObject({
      kind: 'changed',
      subject: 'grade',
      summary:
        'New baseline: grading changed from 2.0.0 to 2.1.0; earlier results are not compared.',
      grade_deltas: [],
      fix_id: null,
      previous_check_id: checkId(1),
    });
  });

  it('still moves the fixes through their lifecycle', () => {
    const result = diff(input());
    expect(result.fixes.map((f) => [f.fingerprint, f.status])).toEqual([
      [fingerprint(1), 'verified_resolved'],
      [fingerprint(2), 'open'],
    ]);
    expect(result.events.map((e) => e.kind)).toEqual(['verified']);
  });
});

describe('a coverage change', () => {
  type Dimension = 'page cap' | 'sample size' | 'sample method' | 'pages sampled';
  const changed: Record<Dimension, (s: CheckSide) => CheckSide> = {
    'page cap': (s) => ({ ...s, page_cap: 100 }),
    'sample size': (s) => {
      const c = structuredClone(s.check);
      c.coverage!.sample_strategy.max_pages = 40;
      return { ...s, check: c };
    },
    'sample method': (s) => {
      const c = structuredClone(s.check);
      c.coverage!.sample_strategy.method = 'census';
      return { ...s, check: c };
    },
    'pages sampled': (s) => {
      const c = structuredClone(s.check);
      c.coverage!.pages_sampled = 15;
      return { ...s, check: c };
    },
  };
  /** A fix type that depends on each dimension, and one that does not. */
  const DEPENDS: Record<Dimension, FixType> = {
    'page cap': 'orphan_pages',
    'sample size': 'edge_rule_blocks_crawler',
    'sample method': 'client_rendered_template',
    'pages sampled': 'edge_rule_blocks_crawler',
  };

  for (const dimension of Object.keys(changed) as Dimension[]) {
    it(`(${dimension}) never resolves a fix that depends on it: not_detected reads as indeterminate`, () => {
      for (const status of ['open', 'reopened', 'marked_done', 'unable_to_verify'] as const) {
        const f = fixWithHistory(1, status, { type: DEPENDS[dimension] });
        const result = diff({
          previous: side(1),
          current: changed[dimension](side(2)),
          fixes: [f.fix],
          events: f.events,
          outcomes: [notDetected(1)],
        });
        expect(result.changes, status).toEqual([]);
        expect(
          result.events.map((e) => e.kind),
          status,
        ).toEqual(status === 'marked_done' ? ['unable_to_verify'] : []);
      }
    });

    it(`(${dimension}) writes no row for a fix that depends on it, though the fix opens`, () => {
      const result = diff({
        previous: side(1),
        current: changed[dimension](side(2)),
        fixes: [],
        events: [],
        outcomes: [detected(1, DEPENDS[dimension])],
      });
      expect(result.fixes.map((f) => f.status)).toEqual(['open']);
      expect(result.changes).toEqual([]);
    });
  }

  it('still resolves, with its row, a fix that depends on neither', () => {
    const f = fixWithHistory(1, 'open', { type: 'robots_txt_blocks_crawler' });
    for (const dimension of Object.keys(changed) as Dimension[]) {
      const result = diff({
        previous: side(1),
        current: changed[dimension](side(2)),
        fixes: [f.fix],
        events: f.events,
        outcomes: [notDetected(1)],
      });
      expect(
        result.changes.map((c) => c.kind),
        dimension,
      ).toEqual(['resolved']);
    }
  });

  it('leaves a page-cap fix alone when only the sample changed', () => {
    const f = fixWithHistory(1, 'open', { type: 'orphan_pages' });
    const result = diff({
      previous: side(1),
      current: changed['sample size'](side(2)),
      fixes: [f.fix],
      events: f.events,
      outcomes: [notDetected(1)],
    });
    expect(result.changes.map((c) => c.kind)).toEqual(['resolved']);
  });
});

describe('a row is written only between two checks that both measured the subject', () => {
  it('opens a new fix silently when the previous check did not run its detector', () => {
    const result = diff({
      previous: side(1, undefined, { detectors: ['robots_txt_blocks_crawler'] }),
      current: side(2),
      fixes: [],
      events: [],
      outcomes: [detected(1, 'deep_pages'), detected(2, 'robots_txt_blocks_crawler')],
    });
    expect(result.fixes.map((f) => f.status)).toEqual(['open', 'open']);
    expect(result.changes.map((c) => c.fix_id)).toEqual([result.fixes[1]!.id]);
  });

  it('opens a new fix silently when the previous check reported its fingerprint indeterminate', () => {
    const result = diff({
      previous: side(1, undefined, { indeterminate: [fingerprint(1)] }),
      current: side(2),
      fixes: [],
      events: [],
      outcomes: [detected(1, 'client_rendered_template'), detected(2, 'client_rendered_template')],
    });
    expect(result.fixes.map((f) => f.status)).toEqual(['open', 'open']);
    expect(result.changes.map((c) => c.fix_id)).toEqual([result.fixes[1]!.id]);
  });

  it('resolves a fix silently when its last measurement was not the previous check', () => {
    const f = fixWithHistory(1, 'open', { measuredOn: 1 });
    const result = diff({
      previous: side(2),
      current: side(3),
      fixes: [f.fix],
      events: f.events,
      outcomes: [notDetected(1)],
    });
    expect(result.fixes[0]!.status).toBe('verified_resolved');
    expect(result.changes).toEqual([]);
  });

  it('reopens a fix silently when its last measurement was not the previous check', () => {
    const f = fixWithHistory(1, 'marked_done', { measuredOn: 1 });
    const result = diff({
      previous: side(2),
      current: side(3),
      fixes: [f.fix],
      events: f.events,
      outcomes: [detected(1, 'orphan_pages')],
    });
    expect(result.fixes[0]!.status).toBe('reopened');
    expect(result.changes).toEqual([]);
  });

  it('resolves silently a fix marked done again after the previous check could not measure it', () => {
    // unable_to_verify on check 1, then marked done again: marked_done, last state indeterminate.
    const f = fixWithHistory(1, 'unable_to_verify', { measuredOn: 1 });
    const again: FixEvent = {
      id: 'e0000000-0000-4000-8000-0000000000ff',
      fix_id: f.fix.id,
      at: '2026-10-03T12:00:00Z',
      kind: 'marked_done',
      by_seat_id: null,
    };
    const result = diff({
      previous: side(1),
      current: side(2),
      fixes: [{ ...f.fix, status: 'marked_done' }],
      events: [...f.events, again],
      outcomes: [notDetected(1)],
    });
    expect(result.fixes[0]!.status).toBe('verified_resolved');
    expect(result.changes).toEqual([]);
  });

  it('writes no row for an existing fix that moves when there is no previous graded check', () => {
    for (const [status, outcome] of [
      ['marked_done', detected(1, 'orphan_pages')],
      ['open', notDetected(1)],
    ] as const) {
      const f = fixWithHistory(1, status);
      const result = diff({
        previous: null,
        current: side(2),
        fixes: [f.fix],
        events: f.events,
        outcomes: [outcome],
      });
      expect(result.events, status).toHaveLength(1);
      expect(result.changes, status).toEqual([]);
    }
  });

  it('answers an unable_to_verify fix with a row, though the check before could not measure it', () => {
    for (const [outcome, kind] of [
      [detected(1, 'orphan_pages'), 'opened'],
      [notDetected(1), 'resolved'],
    ] as const) {
      const f = fixWithHistory(1, 'unable_to_verify', { measuredOn: 1 });
      const result = diff({
        previous: side(1),
        current: side(2),
        fixes: [f.fix],
        events: f.events,
        outcomes: [outcome],
      });
      expect(result.changes.map((c) => c.kind)).toEqual([kind]);
    }
  });
});

describe('grade rows', () => {
  const graded =
    (tech: [number | null, string | null], ai: [number, string] | null) => (c: Check) => {
      const [score, grade] = tech;
      c.technical_seo!.score = score;
      c.technical_seo!.grade = grade as never;
      c.technical_seo!.refusal.refused = score === null;
      if (score === null) c.technical_seo!.refusal.triggers = ['nothing_read'];
      if (ai === null) {
        c.crawlers = c.crawlers.map((r) => ({ ...r, verdict: 'not_measured' }));
        c.ai_readability = {
          withheld: true,
          total: null,
          grade: null,
          components: {
            access: { score: null, max: 40, heuristic: false },
            readable: { score: 10, max: 30, heuristic: false },
            quotable: { score: 5, max: 20, heuristic: true },
            signals: { score: 5, max: 10, heuristic: false },
          },
          access_range: { min: 0, max: 40 },
        };
      } else if (c.ai_readability && !c.ai_readability.withheld) {
        // The other three components sum to 20 (builders.ts); Access makes up the total.
        c.ai_readability.total = ai[0];
        c.ai_readability.components.access.score = ai[0] - 20;
        c.ai_readability.grade = ai[1] as never;
      }
    };
  const rows = (before: (c: Check) => void, after: (c: Check) => void) =>
    diff({
      previous: side(1, before),
      current: side(2, after),
      fixes: [],
      events: [],
      outcomes: [],
    }).changes;

  it('writes one row carrying each grade that moved', () => {
    const changes = rows(graded([79, 'B'], [40, 'D']), graded([84, 'B+'], [22, 'F']));
    expect(changes).toHaveLength(1);
    expect(changes[0]).toMatchObject({ kind: 'changed', subject: 'grade', ua: null, fix_id: null });
    expect(changes[0]!.grade_deltas).toEqual([
      { grade: 'technical_seo', from_score: 79, to_score: 84, from_grade: 'B', to_grade: 'B+' },
      { grade: 'ai_readability', from_score: 40, to_score: 22, from_grade: 'D', to_grade: 'F' },
    ]);
    expect(changes[0]!.summary).toBe(
      'Technical SEO B → B+ (79 → 84); AI readability D → F (40 → 22)',
    );
  });

  it('writes a row for a move of one point within a letter, and none for less', () => {
    expect(rows(graded([79, 'B'], [40, 'D']), graded([80, 'B'], [40, 'D']))).toHaveLength(1);
    expect(rows(graded([79, 'B'], [40, 'D']), graded([79.9, 'B'], [40.9, 'D']))).toEqual([]);
  });

  it('leaves out a grade withheld or refused on either check', () => {
    const refusedBefore = rows(graded([null, null], [40, 'D']), graded([84, 'B+'], [22, 'F']));
    expect(refusedBefore[0]!.grade_deltas.map((d) => d.grade)).toEqual(['ai_readability']);
    const withheldAfter = rows(graded([79, 'B'], [40, 'D']), graded([84, 'B+'], null));
    expect(withheldAfter[0]!.grade_deltas.map((d) => d.grade)).toEqual(['technical_seo']);
    expect(rows(graded([null, null], null), graded([84, 'B+'], [22, 'F']))).toEqual([]);
  });
});

describe('a fix the owner touched after this check finished', () => {
  // Check 2 finishes at 2026-10-04T06:00:00Z; the owner marks the fix done a minute later, before
  // the diff runs. The check's measurement is older than the owner's claim, so it does not act.
  const lateMark = (fix: Fix): FixEvent => ({
    id: 'e0000000-0000-4000-8000-0000000000fe',
    fix_id: fix.id,
    at: '2026-10-04T06:01:00Z',
    kind: 'marked_done',
    by_seat_id: null,
  });

  for (const outcome of [notDetected(1), detected(1, 'orphan_pages')]) {
    it(`leaves it marked done on a ${outcome.state} outcome, and writes nothing`, () => {
      const f = fixWithHistory(1, 'open');
      const result = diff({
        previous: side(1),
        current: side(2),
        fixes: [{ ...f.fix, status: 'marked_done' }],
        events: [...f.events, lateMark(f.fix)],
        outcomes: [outcome],
      });
      expect(result).toEqual({ fixes: [], events: [], changes: [] });
    });
  }

  it('leaves it marked done when the mark is dated at the very instant the check finished', () => {
    const f = fixWithHistory(1, 'open');
    const result = diff({
      previous: side(1),
      current: side(2),
      fixes: [{ ...f.fix, status: 'marked_done' }],
      events: [...f.events, { ...lateMark(f.fix), at: '2026-10-04T06:00:00Z' }],
      outcomes: [notDetected(1)],
    });
    expect(result).toEqual({ fixes: [], events: [], changes: [] });
  });

  it('still acts on a mark made before the check finished', () => {
    const f = fixWithHistory(1, 'open');
    const early = { ...lateMark(f.fix), at: '2026-10-04T05:59:00Z' };
    const result = diff({
      previous: side(1),
      current: side(2),
      fixes: [{ ...f.fix, status: 'marked_done' }],
      events: [...f.events, early],
      outcomes: [notDetected(1)],
    });
    expect(result.fixes[0]!.status).toBe('verified_resolved');
  });
});

describe('crawler rows', () => {
  const ROBOTS_BEFORE = 'User-agent: *\nDisallow: /cart\n';
  const ROBOTS_AFTER = 'User-agent: *\nDisallow: /cart\nUser-agent: ClaudeBot\nDisallow: /\n';
  const pair = (
    from: Verdict,
    to: Verdict,
    robots: [string | null, string | null] = [ROBOTS_BEFORE, ROBOTS_AFTER],
  ) =>
    diff({
      previous: side(1, verdict('ClaudeBot', from), { robots_txt: robots[0] }),
      current: side(2, verdict('ClaudeBot', to), { robots_txt: robots[1] }),
      fixes: [],
      events: [],
      outcomes: [],
    }).changes;

  it('opens a block, quoting the lines robots.txt gained', () => {
    const [row, ...rest] = pair('allowed', 'disallowed_by_robots');
    expect(rest).toEqual([]);
    expect(row).toMatchObject({
      kind: 'opened',
      subject: 'crawler_access',
      ua: 'ClaudeBot',
      where: 'robots.txt',
      pages_affected: 100,
      summary: 'ClaudeBot: allowed → disallowed by robots.txt',
      cause: {
        text: 'robots.txt changed: 2 lines added, 0 removed.',
        changed_at: null,
        diff: { removed: [], added: ['User-agent: ClaudeBot', 'Disallow: /'] },
      },
    });
  });

  it('resolves a block that lifted', () => {
    expect(
      pair('blocked_by_ua_rule', 'allowed', [ROBOTS_BEFORE, ROBOTS_BEFORE]).map((c) => [
        c.kind,
        c.where,
        c.cause,
      ]),
    ).toEqual([['resolved', 'all pages', null]]);
  });

  it('marks a move between two kinds of access as changed', () => {
    expect(
      pair('allowed', 'allowed_thin', [ROBOTS_BEFORE, ROBOTS_BEFORE]).map((c) => c.kind),
    ).toEqual(['changed']);
    expect(
      pair('rate_limited', 'challenged_ua', [ROBOTS_BEFORE, ROBOTS_BEFORE]).map((c) => c.kind),
    ).toEqual(['changed']);
  });

  it('writes nothing for a crawler either check did not measure', () => {
    for (const unmeasured of ['not_measured', 'edge_blocks_automation'] as const) {
      expect(
        pair(unmeasured, 'disallowed_by_robots').filter((c) => c.ua),
        unmeasured,
      ).toEqual([]);
      expect(
        pair('allowed', unmeasured).filter((c) => c.ua),
        unmeasured,
      ).toEqual([]);
    }
  });

  it('writes nothing for a crawler only one check tested', () => {
    const changes = diff({
      previous: side(1),
      current: side(2, verdict('ClaudeBot', 'disallowed_by_robots')),
      fixes: [],
      events: [],
      outcomes: [],
    }).changes;
    expect(changes).toEqual([]);
  });

  it('tells a second fix for the same crawler on a row of its own', () => {
    const result = diff({
      previous: side(1, verdict('GPTBot', 'allowed'), { robots_txt: ROBOTS_BEFORE }),
      current: side(2, verdict('GPTBot', 'disallowed_by_robots'), { robots_txt: ROBOTS_AFTER }),
      fixes: [],
      events: [],
      outcomes: [
        detected(1, 'robots_txt_blocks_crawler'),
        {
          fingerprint: fingerprint(2),
          state: 'detected',
          fix: draft('edge_rule_blocks_crawler', { crawler_uas: ['GPTBot'] }),
        },
      ],
    });
    const [first, second] = result.fixes;
    expect(result.changes.map((c) => [c.kind, c.ua, c.fix_id])).toEqual([
      ['opened', 'GPTBot', first!.id],
      ['opened', 'GPTBot', second!.id],
    ]);
  });

  it('keeps a fix row of its own when its crawler row moved the other way', () => {
    const f = fixWithHistory(1, 'open', { type: 'robots_txt_blocks_crawler' });
    const result = diff({
      previous: side(1, verdict('GPTBot', 'disallowed_by_robots')),
      current: side(2, verdict('GPTBot', 'challenged_ua')),
      fixes: [f.fix],
      events: f.events,
      outcomes: [notDetected(1)],
    });
    expect(result.changes.map((c) => [c.kind, c.ua, c.fix_id])).toEqual([
      ['changed', 'GPTBot', null],
      ['resolved', 'GPTBot', f.fix.id],
    ]);
  });

  it('folds an opened robots.txt fix into the crawler row for its crawler', () => {
    const result = diff({
      previous: side(1, verdict('GPTBot', 'allowed'), { robots_txt: ROBOTS_BEFORE }),
      current: side(2, verdict('GPTBot', 'disallowed_by_robots'), { robots_txt: ROBOTS_AFTER }),
      fixes: [],
      events: [],
      outcomes: [detected(1, 'robots_txt_blocks_crawler')],
    });
    expect(result.changes).toHaveLength(1);
    expect(result.changes[0]).toMatchObject({
      ua: 'GPTBot',
      kind: 'opened',
      fix_id: result.fixes[0]!.id,
    });
  });
});

describe('robots.txt rows', () => {
  const robots = (before: string | null, after: string | null) =>
    diff({
      previous: side(1, undefined, { robots_txt: before }),
      current: side(2, undefined, { robots_txt: after }),
      fixes: [],
      events: [],
      outcomes: [],
    }).changes;

  it('writes the literal line diff when the text changed and no verdict did', () => {
    const changes = robots('User-agent: *\nDisallow: /a\n', 'User-agent: *\nDisallow: /b\n');
    expect(changes).toHaveLength(1);
    expect(changes[0]).toMatchObject({
      kind: 'changed',
      subject: 'crawler_access',
      where: 'robots.txt',
      ua: null,
      summary: 'robots.txt changed',
      cause: {
        text: 'robots.txt changed: 1 line added, 1 removed.',
        diff: { removed: ['Disallow: /a'], added: ['Disallow: /b'] },
      },
    });
  });

  it('writes nothing when either check could not read it, or nothing changed', () => {
    expect(robots(null, 'User-agent: *\n')).toEqual([]);
    expect(robots('User-agent: *\n', null)).toEqual([]);
    expect(robots('User-agent: *\r\n', 'User-agent: *\n')).toEqual([]);
  });

  it('quotes at most 50 lines each way and says how many it left out', () => {
    const lines = (p: string, n: number) =>
      Array.from({ length: n }, (_, k) => `Disallow: /${p}${k}`).join('\n');
    const [row] = robots(lines('old', 60), lines('new', 55));
    expect(row!.cause!.diff!.removed).toHaveLength(50);
    expect(row!.cause!.diff!.added).toHaveLength(50);
    expect(row!.cause!.text).toBe(
      'robots.txt changed: 55 lines added, 60 removed. The first 50 each way are quoted; 5 added and 10 removed are not.',
    );
  });

  it('says so when a removed line is cut, as when an added one is', () => {
    const [row] = robots(`User-agent: *\nDisallow: /${'é'.repeat(400)}\n`, 'User-agent: *\n');
    expect(row!.cause!.text).toBe(
      'robots.txt changed: 0 lines added, 1 removed. 1 quoted line is cut to 500 bytes or cleaned of control characters.',
    );
  });

  it('cuts a quoted line to 500 bytes', () => {
    const [row] = robots('User-agent: *\n', `User-agent: *\nDisallow: /${'é'.repeat(400)}\n`);
    const quoted = row!.cause!.diff!.added[0]!;
    expect(new TextEncoder().encode(quoted).length).toBeLessThanOrEqual(500);
    expect(quoted.startsWith('Disallow: /é')).toBe(true);
  });
});

describe('deploy rows', () => {
  const stack = (edit: (c: Check) => void) =>
    diff({ previous: side(1), current: side(2, edit), fixes: [], events: [], outcomes: [] })
      .changes;

  it('writes a row when the stack changed, naming what moved', () => {
    const changes = stack((c) => {
      c.stack!.frontend!.version = '15';
      c.stack!.edge = null;
    });
    expect(changes).toHaveLength(1);
    expect(changes[0]).toMatchObject({
      kind: 'changed',
      subject: 'deploy',
      where: 'stack',
      summary:
        'Stack changed: frontend Next.js 14 (app) → Next.js 15 (app); edge Cloudflare → none',
    });
  });

  it('writes nothing when only the evidence for the same stack changed, or a stack is unknown', () => {
    expect(stack((c) => (c.stack!.frontend!.detected_from = 'the build id'))).toEqual([]);
    expect(stack((c) => (c.stack = null))).toEqual([]);
  });
});

describe('a regression after a quiet check', () => {
  it('writes an opened row when a fix resolved two checks ago is found again', () => {
    const f = fixWithHistory(1, 'open');
    const resolved = diff({
      previous: side(1),
      current: side(2),
      fixes: [f.fix],
      events: f.events,
      outcomes: [notDetected(1)],
    });
    const quiet = diff({
      previous: side(2),
      current: side(3),
      fixes: resolved.fixes,
      events: [...f.events, ...resolved.events],
      outcomes: [notDetected(1)],
    });
    expect(quiet.changes).toEqual([]);
    const back = diff({
      previous: side(3),
      current: side(4),
      fixes: quiet.fixes,
      events: [...f.events, ...resolved.events],
      outcomes: [detected(1, 'orphan_pages')],
    });
    expect(back.changes.map((c) => c.kind)).toEqual(['opened']);
  });
});

describe('ranks', () => {
  it('ranks the live fixes 1 to n, so two never share a rank', () => {
    const kept = fixWithHistory(1, 'marked_done');
    const result = diff({
      previous: side(1),
      current: side(2, undefined, { indeterminate: [fingerprint(1)] }),
      fixes: [kept.fix],
      events: kept.events,
      outcomes: [
        { fingerprint: fingerprint(1), state: 'indeterminate' },
        detected(2, 'deep_pages', 1),
      ],
    });
    expect(result.fixes.map((f) => [f.number, f.status, f.rank])).toEqual([
      [1, 'unable_to_verify', 1],
      [2, 'open', 2],
    ]);
  });

  it('orders the fixes found on this check by the detector’s ranks', () => {
    const a = fixWithHistory(1, 'open');
    const b = fixWithHistory(2, 'open', { type: 'deep_pages' });
    const result = diff({
      previous: side(1),
      current: side(2),
      fixes: [a.fix, { ...b.fix, rank: 2 }],
      events: [...a.events, ...b.events],
      outcomes: [detected(1, 'orphan_pages', 3), detected(2, 'deep_pages', 1)],
    });
    expect(result.fixes.map((f) => [f.number, f.rank])).toEqual([
      [1, 2],
      [2, 1],
    ]);
  });

  it('re-ranks a fix it did not otherwise touch, and returns it', () => {
    const quiet = fixWithHistory(1, 'open');
    const result = diff({
      previous: side(1),
      current: side(2),
      fixes: [{ ...quiet.fix, rank: 5 }],
      events: quiet.events,
      outcomes: [detected(2, 'deep_pages', 1)],
    });
    expect(result.fixes.map((f) => [f.number, f.rank])).toEqual([
      [1, 2],
      [2, 1],
    ]);
    expect(result.events).toEqual([]);
  });
});

describe('determinism', () => {
  const rich = (): DiffInput => {
    const a = fixWithHistory(1, 'open');
    const b = fixWithHistory(2, 'marked_done', { type: 'deep_pages' });
    const c = fixWithHistory(3, 'verified_resolved', { type: 'quotable_opening' });
    return {
      previous: side(1, verdict('ClaudeBot', 'allowed')),
      current: side(
        2,
        (k) => {
          verdict('ClaudeBot', 'disallowed_by_robots')(k);
          k.technical_seo!.score = 70;
          k.technical_seo!.grade = 'C+';
        },
        { robots_txt: 'User-agent: ClaudeBot\nDisallow: /\n' },
      ),
      fixes: [a.fix, b.fix, c.fix],
      events: [...a.events, ...b.events, ...c.events],
      outcomes: [
        notDetected(1),
        detected(2, 'deep_pages', 2),
        detected(3, 'quotable_opening', 3),
        detected(4, 'hreflang_gap', 4),
      ],
    };
  };

  it('gives byte-identical output for the same input', () => {
    expect(JSON.stringify(diff(rich()))).toBe(JSON.stringify(diff(rich())));
  });

  it('gives the same output whatever order fixes, events and outcomes are listed in', () => {
    const input = rich();
    const reversed = {
      ...input,
      fixes: [...input.fixes].reverse(),
      events: [...input.events].reverse(),
      outcomes: [...input.outcomes].reverse(),
    };
    expect(JSON.stringify(diff(reversed))).toBe(JSON.stringify(diff(input)));
  });

  it('gives the same bytes however fixes, events, outcomes and crawlers are listed (property)', () => {
    // Fix 5 has two events at one instant; only the id tie-break orders them as its status says.
    const tie = fixWithHistory(5, 'reopened', { type: 'canonical_mismatch' });
    const base = rich();
    const input: DiffInput = {
      ...base,
      fixes: [...base.fixes, tie.fix],
      events: [...base.events, ...tie.events],
      outcomes: [
        ...base.outcomes,
        detected(6, 'redirect_chain', 6),
        detected(7, 'redirect_chain', 7),
      ],
    };
    const expected = JSON.stringify(diff(input));
    fc.assert(
      fc.property(
        fc.shuffledSubarray([...input.fixes], { minLength: input.fixes.length }),
        fc.shuffledSubarray([...input.events], { minLength: input.events.length }),
        fc.shuffledSubarray([...input.outcomes], { minLength: input.outcomes.length }),
        fc.shuffledSubarray(input.current.check.crawlers, {
          minLength: input.current.check.crawlers.length,
        }),
        (fixes, events, outcomes, crawlers) => {
          const current = { ...input.current, check: { ...input.current.check, crawlers } };
          expect(JSON.stringify(diff({ ...input, current, fixes, events, outcomes }))).toBe(
            expected,
          );
        },
      ),
      { numRuns: 200 },
    );
  });

  it('dates every event and row at the check’s finish, and ids them as UUIDs', () => {
    const result = diff(rich());
    expect(result.changes.length).toBeGreaterThan(3);
    for (const e of result.events) expect(e.at).toBe(rich().current.check.finished_at);
    for (const c of result.changes) expect(c.detected_at).toBe(rich().current.check.finished_at);
    const ids = [...result.events, ...result.changes, ...result.fixes].map((r) => r.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe('what the diff refuses', () => {
  const base = (): DiffInput => {
    const f = fixWithHistory(1, 'open');
    return { previous: side(1), current: side(2), fixes: [f.fix], events: f.events, outcomes: [] };
  };

  it('returns nothing for a check that was not graded', () => {
    const failed = side(2, (c) => {
      c.status = 'failed';
      c.failure_reason = 'timeout';
      c.coverage = null;
      c.technical_seo = null;
      c.ai_readability = null;
    });
    expect(diffCheck({ ...base(), current: failed, outcomes: [notDetected(1)] })).toEqual({
      fixes: [],
      events: [],
      changes: [],
    });
  });

  it('throws when a stored status disagrees with its events', () => {
    const input = base();
    input.fixes = [{ ...input.fixes[0]!, status: 'marked_done' }];
    expect(() => diffCheck(input)).toThrow(/status/);
  });

  it('throws on a crawler listed twice in one check', () => {
    const twice = side(2, (c) =>
      c.crawlers.push({ ...c.crawlers[0]!, verdict: 'blocked_by_ua_rule' }),
    );
    expect(() => diffCheck({ ...base(), current: twice })).toThrow(/twice/);
    expect(() =>
      diffCheck({ ...base(), previous: side(1, (c) => c.crawlers.push(c.crawlers[0]!)) }),
    ).toThrow(/twice/);
  });

  it('throws rather than return a record the contract rejects', () => {
    const bad: DetectorOutcome = {
      fingerprint: fingerprint(9),
      state: 'detected',
      fix: draft('deep_pages', { affected_pages: -1 }),
    };
    expect(() => diffCheck({ ...base(), outcomes: [bad] })).toThrow();
    const untitled: DetectorOutcome = {
      fingerprint: fingerprint(9),
      state: 'detected',
      fix: draft('deep_pages', { title: '' }),
    };
    expect(() => diffCheck({ ...base(), outcomes: [untitled] })).toThrow();
  });

  it('throws on an invalid fix even when it writes no row', () => {
    // The previous check did not run the detector, so the new fix writes no row to catch it.
    const previous = side(1, undefined, { detectors: [] });
    const untitled: DetectorOutcome = {
      fingerprint: fingerprint(9),
      state: 'detected',
      fix: draft('deep_pages', { title: '' }),
    };
    expect(() => diffCheck({ ...base(), previous, outcomes: [untitled] })).toThrow();
  });

  it('throws when the check’s indeterminate fingerprints disagree with its outcomes', () => {
    const current = side(2, undefined, { indeterminate: [fingerprint(1)] });
    expect(() => diffCheck({ ...base(), current, outcomes: [notDetected(1)] })).toThrow(
      /indeterminate/,
    );
    expect(() =>
      diffCheck({ ...base(), outcomes: [{ fingerprint: fingerprint(1), state: 'indeterminate' }] }),
    ).toThrow(/indeterminate/);
  });

  it('throws on two outcomes for one fingerprint', () => {
    expect(() => diffCheck({ ...base(), outcomes: [notDetected(1), notDetected(1)] })).toThrow(
      /twice/,
    );
  });

  it('throws when a detection names a different type from the fix it matches', () => {
    expect(() => diffCheck({ ...base(), outcomes: [detected(1, 'deep_pages')] })).toThrow(/type/);
  });

  it('throws on a detection from a detector the check says did not run', () => {
    const current = side(2, undefined, { detectors: ['orphan_pages'] });
    expect(() => diffCheck({ ...base(), current, outcomes: [detected(9, 'deep_pages')] })).toThrow(
      /did not run/,
    );
  });

  it('throws when the previous check is another site’s, not graded, or not earlier', () => {
    const other = side(1, (c) => (c.site_id = '50000000-0000-4000-8000-0000000000d2'));
    expect(() => diffCheck({ ...base(), previous: other })).toThrow(/site/);
    const failed = side(1, (c) => {
      c.status = 'failed';
      c.failure_reason = 'timeout';
      c.coverage = null;
      c.technical_seo = null;
      c.ai_readability = null;
    });
    expect(() => diffCheck({ ...base(), previous: failed })).toThrow(/graded/);
    expect(() => diffCheck({ ...base(), previous: side(3) })).toThrow(/earlier/);
  });
});
