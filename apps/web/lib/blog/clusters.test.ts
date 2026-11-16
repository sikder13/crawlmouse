import { describe, expect, it } from 'vitest';
import {
  CHECK_EXPLAINERS,
  CLUSTERS,
  MAX_RELATED,
  checksExplainedBy,
  clusterHub,
  clusterOf,
  relatedPosts,
} from './clusters';
import { CHECK_QUESTIONS } from '../v2/copy/check-pages';
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

describe('relatedPosts', () => {
  const clustered = POSTS.filter((p) => clusterOf(p.slug) !== null);

  it('gives each clustered post two or three others, never itself and never research', () => {
    for (const p of clustered) {
      const r = relatedPosts(p.slug);
      expect(r.length, p.slug).toBeGreaterThanOrEqual(2);
      expect(r.length, p.slug).toBeLessThanOrEqual(MAX_RELATED);
      expect(r.map((x) => x.slug)).not.toContain(p.slug);
      expect(r.filter((x) => (x.tags ?? []).includes('research'))).toEqual([]);
      expect(new Set(r).size).toBe(r.length);
    }
  });

  it('starts with the post’s own cluster, after it and wrapping, then its neighbour’s', () => {
    expect(relatedPosts('sitebulb-vs-screaming-frog').map((p) => p.slug)).toEqual([
      'sitebulb-vs-jetoctopus-vs-oncrawl',
      'screaming-frog-vs-lumar-deepcrawl',
      'screaming-frog-alternative',
    ]);
    expect(relatedPosts('orphan-pages').map((p) => p.slug)).toEqual([
      'free-internal-link-audit',
      'find-orphan-pages-wordpress',
      'find-orphan-pages-shopify',
    ]);
  });

  it('lists every clustered post as related on another post', () => {
    const listed = new Set(clustered.flatMap((p) => relatedPosts(p.slug).map((x) => x.slug)));
    expect(clustered.filter((p) => !listed.has(p.slug)).map((p) => p.slug)).toEqual([]);
  });

  it('is empty for a post in no cluster', () => {
    expect(relatedPosts('ai-crawler-access-test-2026')).toEqual([]);
  });

  it('names a neighbour that exists for each cluster of fewer than three posts', () => {
    for (const c of CLUSTERS.filter((x) => x.slugs.length < 3))
      expect(
        CLUSTERS.some((x) => x.id === c.neighbour),
        c.id,
      ).toBe(true);
  });
});

describe('CHECK_EXPLAINERS', () => {
  it('names one or two existing, non-research posts for every /check question', () => {
    const known = new Map(POSTS.map((p) => [p.slug, p]));
    expect(Object.keys(CHECK_EXPLAINERS).sort()).toEqual([...CHECK_QUESTIONS].sort());
    for (const q of CHECK_QUESTIONS) {
      const slugs = CHECK_EXPLAINERS[q];
      expect(slugs.length, q).toBeGreaterThanOrEqual(1);
      expect(slugs.length, q).toBeLessThanOrEqual(2);
      for (const s of slugs) {
        expect(known.has(s), s).toBe(true);
        expect(known.get(s)!.tags ?? []).not.toContain('research');
      }
    }
  });

  it('maps a post back to the questions it explains', () => {
    expect(checksExplainedBy('block-ai-crawlers-robots-txt')).toEqual(['gptbot', 'robots-ai']);
    expect(checksExplainedBy('orphan-pages')).toEqual([]);
  });
});
