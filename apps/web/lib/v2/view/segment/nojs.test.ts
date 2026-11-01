import { describe, expect, it } from 'vitest';
import { FIXTURE_NAMES } from '../../fixtures';
import { resultView } from '../result';
import { nojsView } from './nojs';
import { asFirstSeen, edited } from './test-helpers';

const view = (name: (typeof FIXTURE_NAMES)[number], edit?: Parameters<typeof edited>[1]) => {
  const { d, id } = edited(name, edit);
  return nojsView(d, id, { asFirstSeen: asFirstSeen(name) });
};

describe('nojsView: the headline', () => {
  it('names the thin template and the range its measured pages keep', () => {
    const v = view('bad-site');
    expect(v.headline.title).toBe(
      'Your product template keeps 11–12% of its text without JavaScript.',
    );
    expect(v.headline.pill).toEqual({ state: 'warn', label: '31% site-wide' });
    expect(v.headline.body).toBe(
      'OAI-SearchBot, ChatGPT-User, Claude-SearchBot and ClaudeBot read the HTML your server sends and do not run scripts; PerplexityBot and GPTBot would too, once they get in. On the two product pages measured, that HTML holds 134 and 121 words; a browser renders 1,120 and 1,084. All 158 product pages share the template. The homepage, collections and blog are fine, so this is one template, not a site-wide problem. Measured 25 Oct 2026 at 02:33 UTC.',
    );
  });

  it('reads the range from the rows, not the copy', () => {
    const v = view('bad-site', (_, d) => {
      d.page_results.find((p) => p.url.endsWith('/alpine-stove'))!.without_js!.text_share = 0.05;
    });
    expect(v.headline.title).toBe(
      'Your product template keeps 5–12% of its text without JavaScript.',
    );
  });

  it('says every template ships its text when none is thin', () => {
    const v = view('clean-site');
    expect(v.headline.title).toBe('Every template ships its text without JavaScript.');
    expect(v.headline.pill).toEqual({ state: 'ok', label: '98% site-wide' });
  });

  it('says the share was measured with a browser where the edge blocks all automation', () => {
    const v = view('challenged-site');
    expect(v.headline.title).toBe('71% of the text is in the HTML before JavaScript runs.');
    expect(v.headline.body).toMatch(
      /^The site’s edge blocks all automation from our published IPs/,
    );
  });
});

describe('nojsView: tiles, rows and the measured set', () => {
  it('reads the tiles from the check and the rows', () => {
    expect(view('bad-site').tiles).toEqual([
      { label: 'Text without JavaScript, site', value: '31%', note: null },
      { label: 'Product pages sharing the template', value: '158', note: null },
      { label: 'Words on /products/ridge-2p', value: '134 raw · 1,120 rendered', note: null },
      { label: 'Pages measured', value: '50 of 214', note: null },
    ]);
  });

  it('lists the sampled pages with a measurement, in template order', () => {
    const v = view('bad-site');
    expect(
      v.rows.map((r) => [r.path, r.section, r.raw, r.rendered, r.share, r.status.label]),
    ).toEqual([
      ['/', 'Homepage', '612', '651', '94%', 'readable'],
      ['/collections/tents', 'Collections · 42', '488', '554', '88%', 'readable'],
      ['/products/ridge-2p', 'Products · 158', '134', '1,120', '12%', 'empty shell'],
      ['/products/alpine-stove', 'Products · 158', '121', '1,084', '11%', 'empty shell'],
      ['/blog/winter-camping', 'Blog · 13', '1,902', '1,960', '97%', 'readable'],
    ]);
    expect(v.rows[2]!.status.state).toBe('bad');
  });

  it('says the measured set in FACTS’ words, and how much of it the record holds', () => {
    const v = view('bad-site');
    expect(v.measuredSet).toBe(
      '50 pages (at most 50), chosen across every template, measured without JavaScript; every page with Pro (10 full renders a month; Agency 30).',
    );
    expect(v.recordLine).toBe('5 of the 50 measured pages are in this record.');
    expect(view('clean-site').measuredSet).toBe('Every page was measured without JavaScript.');
    expect(view('challenged-site').recordLine).toBe(
      '0 of the 12 measured pages are in this record.',
    );
  });

  it('opens on the thin template’s first page, with the server’s HTML beside the rendered page', () => {
    const v = view('bad-site');
    expect(v.initial).toBe('https://example-outfitter.com/products/ridge-2p');
    const e = v.rows[2]!.evidence!;
    expect(e.title).toBe('Evidence · /products/ridge-2p · 02:33:41 UTC');
    expect(e.raw).toBe('<title>Ridge 2P Tent – Example Outfitter</title>\n\n134 words.');
    expect(e.rendered).toBe(
      'Ridge 2P Tent · $329 Two-person, three-season backpacking tent.\n\n1,120 words.',
    );
    expect(v.rows[0]!.evidence).toBeNull();
    expect(v.missing).toBe(
      'This record holds 8 of the 408 responses the audit kept, and this page’s are not among them.',
    );
  });
});

