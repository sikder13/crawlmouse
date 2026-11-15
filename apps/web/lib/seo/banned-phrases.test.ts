import { describe, expect, it } from 'vitest';
import { BANNED_PHRASES, bannedMatches } from './banned-phrases';

const ids = (text: string) => bannedMatches(text).map((m) => m.id);

// One sentence per entry that it must catch. A sentence names the entry it is for, so a broken
// pattern is reported by name; it may also catch another entry, which is not what it tests.
const CAUGHT: Readonly<Record<string, readonly string[]>> = {
  delve: ['Let us delve into the data.', 'Delving deeper, the crawl shows more.'],
  tapestry: ['A rich tapestry of links.'],
  'testament to': ['The result is a testament to good structure.'],
  'in today’s fast-paced/digital': [
    "In today's fast-paced world, sites change.",
    'In today’s digital age, links matter.',
  ],
  'ever-evolving': ['The ever-evolving web.', 'An ever evolving index.'],
  'the landscape of': ['The landscape of SEO tools has changed.'],
  'navigate the complexities/world/landscape': [
    'We help you navigate the complexities of robots.txt.',
    'Navigating the world of crawlers.',
  ],
  'unlock the power/potential': [
    'Unlock the power of internal links.',
    'unlocking your full potential',
  ],
  unleash: ['Unleash your rankings.'],
  'harness the power': ['Harness the power of structure.'],
  'game-changer': ['This is a game-changer.', 'a game changing release'],
  revolutionize: ['It will revolutionize audits.', 'revolutionised the market'],
  'cutting-edge': ['cutting-edge crawling'],
  seamless: ['A seamless setup.', 'It works seamlessly.'],
  robust: ['A robust crawler.', 'It is robust.', 'Robustly built.'],
  elevate: ['Elevate your SEO.', 'elevating the site'],
  empower: ['We empower agencies.', 'empowering teams'],
  'leverage (verb)': [
    'Leverage your internal links.',
    'You can leverage the sitemap.',
    'leveraging existing pages',
    'Agencies leveraged it.',
    'to leverage this',
  ],
  holistic: ['A holistic view.'],
  synergy: ['Real synergy between pages.'],
  paradigm: ['A new paradigm.'],
  embark: ['Embark on an audit.'],
  realm: ['In the realm of SEO.'],
  bustling: ['A bustling marketplace.'],
  vibrant: ['A vibrant community.'],
  'treasure trove': ['A treasure trove of data.'],
  'it’s important/worth to note/noting': [
    "It's important to note that robots.txt is advisory.",
    'It is worth noting the crawl stopped.',
    'It’s worth noting that…',
  ],
  'in conclusion': ['In conclusion, fix the orphans.'],
  'in summary': ['In summary, three problems.'],
  furthermore: ['Furthermore, the sitemap is stale.'],
  moreover: ['Moreover, it renders nothing.'],
  'look no further': ['Look no further than Crawlmouse.'],
  'whether you’re a': ["Whether you're a blogger or an agency…", 'Whether you are an agency'],
  'dive into / deep dive': ["Let's dive into the numbers.", 'A deep dive on crawl depth.'],
  supercharge: ['Supercharge your links.'],
  skyrocket: ['Watch traffic skyrocket.'],
  'state-of-the-art': ['A state-of-the-art crawler.'],
  'best-in-class': ['best-in-class reports'],
  'world-class': ['world-class support'],
  'next-level': ['next-level SEO'],
  'guaranteed (rankings/citations)': [
    'Guaranteed first page rankings.',
    'We guarantee you will rank higher.',
    'Rankings guaranteed.',
    'This guarantees citations in ChatGPT.',
  ],
  '#1 / number one': ['The #1 internal link checker.', 'The number one tool.', 'number-one choice'],
  'best … tool (about ourselves)': [
    'Crawlmouse is the best free SEO tool.',
    "Crawlmouse's the best audit tool.",
    'We built the best internal link tool.',
    'Our checker is the best on the market.',
    'The best AI crawler tool is Crawlmouse.',
  ],
  '100% (as a promise)': [
    '100% accurate results.',
    'It is 100% free.',
    'Works 100% of the time.',
    'Get 100 % visibility in AI search.',
  ],
};

// The other side of each narrowed entry, and of the negation rule: sentences it must not catch.
const NOT_CAUGHT: Readonly<Record<string, readonly string[]>> = {
  'leverage (verb)': [
    'the cheapest, highest-leverage fix you have.',
    'Fix the cheap, high-leverage problems first.',
    'The leverage a hub page gives is real.',
    'Gives you more leverage over the crawl.',
    'No leverage at all.',
  ],
  robust: [
    'Set robust_parser: true in the config.',
    'The is-robust flag.',
    'Call robust() before the crawl.',
    'The robust.ts module.',
  ],
  'best … tool (about ourselves)': [
    'The best tool depends on your site.',
    'Screaming Frog is the best desktop tool for large sites.',
    'Which is the best crawler tool for an agency?',
    'We tested the best SEO tools on the market.',
  ],
  '100% (as a promise)': [
    '100% of the 1,000 sites returned 200.',
    'Googlebot 200 200 100% nothing, it renders JavaScript.',
    'Googlebot allowed by robots.txt 100%* verified-bot response.',
    'No method of transmission or storage is 100% secure.',
    'It scored 100%.',
    'reaches 1100% of nothing',
  ],
  'guaranteed (rankings/citations)': [
    'It doesn’t guarantee rankings; nothing honestly can.',
    'It is not a guarantee of any search-ranking or SEO outcome.',
    'No tool can guarantee rankings.',
    'We cannot guarantee absolute security.',
  ],
  '#1 / number one': ['Step #10 of the guide.', 'Pages numbered one to ten.'],
  'in summary': ['The summary is in the report.'],
  realm: ['A realmless sentence.'],
};

describe('BANNED_PHRASES', () => {
  it('has one reason and a distinct id per entry, and a case for each entry', () => {
    const all = BANNED_PHRASES.map((p) => p.id);
    expect(new Set(all).size).toBe(all.length);
    for (const p of BANNED_PHRASES) expect(p.reason.length, p.id).toBeGreaterThan(10);
    expect(Object.keys(CAUGHT).sort()).toEqual([...all].sort());
  });

  describe.each(Object.entries(CAUGHT))('%s', (id, sentences) => {
    it.each(sentences)('catches: %s', (s) => expect(ids(s)).toContain(id));
    it('ignores case', () => expect(ids(sentences[0]!.toUpperCase())).toContain(id));
  });

  describe.each(Object.entries(NOT_CAUGHT))('%s', (id, sentences) => {
    it.each(sentences)('does not catch: %s', (s) => expect(ids(s)).not.toContain(id));
  });

  it('reports each match with the text it matched', () => {
    expect(bannedMatches('A seamless,\n robust setup.')).toEqual([
      { id: 'seamless', match: 'seamless' },
      { id: 'robust', match: 'robust' },
    ]);
  });
});
