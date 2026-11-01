import { describe, expect, it } from 'vitest';
import { FIXTURE_NAMES } from '../../fixtures';
import { contentView } from './content';
import { asFirstSeen, edited } from './test-helpers';

const view = (name: (typeof FIXTURE_NAMES)[number], edit?: Parameters<typeof edited>[1]) => {
  const { d, id } = edited(name, edit);
  return contentView(d, id, { asFirstSeen: asFirstSeen(name) });
};

describe('contentView: headline and tiles', () => {
  it('says which sections answer engines can quote, from the direct-answer check', () => {
    const v = view('bad-site');
    expect(v.headline.title).toBe(
      'Answer engines can quote your blog. Not your collections and products.',
    );
    expect(v.headline.pill).toEqual({ state: 'warn', label: '58 / 100' });
    expect(v.headline.body).toBe(
      'An answer engine quotes a page when it finds a direct, self-contained statement near the top, under a heading that matches the question. Of the pages read, these do: the homepage, 9 of 42 collection pages, 31 of 158 product pages and 11 of 13 blog posts; 52 of 214 in all. This is measured on the rendered page, so it is separate from the JavaScript problem; fixing that first makes the product numbers matter. Measured 25 Oct 2026 at 02:33 UTC.',
    );
  });

  it('reads the tiles from the checks: all pages, the weakest and strongest sections, schema', () => {
    expect(view('bad-site').tiles).toEqual([
      { label: 'Pages with a quotable opening', value: '52 of 214', note: null },
      { label: 'Product pages', value: '31 of 158', note: null },
      { label: 'Blog posts', value: '11 of 13', note: null },
      { label: 'Product schema with description', value: '158 of 158', note: null },
    ]);
  });

  it('says so when every section answers', () => {
    expect(view('clean-site').headline.title).toBe('Answer engines can quote every section.');
    expect(view('clean-site').headline.pill.state).toBe('ok');
  });

  it('says what was not measured, and why, when the content checks did not run', () => {
    const v = view('challenged-site');
    expect(v.headline.title).toBe('Whether pages open with a quotable answer was not measured.');
    expect(v.headline.pill).toEqual({ state: 'neutral', label: 'not measured' });
    expect(v.headline.body).toBe(
      'The site’s edge blocks all automation, so whether the pages open with a quotable answer could not be measured.',
    );
    expect(v.grid).toBeNull();
    expect(v.coverage).toEqual({ read: 'No page was read for these checks.' });
  });
});

describe('contentView: the grid', () => {
  it('has a row per recorded check and a cell per section, "—" where a check does not apply', () => {
    const g = view('bad-site').grid!;
    expect(g.rows.map((r) => [r.label, ...r.cells.map((c) => c?.text ?? '—')])).toEqual([
      ['A direct answer in the first 150 words', 'yes', '9 of 42', '31 of 158', '11 of 13'],
      ['Headings phrased as the question', 'yes', '0 of 42', '4 of 158', '12 of 13'],
      ['Product or Article schema with a description', 'yes', '42 of 42', '158 of 158', '13 of 13'],
      ['Author and date visible', '—', '—', '—', '6 of 13'],
      ['Specifications as a table or list, not an image', '—', '—', '97 of 158', '—'],
    ]);
    expect(g.rows[0]!.cells.map((c) => c?.state)).toEqual(['ok', 'warn', 'warn', 'ok']);
    expect(g.rows[1]!.cells[1]!.state).toBe('bad');
    // 97 of 158 is 61%: some, not 80% or more, so ▲ (the locked legend's boundaries).
    expect(g.rows[4]!.cells[2]).toMatchObject({ text: '97 of 158', state: 'warn' });
    expect(g.rows[3]!.cells[3]).toMatchObject({ text: '6 of 13', state: 'warn' });
    expect(g.notChecked).toBeNull();
  });

  it('names the checks a clean audit did not record', () => {
    expect(view('clean-site').grid!.notChecked).toBe(
      'Not checked in this audit: headings phrased as the question, author and date visible and specifications as a table or list, not an image.',
    );
  });

  it('lists the pages in the record that fail a cell, and opens on the weakest section’s first check', () => {
    const v = view('bad-site');
    const cell = v.grid!.rows[0]!.cells[2]!;
    expect(v.initial).toBe(cell.id);
    expect(cell.failing).toEqual(['/products/ridge-2p', '/products/alpine-stove']);
    expect(cell.evidence!.title).toBe(
      'Evidence · /products/ridge-2p · first 150 words a crawler reads, rendered',
    );
    expect(cell.evidence!.text).toBe(
      'Ridge 2P Tent · $329 Two-person, three-season backpacking tent.',
    );
    expect(v.grid!.rows[3]!.cells[3]!.failing).toEqual([]);
  });
});

describe('contentView: fixes', () => {
  it('rebuilds the note from the free fixes elsewhere and the effects still pending', () => {
    expect(view('bad-site').fixesNote).toBe(
      'The three free fixes of this audit are the three with the largest estimated effect: let GPTBot and PerplexityBot through Cloudflare, server-render the product template and link the 7 orphan pages from their collections. The three below are on Pro, which starts free for 14 days with the email below. Their effect on AI readability is not estimated yet: the crawlers that would quote these pages cannot read them until fixes 1 and 2 land, so each carries only its Technical SEO point for now.',
    );
  });

  it('draws the door’s coverage line: the pages the checks read', () => {
    expect(view('bad-site').coverage).toEqual({ pages: { tested: 214, total: 214, groups: 4 } });
  });
});

describe('contentView: a one-page section that fails', () => {
  it('is not hidden behind "every section"', () => {
    const v = view('clean-site', (c) => {
      const home = c
        .content!.checks.find((x) => x.check === 'direct_answer_150')!
        .by_template.find((t) => t.template_key === '/')!;
      home.passing = 0;
    });
    expect(v.headline.title).not.toBe('Answer engines can quote every section.');
    expect(v.headline.title).toContain('Not your homepage');
  });
});
