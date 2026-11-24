/**
 * Row 18: the snapshot of a competitor's ended check that is copied into the customer's check.
 * The expected figures are the ones the Signals screen already shows for bad-site's own row
 * (view/segment/signals.test.ts, "compares what both audits measured"), so the snapshot and the
 * customer's own column are measured the same way.
 */
import { describe, expect, it } from 'vitest';
import { CompetitorSnapshotSchema, type Check } from '@crawlmouse/types/v2';
import { findCheck, fixture } from '../fixtures';
import { FIRST_AUDIT } from '../view/segment/test-helpers';
import { competitorSnapshot } from './snapshot';

/** The check the Signals screen's own test reads for bad-site. */
const badSite = (): Check =>
  structuredClone(findCheck(fixture('bad-site'), FIRST_AUDIT['bad-site']));

describe('competitorSnapshot', () => {
  it("reads the competitor's check as the screen reads the customer's own", () => {
    const s = competitorSnapshot(badSite(), 'rival.example')!;
    expect(s.host).toBe('rival.example');
    expect([s.crawlers_with_access, s.crawlers_tested]).toEqual([4, 6]);
    expect(Math.round(s.text_share! * 100)).toBe(31);
    expect(s.technical_seo).toEqual({ grade: 'B', score: 79 });
    expect(s.ai_readability).toEqual({ grade: 'D', score: 41 });
    expect(s.signals_present).toBe(2);
    expect(CompetitorSnapshotSchema.parse(s)).toEqual(s);
  });

  it('writes no Product schema answer, because a check stores none', () => {
    expect(competitorSnapshot(badSite(), 'rival.example')!.product_schema).toBeNull();
  });

  it('has no text share when nothing was rendered', () => {
    const c = badSite();
    c.without_js = null;
    const s = competitorSnapshot(c, 'rival.example')!;
    expect(s.text_share).toBeNull();
    expect(CompetitorSnapshotSchema.parse(s).text_share).toBeNull();
  });

  it('has no Technical SEO grade when the grade was refused', () => {
    const c = badSite();
    c.technical_seo = { ...c.technical_seo!, score: null, grade: null };
    expect(competitorSnapshot(c, 'rival.example')!.technical_seo).toBeNull();
  });

  it('has no AI readability when it was withheld', () => {
    const c = badSite();
    c.ai_readability = { ...c.ai_readability!, withheld: true } as Check['ai_readability'];
    expect(competitorSnapshot(c, 'rival.example')!.ai_readability).toBeNull();
  });

  it.each(['queued', 'running', 'failed', 'deferred'] as const)(
    'makes no snapshot of a %s check',
    (status) => {
      const c = badSite();
      c.status = status;
      expect(competitorSnapshot(c, 'rival.example')).toBeNull();
    },
  );

  it('makes a snapshot of a partial check', () => {
    const c = badSite();
    c.status = 'partial';
    expect(competitorSnapshot(c, 'rival.example')).not.toBeNull();
  });

  it('has no signal count when no signal could be read', () => {
    const c = badSite();
    c.signals = c.signals.map((s) => ({ ...s, state: 'indeterminate' as const }));
    expect(competitorSnapshot(c, 'rival.example')!.signals_present).toBeNull();
  });
});
