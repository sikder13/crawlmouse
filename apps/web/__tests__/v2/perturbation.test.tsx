import { describe, expect, it } from 'vitest';
import { JSDOM } from 'jsdom';
import { renderToStaticMarkup } from 'react-dom/server';
import type { Check, FixtureDataset } from '@crawlmouse/types/v2';
import { HomeScreen } from '../../components/v2/screens/home/HomeScreen';
import { ResultScreen } from '../../components/v2/screens/result/ResultScreen';
import { fixture } from '../../lib/v2/fixtures';
import { layoutInput } from '../../lib/v2/map-layout';
import { stateAt } from '../../lib/v2/progress';
import { CHECKS, recordingSpec } from '../../lib/v2/recordings';
import { synthesise } from '../../lib/v2/synthesise';
import { crawlFrame } from '../../lib/v2/view/crawl';
import { homeView } from '../../lib/v2/view/home';
import { INVENTORY } from '../../lib/v2/view/inventory';
import { resultView } from '../../lib/v2/view/result';

/**
 * Each inventoried value is changed in a copy of the bad-site fixture, and the screens are built
 * again: the new value must appear, and must not have appeared before. A value written into a
 * component as a literal cannot pass. The map is left unlaid-out here; its layout has its own tests.
 */
const ORIGINAL = fixture('bad-site');
const ID = CHECKS.badFirstAudit;
const check = (d: FixtureDataset): Check => d.checks.find((c) => c.id === ID)!;
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

function screens(d: FixtureDataset) {
  const rec = synthesise(recordingSpec('bad-site'), d);
  const end = stateAt(rec.events, Infinity);
  const map = { nodes: layoutInput(end.nodes), positions: {} };
  const home = text(renderToStaticMarkup(<HomeScreen data={homeView(d, ID, { map, end })} />));
  const result = text(
    renderToStaticMarkup(<ResultScreen data={resultView(d, ID, { map, asFirstSeen: true })} />),
  );
  const ai = check(d).crawlers.filter((c) => c.group !== 'search_engine');
  const crawl = JSON.stringify(crawlFrame(end, { domain: rec.host, crawlers: ai }));
  return { home, result, crawl };
}

type Where = 'home' | 'result' | 'crawl';

