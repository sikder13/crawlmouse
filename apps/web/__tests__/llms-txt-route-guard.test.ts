import { describe, it, expect } from 'vitest';
import { GET } from '../app/llms.txt/route';
import { allPostSlugs, postsNewestFirst } from '../lib/blog/posts';

const body = await GET().text();
const lines = body.split('\n');

// /llms.txt is the site's own map for AI engines. It is a SUPERSET: the founder-approved descriptor
// and Maker line were added to it, and everything the file already carried — the /guides and /bot
// links, and the guide list generated from POSTS — was kept. These guards exist because the two
// halves fail differently: hand-written copy drifts from its source page, and a generated list
// silently stops generating.
describe('/llms.txt — structure', () => {
  it('opens with the H1 and carries the four sections in order', () => {
    expect(lines[0]).toBe('# Crawlmouse');
    const at = (h: string) => lines.indexOf(h);
    expect(at('## Key pages')).toBeGreaterThan(0);
    expect(at('## Key pages')).toBeLessThan(at('## Guides'));
    expect(at('## Guides')).toBeLessThan(at('## Maker'));
  });

  it('carries the approved descriptor and Maker line verbatim', () => {
    // Founder-approved copy. A reworded version of either is a content change, not a refactor.
    expect(body).toContain(
      '> Crawlmouse is a free, browser-based website auditor by Nahl Technologies. Paste a URL and get an ' +
        'honest A–F grade on your internal links and what AI crawlers actually see — orphan pages, click ' +
        'depth, link graph. Free, no signup.',
    );
    expect(body).toContain(
      'Built by [Nahl Technologies](https://nahltech.com), an AI consulting and implementation firm in Indianapolis.',
    );
  });

  it('ends with a newline and has no blank-line runs', () => {
    expect(body.endsWith('\n')).toBe(true);
    expect(body).not.toContain('\n\n\n');
  });
});

describe('/llms.txt — Key pages', () => {
  const keyPages = body.slice(body.indexOf('## Key pages'), body.indexOf('## Guides'));

  it('links all six key pages as absolute crawlmouse.com URLs', () => {
    for (const path of ['/', '/pricing', '/developers', '/blog', '/guides', '/bot']) {
      const url = path === '/' ? 'https://crawlmouse.com/' : `https://crawlmouse.com${path}`;
      expect(keyPages, `Key pages must link ${path}`).toContain(`](${url}):`);
    }
  });

  it('retains /guides and /bot — the links that predate this section', () => {
    // Named separately from the loop above because these two are the ones a rewrite would
    // plausibly drop: neither appears in the brief that introduced the Key pages section.
    expect(keyPages).toContain('https://crawlmouse.com/guides');
    expect(keyPages).toContain('https://crawlmouse.com/bot');
  });

  it('gives every key page a description, and no two share one', () => {
    // /pricing and /developers ship no meta description of their own; if they ever fall back to
    // the site-wide one, three of these lines become byte-identical and the file stops helping a
    // model tell the pages apart.
    const descriptions = keyPages
      .split('\n')
      .filter((l) => l.startsWith('- ['))
      .map((l) => l.slice(l.indexOf('): ') + 3));
    expect(descriptions).toHaveLength(6);
    for (const d of descriptions) expect(d.length).toBeGreaterThan(0);
    expect(new Set(descriptions).size, 'every key-page description must be distinct').toBe(6);
  });
});

describe('/llms.txt — Guides stay generated', () => {
  const guides = body.slice(body.indexOf('## Guides'), body.indexOf('## Maker'));

  it('lists EVERY published post, not a hand-picked subset', () => {
    // The whole point of generating from POSTS: a new guide appears here the day it ships. A
    // hardcoded list passes a "contains six posts" check forever and goes stale silently.
    for (const slug of allPostSlugs()) {
      expect(guides, `guide list must include /blog/${slug}`).toContain(`https://crawlmouse.com/blog/${slug}`);
    }
    expect(guides.split('\n').filter((l) => l.startsWith('- [')).length).toBe(allPostSlugs().length);
  });

  it('is ordered newest-first, like the blog index', () => {
    const order = postsNewestFirst().map((p) => guides.indexOf(`/blog/${p.slug}`));
    expect(order).toEqual([...order].sort((a, b) => a - b));
  });
});
