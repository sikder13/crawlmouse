import { describe, expect, it, vi } from 'vitest';
import { JSDOM } from 'jsdom';
import { renderToStaticMarkup } from 'react-dom/server';
import type { Check, FixtureDataset } from '@crawlmouse/types/v2';
import { findCheck, fixture, type FixtureName } from '../../lib/v2/fixtures';
import { CHECKS } from '../../lib/v2/recordings';
import { FIX_MAP_INVENTORY, type CC24Page } from '../../lib/v2/view/fix-map-inventory';
import { FixPreview } from '../../app/(v2-preview)/v2-preview/_preview/FixPreview';
import { MapPreview } from '../../app/(v2-preview)/v2-preview/_preview/MapPreview';

/**
 * Each field the fix-and-map inventory lists is changed, one at a time, in a copy of the bad-site
 * fixture, and the pages are rendered again by the builders the previews use: the open fix (fix
 * 2), the locked fix (the fourth in order), and the explorer on its hubs with /products/ridge-2p
 * selected. Each page a change names must show the new value, and must not have shown it before.
 * `fixture()` is mocked to return the copy.
 */
const perturbed = vi.hoisted(() => ({ dataset: null as unknown }));

vi.mock('../../lib/v2/fixtures', async (importOriginal) => {
  const real = await importOriginal<typeof import('../../lib/v2/fixtures')>();
  return {
    ...real,
    fixture: (name: FixtureName) =>
      name === 'bad-site' && perturbed.dataset
        ? (perturbed.dataset as FixtureDataset)
        : real.fixture(name),
  };
});

interface Change {
  change: (check: Check, d: FixtureDataset) => void;
  expect: Partial<Record<CC24Page, string[]>>;
}

const fix = (d: FixtureDataset, n: number) =>
  d.fixes.find((f) => f.number === n && f.site_id === '50000000-0000-4000-8000-000000000001')!;
const ridge = (d: FixtureDataset) =>
  d.page_results.find(
    (p) => p.check_id === CHECKS.badFirstAudit && p.url.endsWith('/products/ridge-2p'),
  )!;
const into = (d: FixtureDataset) =>
  d.link_edges.find(
    (e) => e.check_id === CHECKS.badFirstAudit && e.to_url.endsWith('/products/ridge-2p'),
  )!;
const test0 = (d: FixtureDataset) =>
  d.access_tests.find(
    (t) => t.check_id === CHECKS.badFirstAudit && t.page_url.endsWith('/products/ridge-2p') && t.ua,
  )!;
const ba = (d: FixtureDataset, m: string) => fix(d, 2).before_after.find((r) => r.measure === m)!;

