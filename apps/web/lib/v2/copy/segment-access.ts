/**
 * Final-Segment (Crawler access): where the rebuilt page's text differs from the locked HTML, and
 * why. Applied in order by the lock comparison (__tests__/v2/segment-access.test.tsx).
 */
import type { Addition, CopyChange } from '../copy-registry';

export const ACCESS_CHANGES: CopyChange[] = [
  {
    screen: 'segment-access',
    kind: 'facts',
    locked:
      'Two of six crawlers never get in. blocked GPTBot is refused by a Cloudflare firewall rule on every page. PerplexityBot is served a challenge page instead of your content. Google, Bing, OAI-SearchBot and ClaudeBot reach the site; two of them then hit the JavaScript problem covered in the next section.',
    rendered:
      'One of six AI crawlers is blocked, and one is challenged. 1 blocked · 1 challenged GPTBot is blocked by a firewall rule; PerplexityBot gets a challenge page. The other four AI crawlers get in; OAI-SearchBot, ChatGPT-User, Claude-SearchBot and ClaudeBot then read product pages empty without JavaScript, covered in the next section. Googlebot and Bingbot are allowed by robots.txt.',
    source:
      'FACTS I6 and I2: “two of six crawlers never get in” is ENGINE-DERIVED under the new vocabulary, where a challenge is not “blocked”; the pill is the Result door’s.',
  },
  {
    screen: 'segment-access',
    kind: 'facts',
    locked: 'Crawlers tested 6 Pages requested per crawler 214 Responses kept as evidence 1,284',
    rendered:
      'AI crawlers tested 6 Pages fetched per crawler 50 of 214 Responses kept as evidence 408',
    source:
      'FACTS B2 (the tiles, FACTS-proposed line 215) and I1; 408 is the fixture’s count of the responses this audit kept (`withheld.total`).',
  },
  {
    screen: 'segment-access',
    kind: 'facts',
    locked:
      'Select a cell to see the raw request and response. Tested by user agent; your CDN may treat signed bots differently.',
    rendered:
      'Each page was requested with the crawler’s own user agent, tagged “Crawlmouse/2.0 (+https://crawlmouse.com/bot)”, from our published IPs. Rules that match the whole string exactly will not fire on the tagged version, so a block can be under-reported here. Verify this site in Settings and we test with the exact strings. Rendering requests come from Cloudflare Browser Rendering, and one untagged browser-identity control fetch per sampled page is part of the method. Select a cell to see the raw request and response.',
    source: 'FACTS D1, with its L5 correction (FACTS-proposed line 217 points there).',
  },
  {
    screen: 'segment-access',
    kind: 'facts',
    locked:
      'Googlebot ● 200 ● 200 ● 200 ● 200 100% — Bingbot ● 200 ● 200 ● 200 ● 200 100% — GPTBot ■ 403 ■ 403 ■ 403 ■ 403 0% Cloudflare firewall rule (error 1020) OAI-SearchBot ● 200 ● 200 ▲ empty shell ● 200 31% client-rendered template ClaudeBot ● 200 ● 200 ▲ empty shell ● 200 31% client-rendered template PerplexityBot ■ challenge ■ challenge ■ challenge ■ challenge 0% Bot Fight Mode challenge',
    rendered:
      'Googlebot allowed by robots.txt 100%* verified-bot response not testable from outside Bingbot allowed by robots.txt 100%* verified-bot response not testable from outside OAI-SearchBot allowed 200 allowed 200 allowed, thin 200 allowed 200 31% client-rendered template ChatGPT-User allowed 200 allowed 200 allowed, thin 200 allowed 200 31% client-rendered template PerplexityBot challenged: the real crawler may pass 403 challenged: the real crawler may pass 403 challenged: the real crawler may pass 403 challenged: the real crawler may pass 403 0% Bot Fight Mode challenge Claude-SearchBot allowed 200 allowed 200 allowed, thin 200 allowed 200 31% client-rendered template GPTBot blocked by a rule 403 blocked by a rule 403 blocked by a rule 403 blocked by a rule 403 0% Cloudflare firewall rule (error 1020) ClaudeBot allowed 200 allowed 200 allowed, thin 200 allowed 200 31% client-rendered template',
    source:
      'FACTS I6 (eight crawlers in three groups), B2 (Googlebot and Bingbot by robots.txt, one cell, 100%*) and I2 (a verdict phrase beside every cell; ○ for a challenge, not ■).',
  },
  {
    screen: 'segment-access',
    kind: 'fixture',
    locked: 'GET / HTTP/2',
    rendered: 'https://example-outfitter.com/',
    source:
      'The contract records no request method or HTTP version (AccessTest has no `method` or `http_version`), so the request is shown by its URL.',
  },
  {
    screen: 'segment-access',
    kind: 'facts',
    locked: 'GPTBot/1.2; +https://openai.com/gptbot Accept: text/html',
    rendered:
      'GPTBot/1.4; +https://openai.com/gptbot Crawlmouse/2.0 (+https://crawlmouse.com/bot) Accept: text/html From: bot@crawlmouse.com',
    source:
      'FACTS D1 (the tag after the user agent, and the From line); GPTBot/1.4 is the fixture’s `identity_sent`.',
  },
  {
    screen: 'segment-access',
    kind: 'fixture',
    locked: 'HTTP/2 403',
    rendered: 'Status 403',
    source: 'The contract records the status (`raw_status`) and no HTTP version.',
  },
  {
    screen: 'segment-access',
    kind: 'fixture',
    locked: 'error code: 1020 · Access denied',
    rendered: 'error code: 1020 Access denied',
    source: 'The fixture’s `body_excerpt`, as received.',
  },
  {
    screen: 'segment-access',
    kind: 'facts',
    locked: 'Fixes for crawler access 1 open · 1 on Pro',
    rendered: 'Fixes for crawler access 1 open',
    source: 'FACTS I10: Web Bot Auth left the fix list, so this section has no Pro fix.',
  },
  {
    screen: 'segment-access',
    kind: 'facts',
    locked: '+24 AI visibility, estimated',
    rendered: '+24 AI readability, estimated',
    source: 'FACTS A1',
  },
  {
    screen: 'segment-access',
    kind: 'fixture',
    locked:
      'Both bots say they honor robots.txt, and in our crawls they do. Let them past the edge, then say what you actually want in robots.txt. This check passes on the next crawl, and the Changes section will show it.',
    rendered:
      'GPTBot is refused by a Cloudflare firewall rule (error 1020) on every page; PerplexityBot is served a Bot Fight Mode challenge instead of your content.',
    source:
      'The fixture holds no explanation for this fix (`detail` is null); the packet’s context says what is wrong.',
  },
  {
    screen: 'segment-access',
    kind: 'fixture',
    locked:
      'Cloudflare › Security › Security rules › "Block AI scrapers" remove the expression (http.user_agent contains "GPTBot") Security › Settings › Bot traffic › Bot Fight Mode PerplexityBot is not on Cloudflare\'s verified-bot list, so Bot Fight Mode challenges it. WAF skip rules do not bypass Bot Fight Mode. Choose one: · turn Bot Fight Mode off and block bad bots with WAF custom rules instead, or · Security › Security rules › Create rule › IP access rules: allow Perplexity\'s published IP ranges, or · upgrade to Super Bot Fight Mode, which supports skip rules for specific bots. robots.txt (optional, keeps training bots out): User-agent: GPTBot Disallow: / User-agent: OAI-SearchBot Allow: /',
    rendered:
      'Cloudflare › Security › Security rules › "Block AI scrapers": remove the expression (http.user_agent contains "GPTBot"). Security › Settings › Bot traffic › Bot Fight Mode: PerplexityBot is not on Cloudflare\'s verified-bot list, and WAF skip rules do not bypass Bot Fight Mode. Choose one: turn Bot Fight Mode off and block bad bots with WAF custom rules instead; or add an IP access rule allowing Perplexity\'s published IP ranges; or upgrade to Super Bot Fight Mode, which supports skip rules for specific bots.  robots.txt (optional, keeps training bots out): User-agent: GPTBot / Disallow: / and User-agent: OAI-SearchBot / Allow: /  Verify (we run this after you mark done):   curl -s -o /dev/null -w "%{http_code}" -A "Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko); compatible; GPTBot/1.4; +https://openai.com/gptbot" https://example-outfitter.com/   → expect 200 (today: 403)',
    source: 'The fixture’s packet for this fix: its steps, what to keep, and the check we run.',
  },
  {
    screen: 'segment-access',
    kind: 'fixture',
    locked:
      "The packet contains the rule names, the exact user agents, and the request we'll run afterwards to confirm it worked.",
    rendered:
      'The packet contains the steps above and the request we’ll run afterwards to confirm it worked.',
    source:
      'The contract does not describe what a packet holds, so the sentence names what every packet has.',
  },
  {
    screen: 'segment-access',
    kind: 'facts',
    locked:
      'Let signed crawlers skip the challenge (Web Bot Auth) · cryptographically signed crawler requests can pass Bot Fight Mode without an IP list to maintain See this fix with Pro',
    rendered: '',
    source: 'FACTS I10: Web Bot Auth is no longer a fix; Signals reports it.',
  },
  {
    screen: 'segment-access',
    kind: 'facts',
    locked: 'for any of these six crawlers',
    rendered: 'for any of these six AI crawlers',
    source:
      'FACTS I6: the alert covers the AI crawlers we fetch as; search engines are read from robots.txt.',
  },
];

export const ACCESS_ADDITIONS: Addition[] = [
  {
    screen: 'segment-access',
    what: 'The evidence class beside each verdict, the group rows of the matrix, and the footnote on Google and Bing’s rendering',
    source: 'CC-23 brief, scope 2; FACTS B2 (the footnote)',
  },
  {
    screen: 'segment-access',
    what: 'A note under two tiles (scored crawlers; the sample’s limit), and the coverage line',
    source: 'CC-23 brief, scope 2',
  },
  {
    screen: 'segment-access',
    what: 'What each piece of evidence cannot show (the contract’s `limitations`), and what a cell with no response in the record says',
    source: 'CC-23 brief, scope 2',
  },
  {
    screen: 'segment-access',
    what: 'The recommendation class beside each fix',
    source: 'CC-23 brief, scope 5',
  },
];
