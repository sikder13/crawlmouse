import { describe, expect, it } from 'vitest';
import { FIXTURE_NAMES } from '../../fixtures';
import { SEGMENT_KEYS, SEGMENTS, segmentFrame, type SegmentKey } from './frame';
import { asFirstSeen, edited } from './test-helpers';

const hrefs = {
  overview: '/overview',
  segment: (k: SegmentKey) => `/seg/${k}`,
};

describe('segmentFrame', () => {
  it('lists the overview and the six sections as tabs, in the locked order, marking the current one', () => {
    const { d, id } = edited('bad-site');
    const f = segmentFrame(d, id, 'structure', { asFirstSeen: true, hrefs });
    expect(f.tabs.map((t) => t.label)).toEqual([
      'Overview',
      'Crawler access',
      'Without JavaScript',
      'Structure',
      'Content',
      'Signals',
      'Changes',
    ]);
    expect(f.tabs.filter((t) => t.current).map((t) => t.href)).toEqual(['/seg/structure']);
    expect(f.tabs[0]!.href).toBe('/overview');
  });

  it('names the neighbours as the locked pages do, each next one with its own figure from the check', () => {
    const { d, id } = edited('bad-site');
    const links = (k: SegmentKey) => {
      const f = segmentFrame(d, id, k, { asFirstSeen: true, hrefs });
      return [f.back.label, f.next.label];
    };
    expect(links('access')).toEqual([
      'Back to overview',
      'Next: Readable without JavaScript · 31%',
    ]);
    expect(links('nojs')).toEqual(['Back: Crawler access', 'Next: Site structure · 74']);
    expect(links('structure')).toEqual([
      'Back: Without JavaScript',
      'Next: Content an answer engine can quote · 58',
    ]);
    expect(links('content')).toEqual([
      'Back: Site structure',
      'Next: Agent-readiness signals · 2 of 7',
    ]);
    expect(links('signals')).toEqual(['Back: Content', 'Next: Changes']);
    expect(links('changes')).toEqual(['Back: Signals', 'Back to overview']);
  });

  it('reads the next figure from the check, not from the copy', () => {
    const { d, id } = edited('bad-site', (c) => {
      c.without_js!.site_text_share = 0.42;
      c.content!.score = 61;
    });
    expect(segmentFrame(d, id, 'access', { asFirstSeen: true, hrefs }).next.label).toBe(
      'Next: Readable without JavaScript · 42%',
    );
    expect(segmentFrame(d, id, 'structure', { asFirstSeen: true, hrefs }).next.label).toBe(
      'Next: Content an answer engine can quote · 61',
    );
  });

  it('says "not scored yet" for a Content section with no score, rather than a number', () => {
    const { d, id } = edited('bad-site', (c) => {
      c.content = { ...c.content!, score: null, score_withheld: 'no_check_counted' };
    });
    expect(segmentFrame(d, id, 'structure', { asFirstSeen: true, hrefs }).next.label).toBe(
      'Next: Content an answer engine can quote · not scored yet',
    );
  });

  it('drops the figure when the next section was not measured, rather than inventing one', () => {
    const { d, id } = edited('challenged-site');
    expect(segmentFrame(d, id, 'structure', { hrefs }).next.label).toBe(
      'Next: Content an answer engine can quote · not measured',
    );
  });

  it('says how long an unkept audit is kept, and nothing once an account keeps it', () => {
    for (const name of FIXTURE_NAMES) {
      const { d, id } = edited(name);
      const f = segmentFrame(d, id, 'access', { asFirstSeen: asFirstSeen(name), hrefs });
      if (name === 'challenged-site') expect(f.keptUntil).toBeNull();
      else expect(f.keptUntil).toMatch(/^\d{1,2} [A-Z][a-z]{2}, \d\d:\d\d UTC$/);
    }
    const { d, id } = edited('bad-site');
    expect(segmentFrame(d, id, 'access', { asFirstSeen: true, hrefs }).keptUntil).toBe(
      '26 Oct, 02:34 UTC',
    );
  });

  it('has a title and a back name for every key', () => {
    for (const k of SEGMENT_KEYS) {
      expect(SEGMENTS[k].title.length).toBeGreaterThan(0);
      expect(SEGMENTS[k].backName.length).toBeGreaterThan(0);
    }
  });
});
