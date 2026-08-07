import { describe, it, expect } from 'vitest';
import { isReportGone } from './report-visibility';
import { badgeVerdict } from './badge-report';
import { buildFindingsCsv, buildPagesCsv, buildPrescriptionsCsv } from './billing/csv';
import { auditCompletedProps } from './audit-completed-event';
import { projectAuditForClient } from './audit-stream-projection';
import { shareMessage } from '../components/share/share-intents';
import { NO_GRADE_LABEL } from './refusal-copy';
import type { PublicReportRow } from './reports';
import type { AuditRow } from './audit-stream-projection';

// ─────────────────────────────────────────────────────────────────────────────
// SPEC 5.1a Stage 4 — THE SURFACE PROOFS, at the SERIALIZATION BOUNDARY.
//
// THE STANDARD. Each of these asserts on the bytes a surface emits — the JSON handed to the client,
// the props sent to the analytics pipe, the string put into a share URL. "The component doesn't
// render it" is explicitly NOT proof: a payload that carries a letter has already leaked it to
// anything that reads the payload rather than the page.
//
// WHY A CHECKLIST AND NOT A TYPE. Making AuditResult.score/grade nullable let the compiler enumerate
// the PERSISTENCE boundary — it found inngest/persist-results.ts, the Inngest step summary, and the
// audit.completed event schema. It cannot enumerate the RENDER surfaces, because the web layer reads
// database rows and never typechecks against AuditResult. That gap is evidenced, not assumed, and it
// is why each surface is proved individually.
//
// Surfaces 1 (minted snapshot), 2 (OG card) and 13 (dashboard) are proved in their own files —
// mint-snapshot.test.ts, og-report-model.test.ts and dashboard.test.ts — because each needed a fix
// rather than only a proof.
// ─────────────────────────────────────────────────────────────────────────────

const GRADED_REPORT: PublicReportRow = {
  domain: 'ex.com',
  grade: 'B+',
  score: '81.39',
  cms_detected: 'wordpress',
  orphan_count: 3,
  avg_depth: '2.4',
  takedown_requested_at: null,
  created_at: '2026-08-01T00:00:00.000Z',
};
/** A completed audit the Stage 4 gate refused: score AND grade null together, by contract. */
const REFUSED_REPORT: PublicReportRow = { ...GRADED_REPORT, grade: null, score: null };

describe('SURFACE 3 — the public report page', () => {
  it('treats a report with no verdict as GONE, so /r/<slug> 404s instead of rendering a blank grade', () => {
    expect(isReportGone(REFUSED_REPORT)).toBe(true);
  });

  it('still renders a real report — the negative control', () => {
    expect(isReportGone(GRADED_REPORT)).toBe(false);
  });
});

describe('SURFACE 4 — the white-label report', () => {
  it('is not a brandable artifact without a verdict — the route 404s on the same gate', () => {
    // The white-label POST returns 404 when `isReportGone(report)`, so a refused report can never be
    // branded, re-listed or re-indexed. Proving the gate rather than the route keeps the assertion on
    // the decision itself, which is the thing that must not drift from the page and the OG card.
    expect(isReportGone(REFUSED_REPORT)).toBe(true);
  });
});

describe('SURFACE 6 — the audit-completed analytics event', () => {
  it('emits NULL for a withheld verdict, never 0 and never a letter', () => {
    const props = auditCompletedProps({ status: 'completed', grade: null, score: null });
    const serialized = JSON.stringify(props);
    expect(serialized).toBe('{"status":"completed","grade":null,"score":null}');
    // A 0 here would be worse than cosmetic: it would poison the funnel metrics that govern the
    // product's success criteria, making refusals indistinguishable from genuine F-grade sites.
    expect(props.score).not.toBe(0);
    expect(props.grade).not.toBe('F');
  });

  it('keeps crawl-health enrichment on a refused audit — an absent verdict is not absent evidence', () => {
    // The refusal is precisely when crawl-health matters most: it is the evidence that explains why
    // no verdict followed.
    const props = auditCompletedProps({
      status: 'completed',
      grade: null,
      score: null,
      crawlHealth: { confidence: 'low', coveragePct: 0.02, blockRate: 0, partial: true },
    });
    expect(props.confidence).toBe('low');
    expect(props.partial).toBe(true);
    expect(props.grade).toBeNull();
  });

  it('still carries a real verdict — the negative control', () => {
    expect(auditCompletedProps({ status: 'completed', grade: 'B+', score: 81.39 }).score).toBe(81.39);
  });
});

