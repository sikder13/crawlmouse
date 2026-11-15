/**
 * What the site says about itself once v2 is public (CC-40 D2), served only while V2_CHECKS_PUBLIC
 * is on; with it off every caller serves its v1 text unchanged. The home title, description and
 * llms descriptor are the CTO's ruling 3 of 2026-11-15 (owner-delegated), each one constant here.
 * `site-copy.test.tsx` holds the title and description to the lengths their decision names.
 */

/** The v2 home's `<title>`, absolute (no " · Crawlmouse" suffix). Owner string; at most 60 characters. */
export const V2_HOME_TITLE = 'Crawlmouse — Free AI Crawler & SEO Checker for Any Website';

/** The v2 home's meta description, also its Open Graph and Twitter text. Owner string; 120–155 characters. */
export const V2_HOME_DESCRIPTION =
  'See what Googlebot, GPTBot, ClaudeBot and PerplexityBot actually get from your site, and how to ' +
  'fix what blocks them. Free check, nothing to install.';

/** The `/llms.txt` descriptor. The plans and prices that follow it are generated (lib/seo/llms-v2.ts). */
export const V2_LLMS_DESCRIPTOR =
  'Crawlmouse (by Nahl Technologies) checks whether search engines and AI crawlers can read a ' +
  'website. It fetches the site as Googlebot, GPTBot, ClaudeBot and PerplexityBot, shows what each ' +
  'one received, grades SEO and AI readability, and gives the fix for each problem it finds. Free ' +
  'for one site, no install.';

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
