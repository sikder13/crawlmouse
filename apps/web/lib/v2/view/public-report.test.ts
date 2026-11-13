import { afterEach, describe, expect, it, vi } from 'vitest';
import type { PublicReportRow } from '../../reports';
import { fixture } from '../fixtures';
import { buildPublicSnapshot } from '../reports/build-snapshot';
import type { PublicSnapshotV2 } from '../reports/snapshot';
import { FIRST_AUDIT } from './segment/test-helpers';
import {
  publicReportCard,
  publicReportTitle,
  reportCardOf,
  publicReportView,
  reportPageOf,
} from './public-report';

const MINTED = '2026-11-12T18:00:00.000Z';
const snap = (name: keyof typeof FIRST_AUDIT): PublicSnapshotV2 =>
  buildPublicSnapshot(fixture(name), FIRST_AUDIT[name], MINTED);

afterEach(() => vi.unstubAllEnvs());

describe('publicReportView on the bad site', () => {
  const s = snap('bad-site');
  const v = publicReportView(s);

  it('names the host, the check’s finish and the snapshot’s headline', () => {
    expect(v.host).toBe('example-outfitter.com');
    expect(v.checkedAt).toBe('25 Oct 2026, 02:34 UTC');
    expect(v.headline).toBe(s.headline);
  });

  it('shows both grades, the AI one in the bad tone, as the artboard draws a D', () => {
    expect(v.grades.map((g) => [g.label, g.letter, g.score, g.tone])).toEqual([
      ['Technical SEO', 'B', 79, 'default'],
      ['AI readability', 'D', 41, 'bad'],
    ]);
    expect(v.pages).toBe('214');
    expect(v.fixesFound).toBe(String(s.fixCount));
  });

  it('says Googlebot and Bingbot are allowed by robots.txt, a verified bot not fetched (FACTS B2)', () => {
    const google = v.crawlers.find((c) => c.ua === 'Googlebot')!;
    expect(google).toEqual({
      ua: 'Googlebot',
      verdict: 'allowed',
      qualifier: 'by robots.txt',
      text: '100%',
      cause: 'verified bot, not fetched',
    });
    expect(v.crawlers.find((c) => c.ua === 'Bingbot')!.cause).toBe('verified bot, not fetched');
  });

  it('gives a fetched crawler its own cause, and none a qualifier', () => {
    const gpt = v.crawlers.find((c) => c.ua === 'GPTBot')!;
    expect(gpt).toMatchObject({
      verdict: 'blocked_by_ua_rule',
      qualifier: null,
      cause: 'Cloudflare firewall rule (error 1020)',
    });
    expect(v.crawlers.map((c) => c.ua)).toEqual(s.crawlers.map((c) => c.ua));
  });

  it('heads the fixes as FACTS A5 does, with the rest counted from the snapshot', () => {
    expect(v.fixes!.heading).toBe('The three fixes with the largest estimated effect');
    // 13 fixes found, three shown: FACTS A5's "10 after Web Bot Auth leaves the list".
    expect(s.fixCount).toBe(13);
    expect(v.fixes!.more).toBe('· 10 more in the full audit');
    expect(v.fixes!.rows.map((r) => [r.rank, r.title, r.scope, r.points])).toEqual([
      [1, 'Let GPTBot and PerplexityBot through Cloudflare', null, '+24 AI'],
      [2, 'Server-render the product template', '158 pages', '+22 AI'],
      [3, 'Link the 7 orphan pages from their collections', null, '+4 SEO'],
    ]);
  });

  it('asks the closing question about as many crawlers as the table lists', () => {
    expect(s.crawlers).toHaveLength(8);
    expect(v.ownQuestion).toBe(
      'Is your own site readable by these eight? The fix packets come with your audit.',
    );
  });
});

describe('publicReportView on the other fixtures', () => {
  it('a clean site has no fix section', () => {
    expect(publicReportView(snap('clean-site')).fixes).toBeNull();
  });

  it('a withheld grade carries no letter, and a crawler not measured keeps its cause', () => {
    const v = publicReportView(snap('challenged-site'));
    expect(v.grades[1]).toMatchObject({ withheld: true, letter: null, score: null });
    expect(v.crawlers.find((c) => c.ua === 'Googlebot')).toMatchObject({
      verdict: 'not_measured',
      qualifier: null,
      cause: 'edge challenge on all automation',
    });
  });

  it('one fix shown is "the fix", and none left over says nothing more', () => {
    const s = snap('bad-site');
    const one = publicReportView({ ...s, fixCount: 1, topFixes: s.topFixes.slice(0, 1) });
    expect(one.fixes).toMatchObject({
      heading: 'The fix with the largest estimated effect',
      more: null,
    });
  });
});

