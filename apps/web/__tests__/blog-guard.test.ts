import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, it, expect } from 'vitest';
import { POSTS, allPostSlugs, postsNewestFirst } from '../lib/blog/posts';
import { getPost } from '../lib/blog/registry';

// Pins the blog's SEO-load-bearing invariants: every published post resolves to a renderable body,
// unknown slugs 404, and every post carries the metadata a search engine needs.
describe('blog registry + post metadata', () => {
  it('every registered post slug resolves to a meta + Body component', () => {
    for (const slug of allPostSlugs()) {
      const post = getPost(slug);
      expect(post, `getPost('${slug}') must resolve`).not.toBeNull();
      expect(typeof post!.Body, `${slug} Body must be a component`).toBe('function');
      expect(post!.meta.slug).toBe(slug);
    }
  });

  it('returns null for an unknown slug (→ 404)', () => {
    expect(getPost('does-not-exist')).toBeNull();
  });

  it('every post carries the SEO fields a search engine needs', () => {
    for (const p of POSTS) {
      expect(p.title.length, `${p.slug} title`).toBeGreaterThan(10);
      expect(p.description.length, `${p.slug} description length`).toBeGreaterThanOrEqual(80);
      // Keep descriptions short enough that Google won't truncate the value clause (~160 char SERP).
      expect(p.description.length, `${p.slug} description must be <= 165 to avoid SERP truncation`).toBeLessThanOrEqual(165);
      expect(p.keywords.length, `${p.slug} keywords`).toBeGreaterThan(0);
      expect(p.slug, `${p.slug} slug shape`).toMatch(/^[a-z0-9-]+$/);
      expect(p.publishedAt, `${p.slug} publishedAt`).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(p.updatedAt, `${p.slug} updatedAt`).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(p.readingMinutes, `${p.slug} readingMinutes`).toBeGreaterThan(0);
    }
  });

  it('every in-body /blog/<slug> cross-link points at a real post (no 404s in prose)', () => {
    const known = new Set(allPostSlugs());
    for (const slug of allPostSlugs()) {
      const src = readFileSync(resolve(__dirname, '..', 'lib/blog/content', `${slug}.tsx`), 'utf8');
      // Only ACTUAL internal links (href={'/blog/...'}), not example URLs that appear in prose/code.
      for (const m of src.matchAll(/href=\{?['"]\/blog\/([a-z0-9-]+)/g)) {
        expect(known.has(m[1]!), `${slug}.tsx links to /blog/${m[1]} which is not a known post`).toBe(true);
      }
    }
  });

  it('newest-first ordering returns every post', () => {
    expect(postsNewestFirst()).toHaveLength(POSTS.length);
  });
});
