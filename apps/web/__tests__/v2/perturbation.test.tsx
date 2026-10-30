import { describe, expect, it, vi } from 'vitest';
import { JSDOM } from 'jsdom';
import { renderToStaticMarkup } from 'react-dom/server';
import type { Check, FixtureDataset } from '@crawlmouse/types/v2';
import { findCheck, fixture, siteOf, type FixtureName } from '../../lib/v2/fixtures';
import { CHECKS, type RecordingName } from '../../lib/v2/recordings';
import type { Recording } from '../../lib/v2/recording';
import { INVENTORY, type Screen } from '../../lib/v2/view/inventory';
import { crawlElement, homeElement, resultElement } from './_lib/screens';

/**
 * Each field the inventory lists is changed, one at a time, in a copy of a contract fixture, and the
 * screens are rendered again by the builders the previews use (`_lib/screens.tsx`: Home, the
 * Result, and the Crawl screen at the end of its replay). Each screen the entry names must show the
 * new value, and must not have shown it before.
 *
 * Three modules are mocked so those builders read the copy. `fixture()` returns the copy for the
 * fixture being changed, and the real dataset otherwise. `recording()` memoises per dataset rather
 * than per name, so a changed copy is replayed afresh. `mapDrawing()` returns the map's nodes with
 * no positions and no memo: positions draw no text, and the layout has its own tests.
 */
const perturbed = vi.hoisted(() => ({ name: null as string | null, dataset: null as unknown }));

vi.mock('../../lib/v2/fixtures', async (importOriginal) => {
  const real = await importOriginal<typeof import('../../lib/v2/fixtures')>();
  return {
    ...real,
    fixture: (name: FixtureName) =>
      name === perturbed.name ? (perturbed.dataset as FixtureDataset) : real.fixture(name),
  };
});

vi.mock('../../lib/v2/recordings', async (importOriginal) => {
  const real = await importOriginal<typeof import('../../lib/v2/recordings')>();
  const { fixture } = await import('../../lib/v2/fixtures');
  const { synthesise } = await import('../../lib/v2/synthesise');
  const made = new WeakMap<FixtureDataset, Map<RecordingName, Recording>>();
  return {
    ...real,
    recording: (name: RecordingName) => {
      const spec = real.recordingSpec(name);
      const d = fixture(spec.fixture);
      const forDataset = made.get(d) ?? new Map<RecordingName, Recording>();
      made.set(d, forDataset);
      if (!forDataset.has(name)) forDataset.set(name, synthesise(spec, d));
      return forDataset.get(name)!;
    },
  };
});

vi.mock('../../lib/v2/view/map', async (importOriginal) => {
  const real = await importOriginal<typeof import('../../lib/v2/view/map')>();
  const { recording } = await import('../../lib/v2/recordings');
  const { layoutInput } = await import('../../lib/v2/map-layout');
  const { stateAt } = await import('../../lib/v2/progress');
  return {
    ...real,
    mapDrawing: (name: RecordingName, at = Infinity) => ({
      nodes: layoutInput(stateAt(recording(name).events, at).nodes),
      positions: {},
    }),
  };
});

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

/** Each fixture's first audit, its Result preview, and its crawl recording. */
const SHOWN = {
  'bad-site': { check: CHECKS.badFirstAudit, result: 'bad-site', crawl: 'bad-site' },
  'clean-site': { check: CHECKS.cleanFirstAudit, result: 'clean', crawl: 'clean-site' },
  'challenged-site': {
    check: CHECKS.challengedFirstAudit,
    result: 'challenged',
    crawl: 'challenged-site',
  },
} as const;

/** The screens built from `dataset` standing in for fixture `name`; Home shows the bad site only. */
function screens(name: FixtureName, dataset: FixtureDataset | null): Record<Screen, string> {
  perturbed.name = dataset ? name : null;
  perturbed.dataset = dataset;
  try {
    return {
      Home: name === 'bad-site' ? text(renderToStaticMarkup(homeElement())) : '',
      Result: text(renderToStaticMarkup(resultElement(SHOWN[name].result))),
      Crawl: text(renderToStaticMarkup(crawlElement(SHOWN[name].crawl, 'end'))),
    };
  } finally {
    perturbed.name = null;
    perturbed.dataset = null;
  }
}

interface Change {
  /** The fixture changed; the bad site unless named. */
  fixture?: FixtureName;
  change: (check: Check, d: FixtureDataset) => void;
  expect: Partial<Record<Screen, string[]>>;
}

