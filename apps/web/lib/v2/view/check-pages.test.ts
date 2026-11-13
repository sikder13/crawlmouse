/**
 * The `/check` pages' words (CC-29 D8): each page answers one question, keeps "AI visibility" in its
 * title and description (FACTS K7), and names a source for every block (each paragraph and the
 * table; a paragraph's sources cover all its sentences, which this test does not split). A cited
 * file must exist, every crawler a block names must be named by one of its cited files, and a cited
 * link must be one of `VENDOR_DOCS`. What the sample audit measured comes from the fixture, not from typed numbers.
 * What vendors say was read from `VENDOR_DOCS` on 2026-11-12 (CC-29 review r1, SEO 4 and 5); the
 * tests below pin the wording that reading settled, not the vendor pages themselves.
 */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { AI_BOT_REGISTRY } from '@crawlmouse/engine';
import { describe, expect, it } from 'vitest';
import { GATES } from '../../entitlement-v2';
import {
  CHECK_COPY,
  CHECK_DATA_COPY,
  CHECK_QUESTIONS,
  JS_GUIDE_CRAWLERS,
  SOURCE,
  VENDOR_DOCS,
  checkPath,
  isCheckQuestion,
} from '../copy/check-pages';
import { findCheck, fixture } from '../fixtures';
import { listOf } from '../format';
import { CHECKS } from '../recordings';
import { count } from '../words';
import { checkPageView } from './check-pages';

const REPO = join(__dirname, '../../../../..');
/** Every crawler token a page could name: the engine's list and the two search engines. */
const CRAWLER_TOKENS = [...AI_BOT_REGISTRY.map((b) => b.token), 'Googlebot', 'Bingbot'];
/** Whether `text` names the crawler `token` as a whole token ("ClaudeBot" is not in "Claude-SearchBot"). */
const names = (text: string, token: string) =>
  new RegExp(`(^|[^-\\w])${token}($|[^-\\w])`).test(text);
const pageText = (q: (typeof CHECK_QUESTIONS)[number]) => {
  const v = checkPageView(q);
  const c = CHECK_COPY[q];
  return [
    c.title,
    c.description,
    v.h1,
    v.sub,
    v.heading,
    ...v.blocks.map((b) =>
      b.kind === 'paragraph' ? b.text : `${b.label} ${JSON.stringify(b.rows)}`,
    ),
  ].join(' ');
};

describe.each(CHECK_QUESTIONS)('the /check/%s page', (question) => {
  const copy = CHECK_COPY[question];
  const view = checkPageView(question);

  it('is addressed and canonical at /check/<question>', () => {
    expect(view.canonical).toBe(`/check/${question}`);
    expect(checkPath(question)).toBe(view.canonical);
    expect(isCheckQuestion(question)).toBe(true);
  });

  it('opens with one question, and keeps "AI visibility" as the search term in its title and description', () => {
    expect(view.h1.endsWith('?')).toBe(true);
    expect(view.h1.match(/\?/g)).toHaveLength(1);
    expect(copy.title).toContain('AI visibility');
    expect(copy.description).toContain('Free');
    expect(copy.description.length).toBeLessThanOrEqual(200);
  });

  it('names a source for every block: a file in this repository, or a vendor page', () => {
    expect(view.blocks.length).toBeGreaterThanOrEqual(3);
    const vendors: readonly string[] = Object.values(VENDOR_DOCS);
    for (const block of view.blocks) {
      expect(block.sources.length).toBeGreaterThan(0);
      for (const source of block.sources) {
        if (source.startsWith('https://')) expect(vendors, source).toContain(source);
        else expect(existsSync(join(REPO, source)), source).toBe(true);
      }
    }
  });

  it('cites, for each crawler a block names, a file that names it too', () => {
    for (const block of view.blocks) {
      const said = block.kind === 'paragraph' ? block.text : JSON.stringify(block.rows);
      const files = block.sources
        .filter((s) => !s.startsWith('https://'))
        .map((s) => readFileSync(join(REPO, s), 'utf8'));
      for (const token of CRAWLER_TOKENS.filter((t) => names(said, t)))
        expect(
          files.some((f) => f.includes(token)),
          `${token} in ${block.sources.join(', ')}`,
        ).toBe(true);
    }
  });

  it('says "AI readability" for the grade on the page, never "AI visibility" (FACTS A1)', () => {
    const shown = [
      view.h1,
      view.sub,
      view.heading,
      ...view.blocks.map((b) => JSON.stringify(b)),
    ].join(' ');
    expect(shown).not.toContain('AI visibility');
  });

  it("prints Free's page cap from GATES in the hero note", () => {
    expect(view.heroNote).toContain(`up to ${count(GATES.free.pagesPerCheck)} pages`);
  });
});

