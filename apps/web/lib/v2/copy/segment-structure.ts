/**
 * Final-Seg-Structure (Site structure): where the rebuilt page's text differs from the locked
 * HTML, and why. Applied in order by the lock comparison (__tests__/v2/segment-structure.test.tsx).
 */
import type { Addition, CopyChange } from '../copy-registry';

export const STRUCTURE_CHANGES: CopyChange[] = [
  {
    screen: 'segment-structure',
    kind: 'facts',
    locked: 'which four of the six crawlers cannot follow.',
    rendered: 'which a crawler that does not run scripts cannot follow.',
    source:
      'FACTS I6: the six-crawler set is gone; the sentence names the crawlers that cannot follow by what they do, not by a count from the old set.',
  },
  {
    screen: 'segment-structure',
    kind: 'fixture',
    locked: '38% of anchors are generic ("Shop now", "Learn more").',
    rendered: '38% of anchors are generic.',
    source:
      'The contract records only the share of generic anchors (`structure.generic_anchor_share`), not which anchors they are, so no example is quoted.',
  },
  {
    screen: 'segment-structure',
    kind: 'fixture',
    locked:
      'The map below shows the hubs and their neighbours: each dot a page, sized by links in; each line a link.',
    rendered:
      'The map below shows every page crawled: each dot a page, larger the closer it is to the homepage; each line the link that reached it.',
    source:
      'The fixture’s map is the crawl screen’s drawing, reused: every page crawled, sized by click depth, each joined to the page whose link reached it.',
  },
  {
    screen: 'segment-structure',
    kind: 'fixture',
    locked: 'hubs and their neighbours, 66 of 214',
    rendered: 'every page crawled, 214 of 214',
    source: 'The fixture’s map draws every page crawled, so the caption counts what it draws.',
  },
  {
    screen: 'segment-structure',
    kind: 'fixture',
    locked: 'The suggested parent is the collection whose products link to the same tags.',
    rendered: '',
    source:
      'The contract records each orphan’s suggested parent (`suggested_parent_url`) but not how it was chosen, so no method is stated.',
  },
  {
    screen: 'segment-structure',
    kind: 'fixture',
    locked:
      '/products/ridge-3p 0 sitemap.xml /collections/tents 2 of 6 14 Sep 2026 /products/ridge-footprint 0 sitemap.xml /collections/tents 2 of 6 14 Sep 2026 /products/alpine-stove-windscreen 0 sitemap.xml /collections/cooking 2 of 6 2 Aug 2026 /products/trail-mug-2pk 0 sitemap.xml /collections/cooking 2 of 6 2 Aug 2026 /products/summit-pack-45-womens 0 sitemap.xml /collections/packs 2 of 6 21 Jul 2026 /collections/gift-cards 0 sitemap.xml / (footer) 4 of 6 3 Mar 2026 /blog/choosing-a-sleeping-pad 0 sitemap.xml /blog 4 of 6 11 Jan 2026',
    rendered:
      '/products/ridge-3p 0 sitemap.xml /collections/tents 0 of 6 14 Sep 2026 /products/ridge-footprint 0 sitemap.xml /collections/tents 0 of 6 14 Sep 2026 /products/alpine-stove-windscreen 0 sitemap.xml /collections/cooking 0 of 6 2 Aug 2026 /products/trail-mug-2pk 0 sitemap.xml /collections/cooking 0 of 6 2 Aug 2026 /products/summit-pack-45-womens 0 sitemap.xml /collections/packs 0 of 6 21 Jul 2026 /collections/gift-cards 0 sitemap.xml / 4 of 6 3 Mar 2026 /blog/choosing-a-sleeping-pad 0 sitemap.xml /blog 4 of 6 11 Jan 2026',
    source:
      'The fixture’s `crawlers_reading_text` (0 for the product orphans) and `suggested_parent_url` (the homepage, which the record does not place in the footer).',
  },
  {
    screen: 'segment-structure',
    kind: 'fixture',
    locked:
      'Product orphans show 2 of 6 because, once reached, they still hit the JavaScript problem in the previous section. Fix that template and these become 4 of 6; fix the Cloudflare rule and they become 6 of 6.',
    rendered:
      'Product page orphans are reached by 4 of 6 AI crawlers and read by 0: once reached, they still hit the JavaScript problem in the previous section.',
    source:
      'The fixture: 4 of 6 AI crawlers reach the product orphans and none reads their text; the record holds no per-page projection of what each fix changes, so none is made.',
  },
  {
    screen: 'segment-structure',
    kind: 'fixture',
    locked:
      'Each orphan belongs to a collection that already exists. Products live in Shopify, so the five product orphans are fixed in the Shopify admin; the footer and blog index live in the Next.js front end. The sitemap alone does not count: crawlers index it, but nothing ranks it.',
    rendered:
      'Seven pages are in sitemap.xml and linked from nowhere: five products, the gift-card collection and one blog post.',
    source:
      'The fixture holds no explanation for this fix (`detail` is null); the packet’s context says what is wrong.',
  },
  {
    screen: 'segment-structure',
    kind: 'fixture',
    locked:
      'Shopify admin › Products › (each product) › Collections ridge-3p, ridge-footprint            → Tents alpine-stove-windscreen, trail-mug-2pk → Cooking summit-pack-45-womens                → Packs Next.js front end components/Footer.tsx: add { label: "Gift cards", href: "/collections/gift-cards" } pages/blog/index.tsx: the listing filters out drafts; the post is live but flagged draft in Shopify\'s blog — publish it or redirect it. Verify (we run this after you mark done): crawl → each of the 7 pages has ≥ 1 internal link in',
    rendered:
      'Shopify admin › Products › (each product) › Collections: ridge-3p, ridge-footprint → Tents; alpine-stove-windscreen, trail-mug-2pk → Cooking; summit-pack-45-womens → Packs. components/Footer.tsx: add { label: "Gift cards", href: "/collections/gift-cards" }. pages/blog/index.tsx: the listing filters out drafts; the post is live but flagged draft in Shopify\'s blog. Publish it or redirect it.  The sitemap alone does not count: crawlers index it, but nothing ranks it.  Verify (we run this after you mark done):   crawl, then count internal links into each of the 7 pages   → expect each has ≥ 1 link in (today: 0)',
    source: 'The fixture’s packet for this fix: its steps, what to keep, and the check we run.',
  },
  {
    screen: 'segment-structure',
    kind: 'fixture',
    locked:
      'Handing this to your developer? The packet lists the seven paths, the collection each belongs to, the two front-end files, and the check we run afterwards.',
    rendered:
      'Handing this to your coding tool or your developer? The packet contains the steps above and the check we’ll run afterwards to confirm it worked.',
    source:
      'The contract does not describe what a packet holds, so the sentence names what every packet has.',
  },
  {
    screen: 'segment-structure',
    kind: 'fixture',
    locked:
      '· JavaScript-only navigation on 5 pages, a redirect chain, duplicate pagination, two canonical mismatches, one hreflang gap ·',
    rendered:
      '· make the JavaScript-only navigation crawlable on 5 pages, fix two canonical mismatches, shorten a redirect chain, consolidate duplicate pagination and close one hreflang gap ·',
    source: 'The fixture’s titles for the five grouped fixes, in rank order.',
  },
];

export const STRUCTURE_ADDITIONS: Addition[] = [
  {
    screen: 'segment-structure',
    what: 'The coverage line: the pages crawled of the pages found, across the templates',
    source: 'CC-23 brief, scope 2 (on every section)',
  },
  {
    screen: 'segment-structure',
    what: 'The recommendation class beside each fix',
    source: 'CC-23 brief, scope 5',
  },
];