const crawler = (c: Check, ua: string) => c.crawlers.find((x) => x.ua === ua)!;
/** The bad site's fix at a rank. */
const fixRanked = (d: FixtureDataset, rank: number) => {
  const site = findCheck(d, CHECKS.badFirstAudit).site_id;
  return d.fixes.find((f) => f.site_id === site && f.rank === rank)!;
};
const ridge = (d: FixtureDataset) =>
  d.page_results.find((p) => p.url.endsWith('/products/ridge-2p'))!.without_js!;

/** For each inventory entry, for each field it lists, the changes to it and what each screen shows. */
const PERTURB: Record<string, Record<string, Change[]>> = {
  domain: {
    'sites[].host': [
      {
        change: (c, d) => (siteOf(d, c).host = 'example-outdoors.com'),
        expect: {
          Home: ['example-outdoors.com'],
          Result: ['example-outdoors.com'],
          Crawl: ['example-outdoors.com'],
        },
      },
    ],
  },
  'crawl-time': {
    'checks[].started_at': [
      {
        change: (c) => (c.started_at = '2026-10-25T02:31:40Z'),
        expect: { Home: ['2 min 20 s'], Crawl: ['2:20 in all'] },
      },
    ],
    'checks[].finished_at': [
      {
        change: (c) => (c.finished_at = '2026-10-25T02:36:00Z'),
        expect: { Home: ['4 min 11 s'], Crawl: ['4:11 in all'] },
      },
    ],
  },
  'crawled-at': {
    'checks[].finished_at': [
      {
        change: (c) => (c.finished_at = '2026-10-25T02:36:00Z'),
        expect: { Result: ['25 Oct 2026, 02:36 UTC', 'kept until 26 Oct, 02:36 UTC'] },
      },
    ],
    'checks[].expires_at': [
      {
        change: (c) => (c.expires_at = '2026-10-26T09:00:00Z'),
        expect: { Result: ['kept until 26 Oct, 09:00 UTC'] },
      },
    ],
  },
  'pages-crawled': {
    'checks[].coverage.pages_crawled': [
      {
        // Four fewer pages crawled, taken from the largest template so the templates still add up.
        change: (c) => {
          c.coverage!.pages_crawled = 210;
          c.coverage!.templates.find((t) => t.label === 'Products')!.pages -= 4;
        },
        expect: { Result: ['210 of 214 pages crawled'] },
      },
    ],
  },
  'pages-found': {
    'checks[].coverage.pages_discovered': [
      {
        change: (c) => (c.coverage!.pages_discovered = 230),
        expect: {
          Home: ['214 of 230 pages'],
          Result: ['214 of 230 pages crawled', 'Tested 50 of 230 pages'],
        },
      },
    ],
  },
  'template-size': {
    'checks[].coverage.templates[].pages': [
      {
        // Two more product pages: the crawl and the estimate grow with them, as they must.
        change: (c) => {
          c.coverage!.templates.find((t) => t.label === 'Products')!.pages = 160;
          c.coverage!.pages_crawled = 216;
          c.coverage!.pages_discovered = 216;
        },
        expect: {
          Home: [
            'Product pages · 160',
            '160 product pages share this template',
            '216 of 216 pages',
          ],
          Result: ['so 160 pages are near-empty'],
          Crawl: ['216 pages crawled'],
        },
      },
    ],
  },
  links: {
    'checks[].structure.internal_links': [
      {
        change: (c) => (c.structure!.internal_links = 801),
        expect: { Home: ['801 links'], Result: ['801 links'], Crawl: ['801 links'] },
      },
    ],
  },
  seo: {
    'checks[].technical_seo.grade': [
      {
        change: (c) => (c.technical_seo!.grade = 'B-'),
        expect: {
          Home: ['Technical SEO B- 79 / 100'],
          Result: ['Technical SEO B- 79 / 100'],
          Crawl: ['Technical SEO B- 79 / 100'],
        },
      },
    ],
    'checks[].technical_seo.score': [
      {
        change: (c) => (c.technical_seo!.score = 78),
        expect: {
          Home: ['Technical SEO B 78 / 100'],
          Result: ['Technical SEO B 78 / 100'],
          Crawl: ['Technical SEO B 78 / 100'],
        },
      },
    ],
  },
  ai: {
    'checks[].ai_readability.grade': [
      {
        change: (c) => {
          if (c.ai_readability!.withheld) throw new Error('bad-site is graded');
          c.ai_readability!.grade = 'D-';
        },
        expect: {
          Home: ['AI readability D- 41 / 100'],
          Result: ['AI readability D- 41 / 100'],
          Crawl: ['AI readability D- 41 / 100'],
        },
      },
    ],
    'checks[].ai_readability.total': [
      {
        change: (c) => {
          const ai = c.ai_readability!;
          if (ai.withheld) throw new Error('bad-site is graded');
          // The contract requires the total to be the sum of its components.
          ai.total = 47;
          ai.components.access.score += 6;
        },
        expect: {
          Home: ['AI readability D 47 / 100'],
          Result: ['AI readability D 47 / 100'],
          Crawl: ['AI readability D 47 / 100'],
        },
      },
    ],
  },
  'ai-withheld': {
    'checks[].ai_readability.access_range': [
      {
        fixture: 'challenged-site',
        change: (c) => {
          const ai = c.ai_readability!;
          if (!ai.withheld) throw new Error('challenged-site is withheld');
          ai.access_range.max = 25;
        },
        expect: { Result: ['between 0 and 25 of 40'], Crawl: ['between 0 and 25 of 40'] },
      },
    ],
  },
  verdicts: {
    'checks[].crawlers[].verdict': [
      {
        change: (c) => (crawler(c, 'PerplexityBot').verdict = 'refused_unverified'),
        expect: {
          Home: ['PerplexityBot is admitted only from verified IPs'],
          Result: ['PerplexityBot is admitted only from verified IPs'],
          Crawl: ['PerplexityBot is admitted only from verified IPs'],
        },
      },
    ],
    'checks[].crawlers[].evidence_class': [
      {
        change: (c) => (crawler(c, 'PerplexityBot').evidence_class = 'observed'),
        expect: {
          Home: ['PerplexityBot gets a challenge page, in the site’s own logs'],
          Result: ['PerplexityBot gets a challenge page, in the site’s own logs'],
          Crawl: ['PerplexityBot gets a challenge page, in the site’s own logs'],
        },
      },
    ],
    'checks[].crawlers[].by_template': [
      {
        change: (c) => {
          for (const ua of ['OAI-SearchBot', 'ChatGPT-User', 'Claude-SearchBot']) {
            crawler(c, ua).by_template.find((t) => t.template_key === '/blog/{slug}')!.verdict =
              'allowed_thin';
          }
        },
        expect: {
          Home: ['Product pages and blog posts are empty without JavaScript'],
          Result: ['product pages and blog posts are empty to the other three'],
          Crawl: ['Product pages and blog posts are empty without JavaScript'],
        },
      },
    ],
  },
  obstacle: {
    'checks[].crawlers[].cause': [
      {
        change: (c) => (crawler(c, 'GPTBot').cause = 'robots_txt_disallow'),
        expect: {
          Home: ['a robots.txt rule'],
          Result: ['One robots.txt rule and one bot setting', 'GPTBot is blocked by a rule;'],
        },
      },
    ],
  },
  'text-share': {
    'checks[].crawlers[].text_share': [
      {
        change: (c) => (crawler(c, 'ClaudeBot').text_share = 0.44),
        expect: { Home: ['44%'] },
      },
      {
        // The bad site's Result and Crawl print no crawler's share; the clean bill's do.
        fixture: 'clean-site',
        change: (c) => (crawler(c, 'OAI-SearchBot').text_share = 0.44),
        expect: {
          Result: ['read 44% of the text or more', '200 44%'],
          Crawl: ['read 44% of the text or more'],
        },
      },
    ],
  },
  words: {
    'page_results[].without_js.rendered_words': [
      {
        change: (_, d) => (ridge(d).rendered_words = 1300),
        expect: { Home: ['A browser sees 1,300 words'] },
      },
    ],
    'page_results[].without_js.raw_words': [
      {
        change: (_, d) => (ridge(d).raw_words = 150),
        expect: { Home: ['sees 150 words · 13%'] },
      },
    ],
  },
  alert: {
    'changes[].summary': [
      {
        change: (_, d) =>
          (d.changes[0]!.summary = 'Claude-SearchBot is now refused on example-outfitter.com'),
        expect: { Home: ['Claude-SearchBot is now refused'] },
      },
    ],
    'changes[].detected_at': [
      {
        change: (_, d) => (d.changes[0]!.detected_at = '2026-10-30T11:15:00Z'),
        expect: { Home: ['Fri 07:15'] },
      },
    ],
    'changes[].where': [
      {
        change: (_, d) => (d.changes[0]!.where = '/robots.txt?v=2'),
        expect: { Home: ['/robots.txt?v=2 changed'] },
      },
    ],
    'changes[].cause.changed_at': [
      {
        change: (_, d) => (d.changes[0]!.cause!.changed_at = '2026-10-29T21:05:00Z'),
        expect: { Home: ['changed Thu 17:05'] },
      },
    ],
    'changes[].cause.diff': [
      {
        change: (_, d) => d.changes[0]!.cause!.diff!.added.push('Allow: /blog/'),
        expect: { Home: ['+ Allow: /blog/'] },
      },
    ],
    'changes[].pages_affected': [
      {
        change: (_, d) => (d.changes[0]!.pages_affected = 199),
        expect: { Home: ['199 pages affected'] },
      },
    ],
  },
  'fix-first': {
    'fixes[].title': [
      {
        change: (_, d) => (fixRanked(d, 1).title = 'Let every AI crawler through the edge'),
        expect: { Result: ['If you fix one thing today Let every AI crawler through the edge'] },
      },
    ],
    'fixes[].effort': [
      {
        change: (_, d) => (fixRanked(d, 1).effort = { kind: 'minutes', minutes: 25 }),
        expect: { Result: ['about 25 minutes'] },
      },
    ],
    'fixes[].effect': [
      {
        change: (_, d) => (fixRanked(d, 1).effect.ai_readability = 30),
        expect: { Result: ['AI readability 41 → 71, estimated', '+30 AI'] },
      },
    ],
  },
  'without-js': {
    'checks[].without_js.site_text_share': [
      {
        change: (c) => (c.without_js!.site_text_share = 0.27),
        expect: { Result: ['27% of text'] },
      },
    ],
  },
  orphans: {
    'checks[].structure.orphan_pages': [
      {
        // More than the fixture's seven named orphans: the eighth is generated.
        change: (c) => (c.structure!.orphan_pages = 8),
        expect: {
          Home: ['8 orphan pages'],
          Result: ['eight pages nobody links to', '8 orphans'],
          Crawl: ['8 orphan pages'],
        },
      },
    ],
  },
  structure: {
    'checks[].technical_seo.site_structure_score': [
      {
        change: (c) => (c.technical_seo!.site_structure_score = 66),
        expect: { Result: ['Uneven structure', 'Site structure 66 / 100'] },
      },
    ],
    'checks[].structure.pages_deeper_than_3': [
      {
        change: (c) => (c.structure!.pages_deeper_than_3 = 5),
        expect: { Result: ['five pages deeper than three clicks'] },
      },
    ],
    'checks[].structure.generic_anchor_share': [
      {
        change: (c) => (c.structure!.generic_anchor_share = 0.1),
        expect: { Result: ['deeper than three clicks. Four hubs'] },
      },
    ],
    'checks[].structure.hubs': [
      {
        change: (c) => (c.structure!.hubs = 5),
        expect: { Result: ['Five hubs carry'] },
      },
    ],
    'checks[].structure.hub_pagerank_share': [
      {
        change: (c) => (c.structure!.hub_pagerank_share = 0.57),
        expect: { Result: ["carry 57% of the site's PageRank"] },
      },
    ],
  },
  content: {
    'checks[].content.score': [
      {
        change: (c) => (c.content!.score = 61),
        expect: { Result: ['Content an answer engine can quote 61 / 100'] },
      },
    ],
    'checks[].content.checks[].by_template': [
      {
        change: (c) => {
          const schema = c.content!.checks.find((x) => x.check === 'schema_with_description')!;
          schema.by_template.find((r) => r.template_key === '/collections/{slug}')!.passing = 0;
        },
        expect: { Result: ['not on collection pages'] },
      },
    ],
  },
  signals: {
    'checks[].signals[].state': [
      {
        change: (c) => (c.signals.find((s) => s.signal === 'schema_org')!.state = 'not_detected'),
        expect: { Result: ['1 of 7 present', 'No Schema'] },
      },
    ],
    'checks[].signals[].counts_toward_grade': [
      {
        change: (c) => (c.signals.find((s) => s.signal === 'llms_txt')!.counts_toward_grade = true),
        expect: { Result: ['Schema, Content Signals and llms.txt count'] },
      },
    ],
    'checks[].signals[].evidence': [
      {
        change: (c) =>
          (c.signals.find((s) => s.signal === 'web_bot_auth')!.evidence =
            'the directory answered 403'),
        expect: { Result: ['Web Bot Auth: the directory answered 403'] },
      },
    ],
  },
  findings: {
    'fixes[].title': [
      {
        // Rank 5 is the last fix the Result names; the crawl's strip shows the newest finding.
        change: (_, d) => (fixRanked(d, 5).title = 'Rewrite the six vague anchors'),
        expect: { Result: ['Rewrite the six vague anchors'] },
      },
      {
        change: (_, d) => (fixRanked(d, 9).title = 'Date and sign the seven journal posts'),
        expect: { Crawl: ['Date and sign the seven journal posts'] },
      },
    ],
    'fixes[].first_seen_check_id': [
      {
        // Fix 0 was first seen at a later check; seen at the first audit, it ranks third.
        change: (_, d) => (fixRanked(d, 3).first_seen_check_id = CHECKS.badFirstAudit),
        expect: {
          Result: ['Remove the Claude-SearchBot block from robots.txt'],
          Crawl: ['Fourteen fixes found'],
        },
      },
    ],
  },
  'next-band': {
    'fixes[].effect': [
      {
        change: (_, d) => (fixRanked(d, 5).effect.technical_seo = 1),
        expect: {
          Home: ['Three fixes take it to A-'],
          Result: ['Three fixes take it to A-'],
          Crawl: ['Three fixes take it to A-'],
        },
      },
    ],
  },
  'fix-rows': {
    'fixes[].rank': [
      {
        change: (_, d) => {
          const [five, six] = [fixRanked(d, 5), fixRanked(d, 6)];
          [five.rank, six.rank] = [6, 5];
        },
        expect: {
          Result: ['two-sentence answer +1 SEO See with Pro Replace the generic anchor text'],
        },
      },
    ],
    'fixes[].affected_pages': [
      {
        change: (_, d) => (fixRanked(d, 2).affected_pages = 150),
        expect: { Result: ['Server-render the product template · 150 pages'] },
      },
    ],
    'fixes[].template_key': [
      {
        change: (_, d) => (fixRanked(d, 1).template_key = '/products/{slug}'),
        expect: { Result: ['through Cloudflare · 214 pages'] },
      },
    ],
  },
  coverage: {
    'checks[].coverage.pages_sampled': [
      {
        change: (c) => (c.coverage!.pages_sampled = 48),
        expect: { Result: ['Tested 48 of 214 pages across 4 groups'] },
      },
    ],
  },
};