describe('the sentences built from the example audit', () => {
  const check = findCheck(fixture('bad-site'), CHECKS.badFirstAudit);
  const text = (q: (typeof CHECK_QUESTIONS)[number]) =>
    checkPageView(q)
      .blocks.map((b) => (b.kind === 'paragraph' ? b.text : JSON.stringify(b.rows)))
      .join(' ');

  it('names as counted exactly the crawlers the check scores, and GPTBot as shown, not counted (FACTS I6)', () => {
    const scored = check.crawlers.filter((c) => c.scored).map((c) => c.ua);
    expect(scored).not.toContain('GPTBot');
    const paragraph = checkPageView('gptbot').blocks.find(
      (b) => b.kind === 'paragraph' && b.text.includes('The grade counts '),
    );
    const counted =
      paragraph?.kind === 'paragraph' ? paragraph.text.split('The grade counts ')[1] : '';
    expect(counted).toBe(`${listOf(scored)}.`);
    for (const c of check.crawlers.filter((x) => !x.scored)) expect(counted).not.toContain(c.ua);
    const table = checkPageView('gptbot').blocks.find((b) => b.kind === 'table');
    expect(table?.kind === 'table' && table.rows.map((r) => [r.key, r.cells[2]])).toEqual([
      ['GPTBot', 'shown, not counted'],
      ['OAI-SearchBot', 'counted'],
      ['ChatGPT-User', 'counted'],
    ]);
  });

  it('names as running no JavaScript exactly the crawlers the guide’s quick answer names, and credits the study it rests on (SEO 5)', () => {
    const guide = readFileSync(join(REPO, SOURCE.jsGuide), 'utf8');
    const quick = guide.slice(
      guide.indexOf('Quick answer'),
      guide.indexOf('</p>', guide.indexOf('Quick answer')),
    );
    expect(quick.length).toBeGreaterThan(0);
    expect(guide).toContain('Vercel and MERJ');
    const sentence = text('javascript').split('do not run JavaScript')[0]!;
    for (const token of CRAWLER_TOKENS) {
      const inQuick = names(quick, token);
      const inSentence = names(sentence, token);
      expect(inSentence, token).toBe(
        inQuick && (JS_GUIDE_CRAWLERS as readonly string[]).includes(token),
      );
    }
    for (const token of JS_GUIDE_CRAWLERS) expect(quick, token).toContain(token);
    expect(text('javascript')).toContain('Vercel and MERJ');
    expect(text('javascript')).not.toMatch(/checked each/);
  });

  it('labels the measured figures as a sample audit of a made-up site (SEO N8)', () => {
    const example = checkPageView('javascript').blocks.find(
      (b) => b.kind === 'paragraph' && b.sources === CHECK_DATA_COPY.exampleSources,
    );
    expect(example?.kind === 'paragraph' && example.text).toMatch(
      /^In a sample audit of a made-up site, /,
    );
  });

  it("states the example page's words with and without JavaScript as the fixture holds them", () => {
    const page = fixture('bad-site')
      .page_results.filter(
        (p) => p.check_id === check.id && p.sampled && p.without_js?.state === 'empty_shell',
      )
      .sort(
        (a, b) =>
          b.without_js!.rendered_words -
          b.without_js!.raw_words -
          (a.without_js!.rendered_words - a.without_js!.raw_words),
      )[0]!;
    const sentence = text('javascript');
    expect(sentence).toContain(new URL(page.url).pathname);
    expect(sentence).toContain(`${count(page.without_js!.rendered_words)} words in a browser`);
    expect(sentence).toContain(`${count(page.without_js!.raw_words)} to`);
  });
});

describe('what the pages say about vendors’ crawlers (SEO 4)', () => {
  it('states no count of OpenAI’s crawlers anywhere on any page', () => {
    for (const q of CHECK_QUESTIONS) {
      expect(pageText(q), q).not.toMatch(
        /\b(?:two|three|four|five|six|seven|eight|nine|ten|\d+)\b[^.]{0,30}OpenAI/i,
      );
      expect(pageText(q), q).not.toMatch(/OpenAI[’']s (?:two|three|four|five|\d+)\b/i);
    }
  });

  it('labels the OpenAI table as the crawlers the audit tests, not as all of OpenAI’s', () => {
    const table = checkPageView('gptbot').blocks.find((b) => b.kind === 'table');
    expect(table?.kind === 'table' && table.label).toBe('The OpenAI crawlers the audit tests');
  });

  it('does not say a search crawler’s block takes a site out of its answers, and gives each vendor’s caveat', () => {
    const robots = pageText('robots-ai');
    expect(robots).not.toMatch(/takes? you out of/);
    expect(robots).toContain('can still appear as a navigational link');
    expect(robots).toContain('may reduce your visibility');
    expect(robots).toContain('Perplexity-User generally ignores them');
  });
});