describe('SURFACE 8 — the SSE stream projection', () => {
  const row = (over: Partial<AuditRow> = {}): AuditRow => ({
    id: 'aud-1',
    url: 'https://ex.com/',
    status: 'completed',
    grade: 'B+',
    score: '81.39',
    page_count: 79,
    link_count: 240,
    cms_detected: 'wordpress',
    user_id: null,
    settings: null,
    failure_reason: null,
    confidence: 'high',
    coverage_pct: '0.98',
    block_rate: '0',
    partial: false,
    ...over,
  });

  it('projects a withheld verdict as NULL in the client payload — the bytes carry no letter', () => {
    const client = projectAuditForClient(row({ grade: null, score: null, confidence: 'low', coverage_pct: '0.02', partial: true }));
    expect(client.grade).toBeNull();
    expect(client.score).toBeNull();

    // The serialized payload is what actually crosses the wire to the browser.
    const serialized = JSON.stringify(client);
    expect(serialized).toContain('"grade":null');
    expect(serialized).toContain('"score":null');
    expect(serialized).not.toContain('"score":0');
    expect(serialized).not.toContain('"grade":"F"');
    expect(serialized).not.toContain('"grade":""');
  });

  it('still projects a real verdict — the negative control', () => {
    const client = projectAuditForClient(row());
    expect(client.grade).toBe('B+');
    expect(client.score).toBe(81.39);
  });
});

describe('SURFACE 10 — the share text', () => {
  it('NEVER produces "I scored" for a withheld verdict', () => {
    // The approved copy's hard rule. The graded frame is first-person and boastful; there is no score
    // to be proud or sheepish about, and a dash where the letter goes still reads as a verdict.
    const msg = shareMessage(null, null, undefined, 'ex.com');
    expect(msg.text).not.toContain('I scored');
    expect(msg.text).not.toContain('My site got');
    expect(msg.text).not.toContain('—');
    expect(msg.text).not.toMatch(/\d/);
    expect(msg.text).toContain('ex.com');
    expect(msg.text.toLowerCase()).toContain('couldn');
    expect(msg.proud).toBe(false);
  });

  it('refuses the graded frame when only one half of the verdict is present', () => {
    expect(shareMessage('B+', null).text).not.toContain('I scored');
    expect(shareMessage(null, 81).text).not.toContain('I scored');
    // Specifically not the null-stringified forms a template would have produced.
    expect(shareMessage('B+', null).text).not.toContain('null');
  });

  it('falls back to a neutral subject with no domain, rather than naming nothing', () => {
    expect(shareMessage(null, null).text).toContain('this site');
  });

  it('still produces the proud and curious frames for real verdicts — the negative control', () => {
    expect(shareMessage('A-', 91).text).toContain('I scored A-/91');
    expect(shareMessage('C', 64).text).toContain('My site got C/64');
  });
});