describe('publicReportView refuses what the screen could not draw', () => {
  const s = snap('bad-site');
  const [seo, ai] = s.grades;

  it('a verdict outside the vocabulary', () => {
    const crawlers = s.crawlers.map((c, i) => (i === 0 ? { ...c, verdict: 'invited' } : c));
    expect(() => publicReportView({ ...s, crawlers })).toThrow();
  });

  it('a withheld grade with a letter, and a letter outside the scale', () => {
    expect(() => publicReportView({ ...s, grades: [seo, { ...ai, withheld: true }] })).toThrow(
      /withheld/,
    );
    expect(() => publicReportView({ ...s, grades: [seo, { ...ai, letter: 'E' }] })).toThrow(
      /letter/,
    );
  });

  it('more fixes shown than found', () => {
    expect(() => publicReportView({ ...s, fixCount: 2 })).toThrow(/3 fixes of 2/);
  });
});

const row = (extra: Partial<PublicReportRow>): PublicReportRow => ({
  domain: 'example-outfitter.com',
  grade: null,
  score: null,
  cms_detected: null,
  orphan_count: null,
  avg_depth: null,
  takedown_requested_at: null,
  created_at: MINTED,
  claimed_at: null,
  listed: false,
  indexable: false,
  hidden_at: null,
  white_label: null,
  ...extra,
});

describe('reportPageOf', () => {
  const v2 = snap('bad-site') as unknown as PublicReportRow['report_snapshot'];

  it('hands a missing row, a v1 snapshot and a legacy row to v1’s page', () => {
    vi.stubEnv('V2_CHECKS_PUBLIC', '1');
    expect(reportPageOf(null)).toEqual({ kind: 'v1' });
    const v1 = { version: 1, domain: 'ex.com' } as unknown as PublicReportRow['report_snapshot'];
    expect(reportPageOf(row({ grade: 'B', report_snapshot: v1 }))).toEqual({ kind: 'v1' });
    expect(reportPageOf(row({ grade: 'B', report_snapshot: null }))).toEqual({ kind: 'v1' });
  });

  it('a v2 report is gone when hidden, taken down, or with the flag off', () => {
    vi.stubEnv('V2_CHECKS_PUBLIC', '1');
    expect(reportPageOf(row({ report_snapshot: v2, hidden_at: MINTED })).kind).toBe('gone');
    expect(reportPageOf(row({ report_snapshot: v2, takedown_requested_at: MINTED })).kind).toBe(
      'gone',
    );
    vi.stubEnv('V2_CHECKS_PUBLIC', '');
    expect(reportPageOf(row({ report_snapshot: v2 })).kind).toBe('gone');
  });

  it('a live v2 report renders, indexed only as its row says', () => {
    vi.stubEnv('V2_CHECKS_PUBLIC', '1');
    const unlisted = reportPageOf(row({ report_snapshot: v2 }));
    expect(unlisted).toMatchObject({ kind: 'v2', index: false });
    const indexed = reportPageOf(row({ report_snapshot: v2, indexable: true }));
    expect(indexed).toMatchObject({ kind: 'v2', index: true });
  });
});

describe('the title and the card', () => {
  it('titles the report as the artboard does', () => {
    expect(publicReportTitle('example-outfitter.com')).toBe(
      'example-outfitter.com audit — shared by Crawlmouse',
    );
  });

  it('draws host, both grades and the headline; a withheld grade has no score', () => {
    const s = snap('challenged-site');
    expect(publicReportCard(s)).toEqual({
      host: 'granitepeak.example',
      headline: s.headline,
      grades: [
        { label: 'Technical SEO', mark: 'C+', score: '67 / 100', tone: 'default' },
        { label: 'AI readability', mark: 'withheld', score: null, tone: 'default' },
      ],
    });
  });
});

describe('reportCardOf', () => {
  const v2 = snap('bad-site') as unknown as PublicReportRow['report_snapshot'];

  it('draws the v2 card for a live v2 report with the flag on', () => {
    vi.stubEnv('V2_CHECKS_PUBLIC', '1');
    expect(reportCardOf(row({ report_snapshot: v2 }))).toEqual(publicReportCard(snap('bad-site')));
  });

  it('leaves every other row to v1’s card: flag off, v1, missing, hidden, taken down', () => {
    vi.stubEnv('V2_CHECKS_PUBLIC', '');
    expect(reportCardOf(row({ report_snapshot: v2 }))).toBeNull();
    vi.stubEnv('V2_CHECKS_PUBLIC', '1');
    const v1 = { version: 1 } as unknown as PublicReportRow['report_snapshot'];
    expect(reportCardOf(row({ grade: 'B', report_snapshot: v1 }))).toBeNull();
    expect(reportCardOf(null)).toBeNull();
    expect(reportCardOf(row({ report_snapshot: v2, hidden_at: MINTED }))).toBeNull();
    expect(reportCardOf(row({ report_snapshot: v2, takedown_requested_at: MINTED }))).toBeNull();
  });
});
