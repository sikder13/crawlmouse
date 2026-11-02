import { describe, expect, it } from 'vitest';
import { FIXTURE_NAMES } from '../../fixtures';
import { accessView, type AccessView } from './access';
import { asFirstSeen, edited } from './test-helpers';

const view = (name: (typeof FIXTURE_NAMES)[number], edit?: Parameters<typeof edited>[1]) => {
  const { d, id } = edited(name, edit);
  return accessView(d, id, { asFirstSeen: asFirstSeen(name) });
};

const rows = (v: AccessView) => v.groups.flatMap((g) => g.rows);
const row = (v: AccessView, ua: string) => rows(v).find((r) => r.ua === ua)!;

describe('accessView: the matrix', () => {
  it('groups the crawlers as FACTS I6 does: search engines, AI search (scored), AI training (unscored)', () => {
    const v = view('bad-site');
    expect(v.groups.map((g) => [g.title, g.rows.map((r) => r.ua)])).toEqual([
      ['Search engines', ['Googlebot', 'Bingbot']],
      [
        'AI search and answers',
        ['OAI-SearchBot', 'ChatGPT-User', 'PerplexityBot', 'Claude-SearchBot'],
      ],
      ['AI training', ['GPTBot', 'ClaudeBot']],
    ]);
    expect(v.groups.map((g) => g.note)).toEqual([
      'by robots.txt, not fetched',
      'counts towards AI readability',
      'not scored; blocking these is your choice',
    ]);
  });

  it('gives a search engine allowed by robots.txt one cell spanning every section, with the FACTS B2 wording', () => {
    const v = view('bad-site');
    const g = row(v, 'Googlebot');
    expect(g.cells).toHaveLength(1);
    expect(g.cells[0]).toMatchObject({
      span: v.columns.length,
      verdict: 'allowed',
      evidence: 'declared',
    });
    expect(g.cells[0]!.qualifier).toBe('by robots.txt');
    expect(g.text).toBe('100%*');
    expect(g.cause).toBe('verified-bot response not testable from outside');
    expect(v.footnote).toBe(
      '* Google and Bing render JavaScript; the text share is what a browser renders. Connect Search Console to see Google’s own fetches.',
    );
  });

  it('spans a search engine’s row as "not measured" when robots.txt could not be read, with no footnote', () => {
    const v = view('challenged-site');
    expect(row(v, 'Bingbot').cells).toEqual([
      expect.objectContaining({ span: v.columns.length, verdict: 'not_measured', qualifier: null }),
    ]);
    expect(row(v, 'Bingbot').text).toBe('not measured');
    expect(v.footnote).toBeNull();
  });

  it('gives an AI crawler one cell per section, in the coverage’s order, from by_template', () => {
    const v = view('bad-site');
    expect(v.columns.map((c) => c.label)).toEqual([
      'Homepage',
      'Collections · 42',
      'Products · 158',
      'Blog · 13',
    ]);
    const oai = row(v, 'OAI-SearchBot');
    expect(oai.cells.map((c) => [c.verdict, c.status])).toEqual([
      ['allowed', '200'],
      ['allowed', '200'],
      ['allowed_thin', '200'],
      ['allowed', '200'],
    ]);
    expect(oai.text).toBe('31%');
    expect(oai.cause).toBe('client-rendered template');
    expect(row(v, 'GPTBot').cause).toBe('Cloudflare firewall rule (error 1020)');
  });
});

describe('accessView: evidence', () => {
  it('links a cell to the access test for that check, crawler and template, and others to none', () => {
    const v = view('bad-site');
    const gpt = row(v, 'GPTBot');
    const home = v.evidence.find((e) => e.id === gpt.cells[0]!.evidenceId)!;
    expect(home.title).toBe('Evidence · GPTBot · homepage · 02:33:07 UTC');
    expect(home.caption).toBe('error 1020 means a firewall rule on this site blocked the request');
    expect(home.request.split('\n')).toEqual([
      'https://example-outfitter.com/',
      'Host: example-outfitter.com',
      'User-Agent: Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko); compatible; GPTBot/1.4; +https://openai.com/gptbot Crawlmouse/2.0 (+https://crawlmouse.com/bot)',
      'Accept: text/html',
      'From: bot@crawlmouse.com',
    ]);
    expect(home.response.split('\n')).toEqual([
      'Status 403',
      'server: cloudflare',
      'cf-ray: 8f3a21c0d9e7a4b1-ORD',
      'content-type: text/html',
      '',
      'error code: 1020 Access denied',
    ]);
    expect(gpt.cells[1]!.evidenceId).toBeNull();
    expect(row(v, 'Googlebot').cells[0]!.evidenceId).not.toBeNull();
  });

  it('opens on the first blocked cell that has evidence', () => {
    const v = view('bad-site');
    expect(v.initial).toBe(row(v, 'GPTBot').cells[0]!.id);
  });

  it('opens on nothing, and says why, when the check kept no raw responses', () => {
    const v = view('challenged-site');
    expect(v.evidence).toEqual([]);
    expect(v.initial).toBeNull();
    expect(v.noEvidence).toBe('This audit kept no raw responses to show.');
  });
});