describe('SURFACE 11 — the leaderboard', () => {
  it('excludes verdict-less reports AT THE QUERY, not at the render', () => {
    // The board is public and ranked BY SCORE, so a null score would sort somewhere. The exclusion is
    // therefore made in the SQL filter rather than left to the row mapper: a report with no score is
    // never fetched at all. This captures the filters actually applied.
    const applied: { col: string; op: string }[] = [];
    const q: Record<string, unknown> = {};
    for (const m of ['eq', 'is', 'not', 'order', 'limit', 'select']) {
      q[m] = (col?: string, ...rest: unknown[]) => {
        applied.push({ col: String(col), op: m + (rest.length ? `:${String(rest[0])}` : '') });
        return q;
      };
    }
    // The chain resolves as a thenable; `limit` terminates it in the real builder.
    q.limit = () => Promise.resolve({ data: [], error: null });

    const sb = { from: () => q } as never;
    return import('./leaderboard').then(async ({ fetchLeaderboardReports }) => {
      await fetchLeaderboardReports(sb, 'wordpress', 10);
      const scoreFilter = applied.find((a) => a.col === 'score');
      expect(scoreFilter).toBeDefined();
      expect(scoreFilter!.op).toContain('not');
    });
  });
});

describe('the shared refusal label', () => {
  it('is a word, not a glyph — never a dash standing where a letter goes', () => {
    expect(NO_GRADE_LABEL).not.toContain('—');
    expect(NO_GRADE_LABEL).not.toContain('?');
    expect(NO_GRADE_LABEL).not.toMatch(/\d/);
    expect(NO_GRADE_LABEL.toLowerCase()).toContain('grade');
  });
});

describe('SURFACE 5 — the embed badge', () => {
  it('REFUSES TO MINT without a verdict — a badge is a claim, and there is nothing to claim', () => {
    // Approved copy (f): the embed route returns the "not available" badge. Not a badge with an empty
    // grade slot — no badge.
    expect(badgeVerdict({ slug: 's', grade: null, score: null })).toBeNull();
  });

  it('refuses when only one half of the verdict survived, rather than rendering "Score — / 100"', () => {
    expect(badgeVerdict({ slug: 's', grade: 'B+', score: null })).toBeNull();
    expect(badgeVerdict({ slug: 's', grade: 'B+', score: '' })).toBeNull();
    expect(badgeVerdict({ slug: 's', grade: null, score: '81.39' })).toBeNull();
  });

  it('refuses a non-numeric score rather than rendering NaN into a third party page', () => {
    expect(badgeVerdict({ slug: 's', grade: 'B+', score: 'not-a-number' })).toBeNull();
  });

  it('still mints for a real verdict — the negative control', () => {
    expect(badgeVerdict({ slug: 's', grade: 'B+', score: '81.39' })).toEqual({ slug: 's', grade: 'B+', score: 81.39 });
  });
});

describe('SURFACE 7 — the Pro CSV export', () => {
  it('carries no verdict at all: the export is pages, findings and prescriptions only', () => {
    // The strongest available proof is STRUCTURAL. buildAuditZip takes findings, pages and
    // prescriptions and nothing else, so there is no parameter through which a grade or score could
    // reach the archive — a refused audit exports the same shape as a graded one, minus nothing.
    // Asserting on the emitted header rows keeps that true if a column is ever added.
    const headers = [
      buildFindingsCsv([]).split('\n')[0] ?? '',
      buildPagesCsv([]).split('\n')[0] ?? '',
      buildPrescriptionsCsv([]).split('\n')[0] ?? '',
    ].join('|').toLowerCase();
    expect(headers).not.toContain('grade');
    // "score" must not appear as a column; the pages sheet legitimately carries status_code etc.
    expect(headers.split('|').some((h) => h.split(',').includes('score'))).toBe(false);
  });
});

