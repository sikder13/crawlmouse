/**
 * Final-Seg-JS (Readable without JavaScript): where the rebuilt page's text differs from the locked
 * HTML, and why. Applied in order by the lock comparison (__tests__/v2/segment-nojs.test.tsx).
 */
import type { Addition, CopyChange } from '../copy-registry';

export const NOJS_CHANGES: CopyChange[] = [
  {
    screen: 'segment-nojs',
    kind: 'facts',
    locked:
      'ClaudeBot and OAI-SearchBot read the HTML your server sends and do not run scripts; GPTBot and PerplexityBot would too, once they get in.',
    rendered:
      'OAI-SearchBot, ChatGPT-User, Claude-SearchBot and ClaudeBot read the HTML your server sends and do not run scripts; PerplexityBot and GPTBot would too, once they get in.',
    source:
      'FACTS I6: six AI crawlers in two groups; the fixture lets four of them in, in the order the check lists them.',
  },
  {
    screen: 'segment-nojs',
    kind: 'facts',
    locked: 'Pages measured 25 of 214',
    rendered: 'Pages measured 50 of 214',
    source:
      'FACTS I1: ENGINE-DERIVED (at most 50) pages are sampled; 50 is the fixture’s `pages_sampled`.',
  },
  {
    screen: 'segment-nojs',
    kind: 'facts',
    locked: 'Top 25 pages measured; all 214 with Pro.',
    rendered:
      '50 pages (at most 50), chosen across every template, measured without JavaScript; every page with Pro (10 full renders a month; Agency 30).',
    source:
      'FACTS K9 and I1 (the measured-set wording, “Wording fixed by the locked pages, revised”).',
  },
  {
    screen: 'segment-nojs',
    kind: 'fixture',
    locked: 'All 25 measured All 214 pages and CSV with Pro',
    rendered: 'All 214 pages and CSV with Pro',
    source:
      'The fixture holds 5 of the 50 measured pages (`withheld`), so there is no list of all 50 to switch to; the page says how many the record holds instead.',
  },
  {
    screen: 'segment-nojs',
    kind: 'fixture',
    locked:
      '<title>Ridge 2P Tent – Example Outfitter</title> <script type="application/ld+json">{"@type":"Product","name":"Ridge 2P Tent","offers":{"price":"329"},"description":"…24 words"}</script> <div id="__next"></div> <script src="/_next/static/chunks/main-8c1f.js"></script> <script src="/_next/static/chunks/pages/products/[handle]-3a9e.js"></script> 134 words of prose, 118 of them header and footer. The JSON-LD carries name, price and a 24-word description; the page body has no description, no specifications, no reviews. Ridge 2P Tent · $329 Two-person, three-season backpacking tent. 1.9 kg packed, two doors, two vestibules, DAC NFL poles… Specifications · Floor 2.2 m × 1.3 m · Peak 1.05 m What\'s in the bag · Reviews (41) · Compare 1,120 words. This is what Google and Bing see.',
    rendered:
      '<title>Ridge 2P Tent – Example Outfitter</title>  134 words. Ridge 2P Tent · $329 Two-person, three-season backpacking tent.  1,120 words.',
    source:
      'The fixture’s two responses for this page: the untagged control fetch and the rendering browser, each `body_excerpt` as received and its `word_count`. The notes about the markup and about Google and Bing are in no record, so they are not shown.',
  },
  {
    screen: 'segment-nojs',
    kind: 'facts',
    locked: '+22 AI visibility, estimated',
    rendered: '+22 AI readability, estimated',
    source: 'FACTS A1',
  },
  {
    screen: 'segment-nojs',
    kind: 'fixture',
    locked:
      'The product page is a Next.js route that fetches its product from Shopify in the browser. Move the fetch to the server (getStaticProps) so the HTML arrives with the description, price and specifications already in it. Collections and the blog already do this, so the pattern exists in your codebase. Mark it done and we re-crawl in about 2 minutes; with an account, the before and after is kept in Changes.',
    rendered:
      'Problem: /products/[handle] renders an empty <div id="__next"> and fetches product data in the browser. Crawlers that do not run JavaScript get 134 words; a browser renders 1,120.',
    source: 'The fixture’s packet context for this fix: what is wrong, as the packet states it.',
  },
  {
    screen: 'segment-nojs',
    kind: 'fixture',
    locked:
      'pages/products/[handle].tsx   (or app/products/[handle]/page.tsx) Before: data fetched in useEffect → empty <div id="__next"> After:  export async function getStaticProps({ params }) { const product = await getProduct(params.handle) return { props: { product }, revalidate: 600 } } // render description, price, specs in the component body Verify (we run this after you mark done): curl -A "ClaudeBot/1.0" https://example-outfitter.com/products/ridge-2p → expect the description in the body, not only in the JSON-LD (ClaudeBot gets 200 today; GPTBot is 403 until fix 1)',
    rendered:
      'pages/products/[handle].tsx 1. Move the Shopify getProduct(handle) call out of useEffect into getStaticProps with revalidate: 600 (or getServerSideProps if stock must be live). 2. Render title, price, description, specifications in the component body from props, not from client state. 3. Keep the gallery and size picker client-side; they are not text. 4. Do not gate the description behind an accordion that renders its content only on open.  The Product JSON-LD in the head is already server-rendered; leave it. The word count that grades this page ignores it; the body must carry the text.  Verify (we run this after you mark done):   curl -sA "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36; compatible; OAI-SearchBot/1.4; +https://openai.com/searchbot" https://example-outfitter.com/products/ridge-2p | grep -c "three-season"   → expect ≥ 1 (today: 0)',
    source: 'The fixture’s packet for this fix: its steps, what to keep, and the check we run.',
  },
  {
    screen: 'segment-nojs',
    kind: 'fixture',
    locked:
      'The packet names the route, the Shopify fetch to move, and the request we will run afterwards to confirm it worked. Detected: Next.js 14, pages router, Shopify as the product backend. Wrong? Change it on the fix page.',
    rendered:
      'The packet contains the steps above and the request we’ll run afterwards to confirm it worked.',
    source:
      'The contract does not describe what a packet holds, so the sentence names what every packet has; the stack line belongs to the fix page (CC-24).',
  },
  {
    screen: 'segment-nojs',
    kind: 'fixture',
    locked:
      'No Pro-only fixes in this section. The three free fixes of this audit are this one, the Cloudflare rule in Crawler access, and the orphan pages in Structure.',
    rendered:
      'No Pro-only fixes in this section. The three free fixes of this audit are this one, let GPTBot and PerplexityBot through Cloudflare in Crawler access, and link the 7 orphan pages from their collections in Structure.',
    source: 'The fixture’s free fixes, named by their titles and sections.',
  },
];

export const NOJS_ADDITIONS: Addition[] = [
  {
    screen: 'segment-nojs',
    what: 'How many of the measured pages the record holds, and what a selected page with no response in the record says',
    source: 'CC-23 brief, scope 3; OPERATING-RULES §10 (no silent truncation)',
  },
  {
    screen: 'segment-nojs',
    what: 'The coverage line, and the recommendation class beside each fix',
    source: 'CC-23 brief, scopes 1 and 5',
  },
];
