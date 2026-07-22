import { describe, it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { ArticleLayout } from '../components/blog/ArticleLayout';
import type { BlogPostMeta } from '../lib/blog/posts';

// A refreshed post must surface its updatedAt as a visible "Updated <date>" line in the article header,
// while a never-updated post (updatedAt === publishedAt) renders exactly as before — no "Updated" text.
const baseMeta: BlogPostMeta = {
  slug: 'test-post',
  title: 'A Test Post Title',
  description: 'A description that is comfortably longer than eighty characters so it mirrors real post metadata.',
  excerpt: 'A short excerpt for the test post.',
  keywords: ['test'],
  publishedAt: '2026-06-01',
  updatedAt: '2026-06-01',
  readingMinutes: 5,
};

const render = (meta: BlogPostMeta) =>
  renderToStaticMarkup(
    <ArticleLayout meta={meta} related={[]}>
      <p>body</p>
    </ArticleLayout>,
  );

describe('ArticleLayout — visible updated date', () => {
  it('renders "Updated <date>" (with the machine-readable date) when updatedAt differs from publishedAt', () => {
    const html = render({ ...baseMeta, updatedAt: '2026-07-22' });
    expect(html).toContain('Updated July 22, 2026');
    expect(html).toContain('2026-07-22'); // the second <time dateTime> value
    expect(html).toContain('June 1, 2026'); // publish date still shown
    expect((html.match(/<time/g) ?? []).length).toBe(2); // published + updated
  });

  it('renders no "Updated" line when updatedAt equals publishedAt', () => {
    const html = render(baseMeta);
    expect(html).not.toContain('Updated');
    expect(html).toContain('June 1, 2026'); // publish date unchanged
    expect((html.match(/<time/g) ?? []).length).toBe(1); // published only
  });
});
