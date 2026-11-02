/**
 * Final-Seg-Content: where the rebuilt page's text differs from the locked HTML, and why. Applied
 * in order by the lock comparison (__tests__/v2/segment-content.test.tsx).
 */
import type { Addition, CopyChange } from '../copy-registry';

export const CONTENT_CHANGES: CopyChange[] = [
  {
    screen: 'segment-content',
    kind: 'fixture',
    locked: 'Not your products.',
    rendered: 'Not your collections and products.',
    source:
      'The fixture: collection pages open with a direct answer on 9 of 42, below a quarter, as product pages do on 31 of 158; the headline names every section below that line.',
  },
  {
    screen: 'segment-content',
    kind: 'fixture',
    locked:
      '11 of 13 blog posts do this, 9 of 42 collections, the homepage, and 31 of 158 product pages: 52 of 214. Product pages open with a gallery and a size picker, and the first sentence a crawler can quote is 600 words down.',
    rendered:
      'Of the pages read, these do: the homepage, 9 of 42 collection pages, 31 of 158 product pages and 11 of 13 blog posts; 52 of 214 in all.',
    source:
      'The contract records no position of the first quotable sentence on a page, so that sentence goes; the counts are the fixture’s, listed in the site’s template order.',
  },
  {
    screen: 'segment-content',
    kind: 'fixture',
    locked:
      'Evidence · /products/ridge-2p · first 150 words a crawler reads, rendered · nothing here answers "is the Ridge 2P a three-season tent?" Copy Home › Tents › Ridge 2P Ridge 2P Tent $329  ★★★★☆ 41 reviews Colour: Moss / Sand    Size: 2P / 3P Add to cart · Add to wishlist · Find in store Free shipping over $99 · 60-day returns · Lifetime warranty Description ▾   Specifications ▾   Reviews ▾ You may also like: Ridge Footprint, Alpine Stove, Trail Mug… (word 150) What a quotable opening looks like, from /blog/winter-camping: "A three-season tent handles rain and wind from spring to autumn; a four-season tent adds pole strength and fabric weight for snow load. For most trips below the treeline, three-season is the right choice." Direct, self-contained, under a heading that asks the question.',
    rendered:
      'Evidence · /products/ridge-2p · the 9 words of the rendered page this record holds Copy Ridge 2P Tent · $329 Two-person, three-season backpacking tent.',
    source:
      'The fixture’s rendered `body_excerpt` for this page, as received. The question it does not answer, and the quotable opening from /blog/winter-camping, are not in any record, so neither is shown (CC-23 decision 8); the caption says how many words the record holds rather than promising 150.',
  },
  {
    screen: 'segment-content',
    kind: 'facts',
    locked:
      'The three free fixes of this audit are the three with the largest estimated effect: the Cloudflare rule, the product template, and the orphan pages. The three below are on Pro, which starts free for 14 days with the email below. Their effect on AI visibility is not estimated yet: the crawlers that would quote these pages cannot read them until fixes 1 and 2 land, so each carries only its Technical SEO point for now.',
    rendered:
      'The three free fixes of this audit are the three with the largest estimated effect: let GPTBot and PerplexityBot through Cloudflare, server-render the product template and link the 7 orphan pages from their collections. The three below are on Pro, which starts free for 14 days with the email below. Their effect on AI readability is not estimated yet: the crawlers that would quote these pages cannot read them until fixes 1 and 2 land, so each carries only its Technical SEO point for now.',
    source:
      'FACTS A1 (“AI visibility” → “AI readability”) and I11; the free fixes are named by the fixture’s titles.',
  },
  {
    screen: 'segment-content',
    kind: 'fixture',
    locked: 'one template flag, already on for the other 6 · +1 Technical SEO',
    rendered:
      'one template flag, already on for the other 6 · +1 Technical SEO; AI effect estimated after fixes 1 and 2',
    source:
      'The fixture: this fix’s AI readability effect waits on fixes 1 and 2 (`ai_readability_pending_on`), as the other two content fixes’ do.',
  },
];

export const CONTENT_ADDITIONS: Addition[] = [
  {
    screen: 'segment-content',
    what: 'The pages in the record that fail the selected check, beside the first words of one of them; the checks an audit did not record, named under the grid',
    source: 'CC-23 brief, scope 5',
  },
  {
    screen: 'segment-content',
    what: 'The coverage line, and the recommendation class beside each fix',
    source: 'CC-23 brief, scopes 1 and 5',
  },
];