const PERTURB: Record<string, { change: (d: FixtureDataset) => void; expect: [Where, string][] }> =
  {
    domain: {
      change: (d) => (d.sites[0]!.host = 'example-outdoors.com'),
      expect: [
        ['home', 'example-outdoors.com'],
        ['result', 'example-outdoors.com'],
      ],
    },
    timing: {
      change: (d) => (check(d).finished_at = '2026-10-25T02:36:00Z'),
      expect: [
        ['home', '4 min 11 s'],
        ['result', '25 Oct 2026, 02:36 UTC'],
        ['result', 'kept until 26 Oct, 02:36 UTC'],
        ['crawl', '4:11 in all'],
      ],
    },
    pages: {
      change: (d) => (check(d).coverage!.pages_discovered = 230),
      expect: [
        ['home', '214 of 230 pages'],
        ['result', '214 of 230 pages crawled'],
      ],
    },
    links: {
      change: (d) => (check(d).structure!.internal_links = 801),
      expect: [
        ['home', '801 links'],
        ['result', '801 links'],
        ['crawl', '801 links'],
      ],
    },
    seo: {
      change: (d) => Object.assign(check(d).technical_seo!, { score: 72, grade: 'B-' }),
      expect: [
        ['home', 'B- 72 / 100'],
        ['result', 'B- 72 / 100'],
        ['crawl', '"letter":"B-","score":72'],
      ],
    },
    ai: {
      change: (d) => {
        // The contract requires the total to be the sum of its components.
        const ai = check(d).ai_readability!;
        if (ai.withheld) throw new Error('bad-site is graded');
        ai.total = 47;
        ai.components.access.score += 6;
      },
      expect: [
        ['home', '47 / 100'],
        ['result', '47 / 100'],
        ['crawl', '"score":47'],
      ],
    },
    verdicts: {
      change: (d) => {
        const gpt = check(d).crawlers.find((c) => c.ua === 'GPTBot')!;
        Object.assign(gpt, { verdict: 'disallowed_by_robots', cause: 'robots_txt_disallow' });
        gpt.by_template.forEach((t) => (t.verdict = 'disallowed_by_robots'));
      },
      expect: [
        ['home', 'GPTBot blocked by robots.txt'],
        ['result', 'GPTBot is blocked by robots.txt'],
        ['crawl', '"ua":"GPTBot","scored":false,"verdict":"disallowed_by_robots"'],
      ],
    },
    'text-share': {
      change: (d) => (check(d).crawlers.find((c) => c.ua === 'ClaudeBot')!.text_share = 0.44),
      expect: [['home', '44%']],
    },
    obstacle: {
      change: (d) =>
        (check(d).crawlers.find((c) => c.ua === 'PerplexityBot')!.cause = 'automation_challenge'),
      expect: [['home', 'an automation challenge at the edge']],
    },
    'template-size': {
      change: (d) =>
        (check(d).coverage!.templates.find((t) => t.label === 'Products')!.pages = 160),
      expect: [
        ['home', 'Product pages · 160'],
        ['home', '160 product pages share this template'],
        ['result', 'so 160 pages are near-empty'],
      ],
    },
    words: {
      change: (d) =>
        Object.assign(
          d.page_results.find((p) => p.url.endsWith('/products/ridge-2p'))!.without_js!,
          {
            rendered_words: 1300,
            raw_words: 150,
          },
        ),
      expect: [
        ['home', '1,300'],
        ['home', '150 words · 12%'],
      ],
    },
    alert: {
      change: (d) => (d.changes[0]!.detected_at = '2026-10-30T11:15:00Z'),
      expect: [['home', 'Fri 07:15']],
    },
    'fix-first': {
      change: (d) => {
        const f = d.fixes.find((x) => x.rank === 1)!;
        f.title = 'Let every AI crawler through the edge';
        f.effect.ai_readability = 30;
      },
      expect: [
        ['result', 'Let every AI crawler through the edge'],
        ['result', 'AI readability 41 → 71, estimated'],
        ['result', '+30 AI'],
      ],
    },
    'without-js': {
      change: (d) => (check(d).without_js!.site_text_share = 0.27),
      expect: [['result', '27% of text']],
    },
    structure: {
      change: (d) => {
        check(d).technical_seo!.site_structure_score = 66;
        check(d).structure!.hubs = 5;
        // More than the fixture's seven named orphans: the eighth is generated.
        check(d).structure!.orphan_pages = 8;
      },
      expect: [
        ['result', '66 / 100'],
        ['result', 'Five hubs carry'],
        ['result', 'Uneven structure; eight pages nobody links to'],
        ['home', '8 orphan pages'],
      ],
    },
    content: {
      change: (d) => (check(d).content!.score = 61),
      expect: [['result', '61 / 100']],
    },
    signals: {
      change: (d) =>
        (check(d).signals.find((s) => s.signal === 'schema_org')!.state = 'not_detected'),
      expect: [['result', '1 of 7 present']],
    },
    fixes: {
      change: (d) => (d.fixes.find((x) => x.rank === 5)!.title = 'Rewrite the six vague anchors'),
      expect: [
        ['result', 'Rewrite the six vague anchors'],
        ['crawl', 'Rewrite the six vague anchors'],
      ],
    },
    coverage: {
      change: (d) => (check(d).coverage!.pages_sampled = 48),
      expect: [['result', 'Tested 48 of 214 pages across 4 groups']],
    },
  };

describe('every inventoried value comes from the fixture', () => {
  const before = screens(ORIGINAL);

  it('has a perturbation for each inventory entry, and none for anything else', () => {
    expect(Object.keys(PERTURB).sort()).toEqual(INVENTORY.map((e) => e.id).sort());
  });

  it.each(Object.entries(PERTURB))('%s: changing the fixture changes the screens', (_, p) => {
    const d = structuredClone(ORIGINAL);
    p.change(d);
    const after = screens(d);
    for (const [where, value] of p.expect) {
      expect(before[where], `${where} already said "${value}"`).not.toContain(value);
      expect(after[where], `${where} should say "${value}"`).toContain(value);
    }
  });
});