describe('nojsView: fixes and the keep bar', () => {
  it('says there is no Pro fix here and names the other free fixes from the data', () => {
    const v = view('bad-site');
    expect(v.fixes.summary).toBe('1 open');
    expect(v.fixesNote).toBe(
      'No Pro-only fixes in this section. The three free fixes of this audit are this one, let GPTBot and PerplexityBot through Cloudflare in Crawler access, and link the 7 orphan pages from their collections in Structure.',
    );
  });

  it('asks to keep the audit in the thin template’s words', () => {
    expect(view('bad-site').keep).toEqual({
      title:
        'Keep this audit: an email when the product template starts shipping its text, and every fix for 14 days.',
      sub: 'One email creates a free account that re-checks monthly, with 14 days of Pro to start, including CSV and PDF export. Otherwise this page expires 26 Oct, 02:34 UTC.',
    });
    expect(view('challenged-site').keep).toBeNull();
  });

  it('draws the door’s coverage line from the sample', () => {
    expect(view('bad-site').coverage).toEqual({ tested: 50, total: 214, groups: 4 });
  });
});

describe('nojsView: which templates arrive empty, by the one shared rule', () => {
  const blockAll = (c: import('@crawlmouse/types/v2').Check) => {
    for (const x of c.crawlers.filter((k) => k.group !== 'search_engine')) {
      x.verdict = 'blocked_by_ua_rule';
      x.by_template = x.by_template.map((t) => ({ ...t, verdict: 'blocked_by_ua_rule' }));
    }
  };

  it('does not say every template ships its text when no AI crawler got in', () => {
    const { d, id } = edited('bad-site', blockAll);
    const v = nojsView(d, id, { asFirstSeen: true });
    expect(v.headline.title).toBe('31% of the text is in the HTML before JavaScript runs.');
    expect(v.headline.body).toContain('No AI crawler got in');
    expect(JSON.stringify(v)).not.toContain('Every template ships');
    const door = resultView(d, id, { map: { nodes: [], positions: {} }, asFirstSeen: true })
      .doors[1]!;
    expect(door.body).toMatch(/^Measured with a rendering browser/);
  });

  it('names the same thin templates as the Result door when a kept-out crawler reads one', () => {
    // GPTBot is kept out overall but read product pages in full: proof the HTML holds their text.
    const { d, id } = edited('bad-site', (c) => {
      c.crawlers
        .find((x) => x.ua === 'GPTBot')!
        .by_template.find((t) => t.template_key === '/products/{slug}')!.verdict = 'allowed';
    });
    const v = nojsView(d, id, { asFirstSeen: true });
    const door = resultView(d, id, { map: { nodes: [], positions: {} }, asFirstSeen: true })
      .doors[1]!;
    expect(v.headline.title).toBe('Every template ships its text without JavaScript.');
    expect(door.body).toMatch(/^Every template ships its text/);
  });
});
