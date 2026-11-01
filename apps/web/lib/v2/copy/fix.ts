/**
 * Final-Fix (the fix page): where the rebuilt page's text differs from the locked HTML, and why.
 * Applied in order by the lock comparison (__tests__/v2/fix.test.tsx).
 */
import type { Addition, CopyChange } from '../copy-registry';

export const FIX_CHANGES: CopyChange[] = [
  {
    screen: 'fix',
    kind: 'facts',
    locked: 'Fix 2 of 14',
    rendered: 'Fix 2 of 13',
    source:
      'FACTS I10: the fix count is ENGINE-DERIVED; the fixture holds 13 live fixes at this audit (Web Bot Auth left the list).',
  },
  {
    screen: 'fix',
    kind: 'facts',
    locked: '+22 AI visibility, estimated',
    rendered: '+22 AI readability, estimated',
    source: 'FACTS A1',
  },
  {
    screen: 'fix',
    kind: 'fixture',
    locked:
      'One route, one deploy. Afterwards, the AI crawlers that do not run JavaScript read the same 1,120 words Google does on every product page: two of them today, four once the Cloudflare rule in fix 1 is also changed. This is the second-largest fix in the audit and the one that makes the Content fixes worth doing.',
    rendered:
      'Problem: /products/[handle] renders an empty <div id="__next"> and fetches product data in the browser. Crawlers that do not run JavaScript get 134 words; a browser renders 1,120.',
    source:
      'The fixture’s packet context for this fix: what is wrong, as the packet states it (the segment’s open fix says the same). The rest of the locked paragraph is in no record.',
  },
  {
    screen: 'fix',
    kind: 'fixture',
    locked: 'Effort one template',
    rendered: 'Effort one template, one deploy',
    source: 'The fixture’s `effort` records one template and one deploy; the tile shows both.',
  },
  {
    screen: 'fix',
    kind: 'fixture',
    locked: 'Shopify as the product backend',
    rendered: 'Shopify as the backend',
    source:
      'The fixture’s detected stack records the backend’s CMS and how it was detected, not what it serves.',
  },
  {
    screen: 'fix',
    kind: 'fixture',
    locked:
      'Crawlers that do not run JavaScript (GPTBot, OAI-SearchBot, ClaudeBot, PerplexityBot) get',
    rendered: 'Crawlers that do not run JavaScript get',
    source: 'The fixture’s packet context for this fix, as written.',
  },
  {
    screen: 'fix',
    kind: 'fixture',
    locked:
      'curl -sA "ClaudeBot/1.0" https://example-outfitter.com/products/ridge-2p \\ | grep -c "three-season" → expect ≥ 1 (today: 0) ClaudeBot gets 200 today; GPTBot is 403 until fix 1.',
    rendered:
      'curl -sA "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36; compatible; OAI-SearchBot/1.4; +https://openai.com/searchbot" https://example-outfitter.com/products/ridge-2p | grep -c "three-season" → expect ≥ 1 (today: 0) # we run the same request with a tagged user agent; your result and ours can differ only if a rule matches the exact string Requests as OAI-SearchBot, which gets 200 today.',
    source:
      'The fixture’s verify command, expectation and crawler (`verify.ua`, ENGINE-DERIVED, one that is let in today; DESIGN-LOCK §7.3), on one line as stored; the crawler’s status is the check’s. FACTS D1 adds the comment after the request.',
  },
  {
    screen: 'fix',
    kind: 'fixture',
    locked: 'Crawlers that read the description 2 of 6 4 of 6*',
    rendered: 'AI crawlers that read the text 0 of 6 4 of 6*',
    source:
      'The fixture’s `crawlers_reading_text` counts the six AI crawlers tested (FACTS I6): none reads the product text today, four once the template is server-rendered.',
  },
  {
    screen: 'fix',
    kind: 'fixture',
    locked: '* 6 of 6 once the Cloudflare rule in Crawler access is also fixed.',
    rendered: '* 6 of 6 once fix 1 in Crawler access is also fixed.',
    source:
      'The fixture’s check: the two AI crawlers kept out today are the ones fix 1 is about. The sentence on Google and Bing that FACTS appends is left out, as this count is of AI crawlers only.',
  },
  {
    screen: 'fix',
    kind: 'fixture',
    locked:
      'If the front end is something else, choose it and the packet rewrites itself. Next.js Hydrogen Nuxt Other',
    rendered: 'Next.js Shopify (Liquid) Shopify (Hydrogen) WordPress Webflow Other',
    source:
      'The fixture’s packet `frameworks` (FACTS I12) name the switch’s choices. The audit holds one packet, written for Next.js, so the page does not promise a rewrite: choosing another framework says there is no packet for it yet (D2).',
  },
  {
    screen: 'fix',
    kind: 'fixture',
    locked: 'Next fix: Link the 7 orphan pages · +4 SEO',
    rendered: 'Next fix: Link the 7 orphan pages from their collections · +4 SEO',
    source: 'The fixture’s title for the next fix.',
  },
];

export const FIX_ADDITIONS: Addition[] = [
  {
    screen: 'fix',
    what: 'The recommendation class beside the fix’s effect',
    source: 'CC-23 brief, scope 5 (carried to the fix page)',
  },
  {
    screen: 'fix',
    what: 'Behind the Pro wall: the card that stands where the packet would be, “See this fix with Pro”, which opens the keep bar; no copy or email button',
    source: 'CC-24 brief, scope 1; D6 (DESIGN-LOCK: hold the cure behind one email)',
  },
  {
    screen: 'fix',
    what: 'A resolved fix: the check that verified it, and no packet',
    source: 'CC-24 brief, scope 1 (a variant per fixture)',
  },
  {
    screen: 'fix',
    what: 'What choosing another framework says: the audit has no packet for it yet',
    source: 'D2',
  },
];