const TABLE: Record<string, Record<string, Change[]>> = {
  'fix-head': {
    'fixes[].title': [
      {
        change: (_, d) => {
          fix(d, 2).title = 'Render the product template on the server';
          fix(d, 5).title = 'Rewrite six generic anchors';
        },
        expect: {
          fix: ['Render the product template on the server.'],
          locked: ['Rewrite six generic anchors.'],
        },
      },
    ],
    'fixes[].effect.ai_readability': [
      { change: (_, d) => (fix(d, 2).effect.ai_readability = 23), expect: { fix: ['+23'] } },
    ],
    'fixes[].effect.technical_seo': [
      { change: (_, d) => (fix(d, 5).effect.technical_seo = 7), expect: { locked: ['+7'] } },
    ],
    'fixes[].recommendation_class': [
      {
        change: (_, d) => {
          fix(d, 2).recommendation_class = 'experimental';
          fix(d, 5).recommendation_class = 'confirmed_defect';
        },
        expect: { fix: ['experimental hypothesis'], locked: ['confirmed defect'] },
      },
    ],
  },
  'fix-tiles': {
    'fixes[].affected_pages': [
      {
        change: (_, d) => {
          fix(d, 2).affected_pages = 161;
          fix(d, 5).affected_pages = 9;
        },
        expect: { fix: ['Pages affected 161', 'all 161 pages'], locked: ['Pages affected 9'] },
      },
    ],
    'fixes[].effort': [
      {
        change: (_, d) => {
          fix(d, 2).effort = { kind: 'templates', templates: 2, deploys: 1 };
          fix(d, 5).effort = { kind: 'minutes', minutes: 25 };
        },
        expect: { fix: ['two templates, one deploy'], locked: ['about 25 minutes'] },
      },
    ],
  },
  'fix-before-after': {
    'fixes[].before_after[].today': [
      {
        change: (_, d) => {
          ba(d, 'text_share').today = 0.17;
          ba(d, 'words_without_js').today = 141;
        },
        expect: { fix: ['Text today 17%', 'Words without JavaScript 141'] },
      },
    ],
    'fixes[].before_after[].after': [
      {
        change: (_, d) => (ba(d, 'words_without_js').after = 1250),
        expect: { fix: ['≈ 1,250'] },
      },
    ],
    'fixes[].before_after[].after_bound': [
      {
        change: (_, d) => (ba(d, 'text_share').after_bound = 'exact'),
        expect: { fix: ['Text after, estimated 90%'] },
      },
    ],
  },
  'fix-packet': {
    'fixes[].packet.context': [
      {
        change: (_, d) => (fix(d, 2).packet!.context[1] = 'Problem: the page arrives empty.'),
        expect: { fix: ['Problem: the page arrives empty.'] },
      },
    ],
    'fixes[].packet.change': [
      {
        change: (_, d) => (fix(d, 2).packet!.change[1] = '1. Fetch on the server.'),
        expect: { fix: ['1. Fetch on the server.'] },
      },
    ],
    'fixes[].packet.keep': [
      {
        change: (_, d) => (fix(d, 2).packet!.keep = ['Leave the reviews widget alone.']),
        expect: { fix: ['Leave the reviews widget alone.'] },
      },
    ],
    'fixes[].packet.verify.command': [
      {
        change: (_, d) => (fix(d, 2).packet!.verify.command = 'curl -sA "X/1" https://e.test/'),
        expect: { fix: ['curl -sA "X/1" https://e.test/'] },
      },
    ],
    'fixes[].packet.verify.expect': [
      {
        change: (_, d) => (fix(d, 2).packet!.verify.expect = '≥ 3 (today: 0)'),
        expect: { fix: ['→ expect ≥ 3 (today: 0)'] },
      },
    ],
    'fixes[].packet.verify.ua': [
      {
        change: (_, d) => (fix(d, 2).packet!.verify.ua = 'ClaudeBot'),
        expect: { fix: ['Requests as ClaudeBot'] },
      },
    ],
  },
  'fix-stack': {
    'fixes[].packet.framework': [
      {
        change: (_, d) => (fix(d, 2).packet!.framework = 'webflow'),
        expect: { fix: ['Not on Webflow?'] },
      },
    ],
    'fixes[].packet.frameworks': [
      {
        change: (_, d) => (fix(d, 2).packet!.frameworks = ['nextjs', 'wordpress']),
        expect: { fix: ['Next.js WordPress Keep this audit'] },
      },
    ],
    'checks[].stack.frontend': [
      {
        change: (c) => (c.stack!.frontend!.version = '15'),
        expect: { fix: ['Next.js 15, pages router'] },
      },
    ],
    'checks[].stack.backend': [
      {
        change: (c) => (c.stack!.backend = { cms: 'wordpress', detected_from: 'the REST API' }),
        expect: { fix: ['WordPress as the backend', 'WordPress from the REST API'] },
      },
    ],
  },
  'fix-crawler': {
    'checks[].crawlers[].status': [
      {
        change: (c) => (c.crawlers.find((x) => x.ua === 'OAI-SearchBot')!.status = 203),
        expect: { fix: ['which gets 203 today'] },
      },
    ],
  },
  'map-head': {
    'checks[].coverage.pages_crawled': [
      { change: (c) => (c.coverage!.pages_crawled = 215), expect: { map: ['215 pages,'] } },
    ],
    'checks[].structure.internal_links': [
      { change: (c) => (c.structure!.internal_links = 781), expect: { map: ['781 links.'] } },
    ],
    'withheld[].included': [
      {
        change: (c, d) =>
          (d.withheld.find((w) => w.check_id === c.id && w.collection === 'link_edges')!.included =
            12),
        expect: { map: ['12 of its 779 links'] },
      },
    ],
  },
  'map-filters': {
    'checks[].structure.orphan_pages': [
      { change: (c) => (c.structure!.orphan_pages = 9), expect: { map: ['Orphans · 9'] } },
    ],
    'checks[].structure.js_only_pages': [
      { change: (c) => (c.structure!.js_only_pages = 4), expect: { map: ['JavaScript-only · 4'] } },
    ],
    'checks[].structure.pages_deeper_than_3': [
      {
        change: (c) => (c.structure!.pages_deeper_than_3 = 6),
        expect: { map: ['Deeper than 3 clicks · 6'] },
      },
    ],
  },
  'map-page': {
    'page_results[].depth': [
      { change: (_, d) => (ridge(d).depth = 5), expect: { map: ['depth 5'] } },
    ],
    'page_results[].links_in': [
      {
        change: (_, d) => (ridge(d).links_in = 31),
        expect: { map: ['Links in 31', 'Linked from · 31'] },
      },
    ],
    'page_results[].links_out': [
      { change: (_, d) => (ridge(d).links_out = 19), expect: { map: ['Links out 19', '14 more'] } },
    ],
    'page_results[].pagerank_share': [
      { change: (_, d) => (ridge(d).pagerank_share = 0.006), expect: { map: ['0.6%'] } },
    ],
    'page_results[].crawlers_reached': [
      {
        change: (_, d) => (ridge(d).crawlers_reached = 5),
        expect: { map: ['Crawlers that reach it 5 of 6'] },
      },
    ],
    'page_results[].crawlers_reading_text': [
      {
        change: (_, d) => (ridge(d).crawlers_reading_text = 3),
        expect: { map: ['Crawlers that read its text 3 of 6'] },
      },
    ],
    'page_results[].without_js': [
      {
        change: (_, d) => (ridge(d).without_js!.text_share = 0.41),
        expect: { map: ['41% text without JS'] },
      },
    ],
  },
  'map-links': {
    'link_edges[].anchor_text': [
      {
        change: (_, d) => (into(d).anchor_text = 'Ridge 2P tent'),
        expect: { map: ['"Ridge 2P tent"'] },
      },
    ],
    'link_edges[].is_generic_anchor': [
      {
        change: (_, d) => (into(d).is_generic_anchor = true),
        expect: { map: ['"Ridge 2P" generic'] },
      },
    ],
  },
  'map-access': {
    'access_tests[].verdict': [
      {
        change: (_, d) => (test0(d).verdict = 'blocked_by_ua_rule'),
        expect: { map: ['OAI-SearchBot blocked by a rule'] },
      },
    ],
    'access_tests[].word_count': [
      { change: (_, d) => (test0(d).word_count = 990), expect: { map: ['990 words'] } },
    ],
  },
};