const CASES = Object.entries(PERTURB).flatMap(([id, fields]) =>
  Object.entries(fields).flatMap(([field, changes]) =>
    changes.map((c, i) => ({
      label: `${id}: ${field}${changes.length > 1 ? ` (${i + 1} of ${changes.length})` : ''}`,
      ...c,
    })),
  ),
);

describe('every inventoried value comes from the fixture', () => {
  it('perturbs the inventory’s entries and nothing else', () => {
    expect(Object.keys(PERTURB).sort()).toEqual(INVENTORY.map((e) => e.id).sort());
  });

  it.each(INVENTORY.map((e) => [e.id, e] as const))(
    '%s: changes each field it lists, and each changed field shows on each screen it names',
    (id, entry) => {
      const fields = PERTURB[id]!;
      expect(Object.keys(fields).sort()).toEqual([...entry.fieldList].sort());
      for (const [field, changes] of Object.entries(fields)) {
        const shown = new Set(changes.flatMap((c) => Object.keys(c.expect)));
        expect([...shown].sort(), field).toEqual([...entry.screenList].sort());
        for (const c of changes) {
          for (const values of Object.values(c.expect)) expect(values.length).toBeGreaterThan(0);
        }
      }
    },
  );

  const before = new Map<FixtureName, Record<Screen, string>>();
  const original = (name: FixtureName) => {
    if (!before.has(name)) before.set(name, screens(name, null));
    return before.get(name)!;
  };

  it.each(CASES)('$label', ({ fixture: name = 'bad-site', change, expect: shows }) => {
    const d = structuredClone(fixture(name));
    change(findCheck(d, SHOWN[name].check), d);
    const after = screens(name, d);
    for (const [screen, values] of Object.entries(shows) as [Screen, string[]][]) {
      if (screen === 'Home' && name !== 'bad-site') throw new Error('Home shows the bad site');
      for (const value of values) {
        expect(original(name)[screen], `${screen} already said "${value}"`).not.toContain(value);
        expect(after[screen], `${screen} should say "${value}"`).toContain(value);
      }
    }
  });
});
