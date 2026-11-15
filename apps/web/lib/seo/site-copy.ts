/**
 * What the site says about itself once v2 is public (CC-40 D2), served only while V2_CHECKS_PUBLIC
 * is on; with it off every caller serves its v1 text unchanged. The three owner strings are option 1
 * of the proposals in the CC-40 notes (`copy-proposals.md`); choosing option 2 is changing one
 * constant here. `site-copy.test.tsx` holds each to the length its decision names.
 */

/** The v2 home's `<title>`, absolute (no " · Crawlmouse" suffix). Owner string; at most 60 characters. */
export const V2_HOME_TITLE = 'Crawlmouse — Can ChatGPT, Claude and Google read your site?';

/** The v2 home's meta description, also its Open Graph and Twitter text. Owner string; 120–155 characters. */
export const V2_HOME_DESCRIPTION =
  'Crawlmouse checks what Googlebot, GPTBot, ClaudeBot and PerplexityBot get from your site: ' +
  'robots.txt, JavaScript, links. Free, re-checked monthly.';

/** The `/llms.txt` descriptor. Owner string. */
export const V2_LLMS_DESCRIPTOR =
  'Crawlmouse checks whether search engines and AI crawlers can read a website. Paste a URL: it ' +
  'fetches the site as Googlebot, GPTBot, ClaudeBot and PerplexityBot, shows what each got back, ' +
  'grades SEO and AI readability, and keeps checking. Free for one site, no install.';

/**
 * The root share card's words: the v2 home's H1 question without its "actually"
 * (components/v2/screens/home/HomeScreen.tsx), and a sub and footer that restate that page's sub and
 * its Free plan card.
 */
export const V2_SHARE_CARD = {
  alt: V2_HOME_TITLE,
  headline: 'Can ChatGPT, Claude and Google read your site?',
  sub: 'See what each crawler gets back, and hear when it changes.',
  footer: 'Free · No install · Re-checked monthly',
} as const;

/** The company behind Crawlmouse, for Organization structured data. No street address, by decision. */
export const PARENT_ORGANIZATION = {
  name: 'Nahl Technologies Inc',
  url: 'https://nahltech.com',
  address: { locality: 'Indianapolis', region: 'IN', country: 'US' },
} as const;