describe('SURFACE 12 — the head-to-head compare', () => {
  it('classifies a WITHHELD verdict as refused, carrying no letter and no score', async () => {
    const { columnState } = await import('../components/share/CompareView');
    const state = columnState({
      snapshot: { status: 'completed', grade: null, score: null, refusal: { refused: true } } as never,
      finished: true,
    } as never);
    expect(state.kind).toBe('refused');
    // The refused arm has NO grade/score fields at all, so there is nothing for the column or the
    // winner banner to read. The comparison itself already treats a missing score as "not a
    // contender" rather than as the lowest score, which is what a coerced 0 would have made it.
    expect(JSON.stringify(state)).toBe('{"kind":"refused"}');
  });

  it('separates a FAILED audit from a refused one — gate 5 / B5-2', async () => {
    // These used to collapse into one `ungradable` bucket, and the compare banner then told the owner
    // an audit that ERRORED had "not enough evidence to publish a grade". Two meanings of an absent
    // letter, and only one of them is a decision we made.
    const { columnState } = await import('../components/share/CompareView');
    expect(columnState({ snapshot: { status: 'failed', grade: null, score: null } as never, finished: true } as never).kind).toBe('failed');
    // A null verdict with NO refusal payload is a compute failure, never a withheld verdict.
    expect(columnState({ snapshot: { status: 'completed', grade: null, score: null, refusal: null } as never, finished: true } as never).kind).toBe('failed');
  });

  it('requires BOTH halves before showing a grade — the interim-zero guard, extended', async () => {
    const { columnState } = await import('../components/share/CompareView');
    const half = (over: object) => columnState({ snapshot: { status: 'completed', refusal: { refused: true }, ...over } as never, finished: true } as never).kind;
    expect(half({ grade: 'B+', score: null })).toBe('refused');
    expect(half({ grade: null, score: 81.39 })).toBe('refused');
  });

  it('still grades a real verdict — the negative control', async () => {
    const { columnState } = await import('../components/share/CompareView');
    const state = columnState({
      snapshot: { status: 'completed', grade: 'B+', score: 81.39, orphanCount: 3, avgDepth: 2.4 } as never,
      finished: true,
    } as never);
    expect(state).toEqual({ kind: 'graded', grade: 'B+', score: 81.39, orphanCount: 3, avgDepth: 2.4 });
  });
});

describe('SURFACE 8 (extended) — refusal + coverage cross to the client', () => {
  const REFUSED_ROW = {
    id: 'aud-1', url: 'https://ex.com/', status: 'completed',
    grade: null, score: null, page_count: 79, link_count: 0, cms_detected: 'wordpress',
    user_id: null, settings: null, failure_reason: null,
    confidence: 'low', coverage_pct: '0.02', block_rate: '0', partial: true,
    refusal: { refused: true, triggers: ['no_observed_links'], confidenceCapped: false, unevaluable: [] },
    coverage: {
      fetched: 79, gradeable: 79, excluded: [], sitemapDeclared: null,
      sitemapRobotsExcluded: null, estimatedTotal: null, estimateSource: 'none', coverageRatio: null,
    },
  } as never;

  it('carries the triggers so the surface can render the APPROVED body, not a generic one', () => {
    const client = projectAuditForClient(REFUSED_ROW);
    expect(client.refusal?.triggers).toEqual(['no_observed_links']);
    expect(client.coverage?.gradeable).toBe(79);
    // Still no verdict anywhere in the bytes.
    const serialized = JSON.stringify(client);
    expect(serialized).toContain('"grade":null');
    expect(serialized).toContain('"score":null');
    expect(serialized).not.toContain('"grade":"F"');
  });

  it('normalises a PRE-MIGRATION row to null rather than undefined', () => {
    // Existing rows were not backfilled. `refusal` is simply absent on the legacy column fallback, and
    // an absent column must mean the same thing to a reader as an absent refusal.
    const legacy = { ...(REFUSED_ROW as object), refusal: undefined, coverage: undefined } as never;
    const client = projectAuditForClient(legacy);
    expect(client.refusal).toBeNull();
    expect(client.coverage).toBeNull();
    expect(JSON.stringify(client)).toContain('"refusal":null');
  });

  it('the refusal payload carries NO url, NO crawled text and NO user_id', () => {
    // It is granted to anon+authenticated at the database too, so this asserts what that grant exposes.
    const serialized = JSON.stringify(projectAuditForClient(REFUSED_ROW).refusal);
    expect(serialized).not.toContain('http');
    expect(serialized).not.toContain('user_id');
    expect(serialized).not.toContain('ex.com');
  });
});
