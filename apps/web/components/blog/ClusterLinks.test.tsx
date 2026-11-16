/**
 * A post's cluster links (CC-40 D6): its /guides cluster hub, two or three related posts with their
 * titles as the anchors, and, only while V2_CHECKS_PUBLIC is on, the /check pages it explains.
 */
import { renderToStaticMarkup } from 'react-dom/server';
import { JSDOM } from 'jsdom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ClusterLinks } from './ClusterLinks';
import { CLUSTERS, clusterOf, relatedPosts } from '@/lib/blog/clusters';
import { POSTS } from '@/lib/blog/posts';
import { CHECK_COPY } from '@/lib/v2/copy/check-pages';

const links = (slug: string) => {
  const html = renderToStaticMarkup(<ClusterLinks slug={slug} />);
  const doc = new JSDOM(html).window.document;
  return {
    html,
    nav: doc.querySelector('nav.cluster-links'),
    links: [...doc.querySelectorAll('a')].map((a) => [a.getAttribute('href'), a.textContent]),
  };
};

afterEach(() => vi.unstubAllEnvs());

describe('ClusterLinks', () => {
  it.each(POSTS.filter((p) => clusterOf(p.slug)).map((p) => p.slug))(
    '%s links its hub and its related posts, anchored by their titles',
    (slug) => {
      const r = links(slug);
      const cluster = clusterOf(slug)!;
      expect(r.nav?.getAttribute('aria-label')).toBe('More on this topic');
      expect(r.links).toContainEqual([`/guides#${cluster.id}`, `All guides in “${cluster.title}”`]);
      for (const p of relatedPosts(slug))
        expect(r.links).toContainEqual([`/blog/${p.slug}`, p.title]);
      const posts = r.links.filter(([h]) => h!.startsWith('/blog/'));
      expect(posts.length).toBe(relatedPosts(slug).length);
    },
  );

  it('renders nothing for a post in no cluster', () => {
    expect(links('ai-crawler-access-test-2026').html).toBe('');
  });

  it('links the /check pages a post explains only while V2_CHECKS_PUBLIC is on', () => {
    vi.stubEnv('V2_CHECKS_PUBLIC', '');
    expect(
      links('block-ai-crawlers-robots-txt').links.filter(([h]) => h!.startsWith('/check/')),
    ).toEqual([]);
    vi.stubEnv('V2_CHECKS_PUBLIC', '1');
    expect(
      links('block-ai-crawlers-robots-txt').links.filter(([h]) => h!.startsWith('/check/')),
    ).toEqual([
      ['/check/gptbot', CHECK_COPY.gptbot.h1],
      ['/check/robots-ai', CHECK_COPY['robots-ai'].h1],
    ]);
    expect(links('orphan-pages').links.filter(([h]) => h!.startsWith('/check/'))).toEqual([]);
  });

  it('heads its section with an h2, so the post’s heading order holds', () => {
    expect(links(CLUSTERS[0]!.slugs[0]!).html).toMatch(/^<nav[^>]*><h2/);
  });
});
