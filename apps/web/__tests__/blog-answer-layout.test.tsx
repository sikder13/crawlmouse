import { describe, expect, it } from 'vitest';
import { POSTS, POSTS_BY_SLUG, allPostSlugs } from '../lib/blog/posts';
import { addedQuestions, addedSummary, bodyGainedAnswers, postAbstract } from '../lib/blog/answers';
import { getDataset } from '../lib/blog/datasets';
import { AUTHORS } from '../lib/blog/authors';
import { schemaProblems } from '../lib/seo/schema-required';
import { renderPostPage } from './helpers/blog-render';

// D4 on the rendered page: the summary under the H1, the "Questions this answers" section and the
// FAQPage built from the same items, the "Last updated" date in the existing date line, the
// extended byline, the Article's abstract, and the research post's Dataset node.

type Node = Record<string, unknown>;
async function page(slug: string) {
  const { doc } = await renderPostPage(slug);
  const nodes = [...doc.querySelectorAll('script[type="application/ld+json"]')].flatMap(
    (s) => [JSON.parse(s.textContent ?? 'null')].flat() as Node[],
  );
  return { doc, nodes, of: (type: string) => nodes.filter((n) => n['@type'] === type) };
}

/** The day this step's additions were written (D4: `updatedAt` moves only for posts that gained). */
const ANSWERS_DAY = '2026-11-15';
const SLUGS = allPostSlugs();

describe.each(SLUGS)('%s', (slug) => {
  const meta = POSTS_BY_SLUG.get(slug)!;

  it('shows its added summary as the header’s last element, or none when the body opens with one', async () => {
    const { doc } = await page(slug);
    const summary = doc.querySelectorAll('p.post-summary');
    const text = addedSummary(slug);
    if (text === null) return expect(summary).toHaveLength(0);
    expect(summary).toHaveLength(1);
    expect(summary[0]!.textContent).toBe(text);
    expect(doc.querySelector('article header')!.lastElementChild).toBe(summary[0]);
  });

  it('shows "Questions this answers" last in the article, and its FAQPage says the same', async () => {
    const { doc, of } = await page(slug);
    const items = addedQuestions(slug);
    const sections = doc.querySelectorAll('section.post-questions');
    if (items.length === 0) return expect(sections).toHaveLength(0);
    expect(sections).toHaveLength(1);
    const section = sections[0]!;
    expect(doc.querySelector('article')!.lastElementChild).toBe(section);
    expect(section.querySelector('h2')!.textContent).toBe('Questions this answers');
    const visible = [...section.querySelectorAll('h3')].map((h) => ({
      name: h.textContent,
      text: h.nextElementSibling!.textContent,
    }));
    expect(visible).toEqual(items.map((q) => ({ name: q.question, text: q.text })));
    const faq = of('FAQPage');
    expect(faq).toHaveLength(1);
    const ld = (
      faq[0]!.mainEntity as Array<{ name: string; acceptedAnswer: { text: string } }>
    ).map((q) => ({ name: q.name, text: q.acceptedAnswer.text }));
    expect(ld).toEqual(visible);
  });

  it('carries at most one FAQPage node', async () => {
    expect((await page(slug)).of('FAQPage').length).toBeLessThanOrEqual(1);
  });

  it('gives its Article the direct answer as its abstract, and dateModified its updatedAt', async () => {
    const [article] = (await page(slug)).of('Article');
    expect(article!.abstract).toBe(postAbstract(slug));
    expect(article!.dateModified).toBe(meta.updatedAt);
  });

  it('moves updatedAt to the answers day only if its body gained a summary or questions', () => {
    if (bodyGainedAnswers(slug)) expect(meta.updatedAt).toBe(ANSWERS_DAY);
    else expect(meta.updatedAt).not.toBe(ANSWERS_DAY);
  });

  it('shows "Last updated" in its one date line when it has been updated', async () => {
    const { doc } = await page(slug);
    const times = [...doc.querySelectorAll('article header time')];
    if (meta.updatedAt === meta.publishedAt) return expect(times).toHaveLength(1);
    expect(times).toHaveLength(2);
    expect(times[0]!.parentElement).toBe(times[1]!.parentElement);
    expect(times[1]!.getAttribute('dateTime')).toBe(meta.updatedAt);
    expect(times[1]!.textContent).toMatch(/^Last updated \w+ \d{1,2}, \d{4}$/);
  });

  it('extends its byline with the author’s role and LinkedIn only when it names an author', async () => {
    const { doc } = await page(slug);
    const header = doc.querySelector('article header')!;
    const author = meta.author ? AUTHORS[meta.author] : null;
    if (!author) {
      expect(header.querySelector('.post-author-role')).toBeNull();
      return expect(header.querySelector('a[href^="https://www.linkedin.com/"]')).toBeNull();
    }
    expect(header.querySelector(`a[href="/authors/${author.slug}"]`)?.textContent).toBe(
      author.name,
    );
    expect(header.querySelector('.post-author-role')!.textContent).toBe(
      `, ${author.role} (LinkedIn)`,
    );
    expect(header.querySelector(`a[href="${author.linkedin}"]`)?.textContent).toBe('LinkedIn');
  });

  it('carries a Dataset node only for a post with dataset facts, built from them', async () => {
    const data = getDataset(slug);
    const ds = (await page(slug)).of('Dataset');
    if (!data) return expect(ds).toHaveLength(0);
    expect(ds).toHaveLength(1);
    expect(ds[0]).toMatchObject({
      name: data.name,
      description: data.description.text,
      temporalCoverage: `${data.collected.start}/${data.collected.end}`,
      size: data.size.text,
    });
    expect(ds[0]).not.toHaveProperty('license');
  });

  it('emits the nodes this layer adds or extends with every property the site requires', async () => {
    const { of } = await page(slug);
    // The Article's `mainEntityOfPage` is an `@id` reference to the page, unchanged since the
    // baseline (blog-existing-posts-unchanged.test.tsx), and carries no name or url of its own;
    // whether a reference node owes the WebPage set is lib/seo/schema-required.ts's question.
    const problems = schemaProblems([...of('Article'), ...of('FAQPage'), ...of('Dataset')]);
    expect(problems.filter((p) => p.type !== 'WebPage')).toEqual([]);
  });
});

it('the research post gains a summary, questions and a Dataset (the shape the cases above check)', () => {
  const research = POSTS.filter((p) => (p.tags ?? []).includes('research')).map((p) => p.slug);
  expect(research).toEqual(['ai-crawler-access-test-2026']);
  expect(addedSummary(research[0]!)).not.toBeNull();
  expect(addedQuestions(research[0]!).length).toBeGreaterThan(0);
  expect(getDataset(research[0]!)).not.toBeNull();
});
