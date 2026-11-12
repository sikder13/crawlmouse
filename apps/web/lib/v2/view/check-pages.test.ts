/**
 * The `/check` pages' words (CC-29 D8): each page answers one question, keeps "AI visibility" in its
 * title and description (FACTS K7), names a source for every sentence, and says what the example
 * audit measured from the fixture, not from typed numbers.
 */
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { GATES } from '../../entitlement-v2';
import { CHECK_COPY, CHECK_QUESTIONS, checkPath, isCheckQuestion } from '../copy/check-pages';
import { findCheck, fixture } from '../fixtures';
import { CHECKS } from '../recordings';
import { count } from '../words';
import { checkPageView } from './check-pages';

const REPO = join(__dirname, '../../../../..');

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

  it('names a source that exists in this repository for every block', () => {
    expect(view.blocks.length).toBeGreaterThanOrEqual(3);
    for (const block of view.blocks) {
      expect(block.sources.length).toBeGreaterThan(0);
      for (const source of block.sources) expect(existsSync(join(REPO, source)), source).toBe(true);
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
    const sentence = text('gptbot');
    for (const ua of scored) expect(sentence).toContain(ua);
    const table = checkPageView('gptbot').blocks.find((b) => b.kind === 'table');
    expect(table?.kind === 'table' && table.rows.map((r) => [r.key, r.cells[2]])).toEqual([
      ['GPTBot', 'shown, not counted'],
      ['OAI-SearchBot', 'counted'],
      ['ChatGPT-User', 'counted'],
    ]);
  });

  it('lists the AI crawlers the check tested as the ones that run no JavaScript, and neither search engine', () => {
    const sentence = text('javascript');
    for (const c of check.crawlers) {
      const named = sentence.split('do not run JavaScript')[0]!.includes(c.ua);
      expect(named, c.ua).toBe(c.group !== 'search_engine');
    }
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
