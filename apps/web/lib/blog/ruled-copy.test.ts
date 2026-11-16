import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { POSTS_BY_SLUG } from './posts';
import { RULED_CHANGES } from './ruled-copy';

// Each recorded change stands in posts.ts, and its `before` is what main served: read from the
// pre-CC-40 baseline fixture, an independent capture (__tests__/__fixtures__/blog-baseline.json).
const baseline = JSON.parse(
  readFileSync(resolve(__dirname, '../../__tests__/__fixtures__/blog-baseline.json'), 'utf8'),
) as { posts: Record<string, { metadata: { title: { absolute: string }; description: string } }> };

describe('RULED_CHANGES', () => {
  it.each(RULED_CHANGES.map((c) => [c.slug, c.field, c] as const))('%s %s', (slug, field, c) => {
    const meta = POSTS_BY_SLUG.get(slug)!;
    expect(meta, slug).toBeDefined();
    expect(field === 'seoTitle' ? meta.seoTitle : meta.description).toBe(c.after);
    const then = baseline.posts[slug]!.metadata;
    expect(field === 'seoTitle' ? then.title.absolute : then.description).toBe(c.before);
    expect(c.after).not.toBe(c.before);
    expect(c.basis.length).toBeGreaterThan(0);
  });

  it('a seoTitle is set only by a recorded change, and never changes the H1 text it sits beside', () => {
    const recorded = new Set(
      RULED_CHANGES.filter((c) => c.field === 'seoTitle').map((c) => c.slug),
    );
    for (const [slug, meta] of POSTS_BY_SLUG) {
      expect(meta.seoTitle !== undefined, slug).toBe(recorded.has(slug));
      if (meta.seoTitle)
        expect(meta.title, slug).toBe(baseline.posts[slug]!.metadata.title.absolute);
    }
  });

  it('each new description is 70–160 characters', () => {
    for (const c of RULED_CHANGES.filter((x) => x.field === 'description')) {
      expect(c.after.length, c.slug).toBeGreaterThanOrEqual(70);
      expect(c.after.length, c.slug).toBeLessThanOrEqual(160);
    }
  });
});