/** The visible text, each text node set apart by a space, as a reader would scan it. */
const text = (markup: string) => {
  const { window } = new JSDOM(`<body>${markup}</body>`);
  const doc = window.document;
  doc.querySelectorAll('svg, [data-v2-sr-only]').forEach((e) => e.remove());
  const walker = doc.createTreeWalker(doc.body, window.NodeFilter.SHOW_TEXT);
  const parts: string[] = [];
  for (let n = walker.nextNode(); n; n = walker.nextNode()) parts.push(n.textContent ?? '');
  return parts.join(' ').replace(/\s+/g, ' ');
};

function render(page: CC24Page, d: FixtureDataset | null): string {
  perturbed.dataset = d;
  try {
    return text(
      renderToStaticMarkup(
        page === 'map' ? (
          <MapPreview variant="bad-site" />
        ) : (
          <FixPreview variant={page === 'fix' ? 'bad-site' : 'locked'} />
        ),
      ),
    );
  } finally {
    perturbed.dataset = null;
  }
}

describe('the fix-and-map inventory, against the fixture', () => {
  it('has a change for every field of every entry, and none for anything it does not list', () => {
    const listed = new Map(FIX_MAP_INVENTORY.map((e) => [e.id, e]));
    expect(Object.keys(TABLE).sort()).toEqual([...listed.keys()].sort());
    for (const [id, fields] of Object.entries(TABLE)) {
      const e = listed.get(id)!;
      expect(Object.keys(fields).sort(), id).toEqual([...e.fields].sort());
      const shown = new Set(
        Object.values(fields).flatMap((cs) => cs.flatMap((c) => Object.keys(c.expect))),
      );
      expect([...shown].sort(), id).toEqual([...e.pages].sort());
    }
  });

  const cases = Object.entries(TABLE).flatMap(([id, fields]) =>
    Object.entries(fields).flatMap(([field, changes]) =>
      changes.map((c) => [`${id} · ${field}`, c] as const),
    ),
  );

  it.each(cases)('%s: each page named shows the new value, which it did not before', (_, c) => {
    const d = structuredClone(fixture('bad-site'));
    c.change(findCheck(d, CHECKS.badFirstAudit), d);
    for (const [page, wanted] of Object.entries(c.expect) as [CC24Page, string[]][]) {
      const before = render(page, null);
      const after = render(page, d);
      for (const w of wanted) {
        expect(before, `${page} already shows "${w}"`).not.toContain(w);
        expect(after, `${page} does not show "${w}"`).toContain(w);
      }
    }
  });
});
