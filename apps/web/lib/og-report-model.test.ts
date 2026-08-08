import { describe, it, expect } from 'vitest';
import { buildOgReportModel } from './og-report-model';
import type { PublicReportRow } from './reports';

// ─────────────────────────────────────────────────────────────────────────────
// SPEC 5.1a Stage 4 — SURFACE 2 of 13: THE OG CARD.
//
// Proved second, and only after the minted snapshot, because these two are the permanent public pair:
// the card is cached for an hour, embedded in other people's timelines, and re-fetched by unfurlers we
// do not control. A verdict that escapes onto it is not correctable by editing our own page.
//
// The model returned here IS the payload the PNG is drawn from, so these assert on its serialized form
// rather than on the JSX. "The card doesn't render it" would be exactly the reasoning the standard
// rejects.
// ─────────────────────────────────────────────────────────────────────────────

const GRADED: PublicReportRow = {
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
const REFUSED: PublicReportRow = { ...GRADED, grade: null, score: null };

describe('SURFACE 2 — the OG card never draws a withheld verdict', () => {
  it('renders the placeholder for a report with no letter — no grade, no score, no dash', () => {
    const model = buildOgReportModel(REFUSED);
    expect(model).toEqual({ kind: 'placeholder' });

    // Byte-level on the payload the image is drawn from.
    const serialized = JSON.stringify(model);
    expect(serialized).toBe('{"kind":"placeholder"}');
    expect(serialized).not.toContain('81');
    expect(serialized).not.toContain('B+');
    // The three glyphs the approved copy forbids in a letter slot.
    expect(serialized).not.toContain('?');
    expect(serialized).not.toContain('—');
    expect(serialized).not.toContain('F');
  });

  it('renders the placeholder when a letter survived without a score', () => {
    // A half-written row must not produce "B+ / 0". The card cannot be edited once it is cached and
    // shared, so both halves are required before anything is drawn.
    expect(buildOgReportModel({ ...GRADED, score: null })).toEqual({ kind: 'placeholder' });
  });

  it('renders the placeholder when a score survived without a letter', () => {
    expect(buildOgReportModel({ ...GRADED, grade: null })).toEqual({ kind: 'placeholder' });
  });

  it('never reports `passing` for a report it declines to draw', () => {
    // `passing` drives the colour. A withheld verdict rendered in the failure colour would style a
    // refusal as an F — forbidden outright by the approved copy, and the reason the model carries no
    // colour decision at all on the placeholder branch.
    const model = buildOgReportModel(REFUSED);
    expect('passing' in model).toBe(false);
  });

  it('still draws the card for a real verdict — the negative control', () => {
    // Without this, every assertion above would also pass on a model that refused everything.
    expect(buildOgReportModel(GRADED)).toEqual({
      kind: 'grade',
      domain: 'ex.com',
      grade: 'B+',
      score: '81',
      passing: true,
      brand: null,
    });
  });

  it('renders the placeholder for a missing, taken-down or hidden report', () => {
    expect(buildOgReportModel(null)).toEqual({ kind: 'placeholder' });
    expect(buildOgReportModel({ ...GRADED, takedown_requested_at: '2026-08-01T00:00:00.000Z' })).toEqual({ kind: 'placeholder' });
    expect(buildOgReportModel({ ...GRADED, hidden_at: '2026-08-01T00:00:00.000Z' })).toEqual({ kind: 'placeholder' });
  });
});
