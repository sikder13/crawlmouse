import { describe, expect, it } from 'vitest';
import { CLUSTERS, clusterHub, clusterOf } from './clusters';
import { POSTS } from './posts';

describe('CLUSTERS', () => {
  it('names only posts that exist, each in one cluster, under distinct anchors', () => {
    const slugs = CLUSTERS.flatMap((c) => c.slugs);
    const known = new Set(POSTS.map((p) => p.slug));
    expect(slugs.filter((s) => !known.has(s))).toEqual([]);
    expect(new Set(slugs).size).toBe(slugs.length);
    const ids = CLUSTERS.map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) expect(id).toMatch(/^[a-z0-9-]+$/);
  });

  it('places every post that is not research-tagged in a cluster', () => {
    const unclustered = POSTS.filter((p) => !(p.tags ?? []).includes('research')).filter(
      (p) => clusterOf(p.slug) === null,
    );
    expect(unclustered.map((p) => p.slug)).toEqual([]);
  });

  it('gives each cluster its anchor on /guides', () => {
    expect(clusterHub(CLUSTERS[1]!)).toBe('/guides#crawl-depth');
    expect(clusterOf('orphan-pages')?.id).toBe('internal-linking');
    expect(clusterOf('no-such-post')).toBeNull();
  });
});
