/**
 * The seven identities of the access test (ARCH-2 4.2 step n+3): the six AI crawler tokens, the tagged
 * Googlebot witness, and the untagged browser control (disclosed on /bot). Header shape per ARCH-2 4.4.3:
 * UA, Accept, Accept-Encoding, optionally From; deliberately no sec-ch-ua.
 *
 * The exact tagged strings other than Googlebot's are an assumption of the spike (POC-2 used
 * "<bot string> Crawlmouse/2.0 (+https://crawlmouse.com/bot)"); the Googlebot form is given in ENGINE-GAP 3.5a.
 */

export const CRAWLER_TOKENS = [
  'OAI-SearchBot',
  'ChatGPT-User',
  'PerplexityBot',
  'Claude-SearchBot',
  'GPTBot',
  'ClaudeBot',
] as const;
export type CrawlerToken = (typeof CRAWLER_TOKENS)[number];
export type Token = CrawlerToken;

export const TAG = 'Crawlmouse/2.0 (+https://crawlmouse.com/bot)';
export const OUR_UA = `Mozilla/5.0 (compatible; ${TAG})`;
export const OUR_ROBOTS_TOKENS = ['crawlmouse', 'crawlmousebot'] as const;

export const BROWSER_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36';
export const GOOGLEBOT_TAGGED_UA = `Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html) ${TAG}`;

export const crawlerUa = (t: CrawlerToken): string => `Mozilla/5.0 (compatible; ${t}/1.0) ${TAG}`;

export type IdentityName = 'crawlmouse' | 'browser' | 'googlebot' | CrawlerToken;

export function identityHeaders(name: IdentityName, from?: string): Record<string, string> {
  const ua =
    name === 'crawlmouse' ? OUR_UA : name === 'browser' ? BROWSER_UA : name === 'googlebot' ? GOOGLEBOT_TAGGED_UA : crawlerUa(name);
  const h: Record<string, string> = {
    'user-agent': ua,
    accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    'accept-encoding': 'gzip, deflate, br',
  };
  if (from && name !== 'browser') h.from = from;
  return h;
}