describe('accessView: headline, tiles and the method sentence', () => {
  it('counts what kept the AI crawlers out in the words the Result door uses', () => {
    const v = view('bad-site');
    expect(v.headline.pill).toEqual({ state: 'bad', label: '1 blocked · 1 challenged' });
    expect(v.headline.title).toBe('One of six AI crawlers is blocked, and one is challenged.');
    expect(v.headline.body).toBe(
      'GPTBot is blocked by a firewall rule; PerplexityBot gets a challenge page. The other four AI crawlers get in; OAI-SearchBot, ChatGPT-User, Claude-SearchBot and ClaudeBot then read product pages empty without JavaScript, covered in the next section. Googlebot and Bingbot are allowed by robots.txt. Tested 25 Oct 2026 at 02:33 UTC.',
    );
  });

  it('says so when every AI crawler gets in', () => {
    const v = view('clean-site');
    expect(v.headline.title).toBe('All six AI crawlers get in.');
    expect(v.headline.pill).toEqual({ state: 'ok', label: '6 of 6 allowed' });
  });

  it('names the edge once when it blocks all automation', () => {
    const v = view('challenged-site');
    expect(v.headline.pill.label).toBe('blocks all automation');
    expect(v.headline.title).toBe('The site’s edge blocks all automation.');
  });

  it('reads the tiles from the check: crawlers tested, pages fetched, responses kept', () => {
    expect(view('bad-site').tiles).toEqual([
      { label: 'AI crawlers tested', value: '6', note: '4 scored' },
      {
        label: 'Pages fetched per crawler',
        value: '50 of 214',
        note: 'at most 50, across every template',
      },
      { label: 'Responses kept as evidence', value: '408', note: null },
    ]);
    expect(view('clean-site').tiles[1]).toEqual({
      label: 'Pages fetched per crawler',
      value: '38 of 38',
      note: 'every page',
    });
    expect(view('clean-site').tiles[2]!.value).toBe('312');
  });

  it('uses the tagged-identity sentence (FACTS D1, with the L5 correction)', () => {
    expect(view('bad-site').method).toBe(
      'Each page was requested with the crawler’s own user agent, tagged “Crawlmouse/2.0 (+https://crawlmouse.com/bot)”, from our published IPs. Rules that match the whole string exactly will not fire on the tagged version, so a block can be under-reported here. Verify this site in Settings and we test with the exact strings. Rendering requests come from Cloudflare Browser Rendering, and one untagged browser-identity control fetch per sampled page is part of the method. Select a cell to see the raw request and response.',
    );
  });

  it('draws the coverage line from the sample', () => {
    expect(view('bad-site').coverage).toEqual({ tested: 50, total: 214, groups: 4 });
    expect(view('challenged-site').coverage).toEqual({ tested: 12, total: 140, groups: 3 });
  });
});

describe('accessView: a cell whose response is not in the record', () => {
  it('says how many responses the record holds of those kept, from `withheld`', () => {
    expect(view('bad-site').cellWithoutEvidence).toBe(
      'This record holds 8 of the 408 responses the audit kept, and this cell’s is not one of them.',
    );
    expect(view('challenged-site').cellWithoutEvidence).toBe(
      'The audit kept no response for this cell.',
    );
  });
});

describe('accessView: edges of the data', () => {
  it('writes no search-engine sentence when the check holds no search engine', () => {
    const v = view('bad-site', (c) => {
      c.crawlers = c.crawlers.filter((x) => x.group !== 'search_engine');
    });
    expect(v.headline.body).not.toMatch(/\s{2}|^ | \.|\. are /);
    expect(v.headline.body).not.toContain('robots.txt.');
  });

  it('counts crawlers kept out another way, and ones not measured, in the title', () => {
    const v = view('bad-site', (c) => {
      c.crawlers.find((x) => x.ua === 'GPTBot')!.verdict = 'rate_limited';
      c.crawlers.find((x) => x.ua === 'PerplexityBot')!.verdict = 'not_measured';
    });
    expect(v.headline.title).toBe(
      'One of six AI crawlers is kept out another way, and one was not measured.',
    );
  });

  it('says "every page crawled" for a census that stopped short of the pages found', () => {
    const v = view('clean-site', (c) => (c.coverage!.pages_discovered = 40));
    expect(v.tiles[1]!.note).toBe('every page crawled');
  });
});
