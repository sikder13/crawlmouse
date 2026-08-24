import { siteUrl, siteHost } from './site-url';

/**
 * The AI crawlers this site allows by name, in the order they are written out.
 *
 * Naming them is not redundant with `User-Agent: *`. Several of these agents are operated by
 * companies whose published policy is to look for their own token first, and some infrastructure —
 * Cloudflare's bot controls among it — decides what to do with a request by checking whether the
 * site named the agent rather than by reading the wildcard. An explicit allow is the difference
 * between "not forbidden" and "invited".
 *
 * Three kinds sit here together on purpose:
 *
 *   search    OAI-SearchBot, Claude-SearchBot, PerplexityBot, Bingbot — they build the indexes
 *             assistants answer from. Bingbot matters most: ChatGPT and Copilot retrieval runs
 *             through Bing's index, so blocking it removes this site from both.
 *   agent     ChatGPT-User, Claude-User, Perplexity-User — live fetches made because a person
 *             asked a question about this site. These are readers, arriving one at a time.
 *   training  GPTBot, ClaudeBot, Google-Extended, Applebot-Extended, meta-externalagent. Allowed
 *             deliberately: this site's guides ARE the argument for the product, and a model that
 *             has read them can make that argument when we are not in the room.
 *
 * `Google-Extended` and `Applebot-Extended` are training-only controls that do no crawling of
 * their own — listing them allows use, not access.
 */
export const AI_CRAWLERS: readonly string[] = [
  'GPTBot',
  'OAI-SearchBot',
  'ChatGPT-User',
  'ClaudeBot',
  'Claude-User',
  'Claude-SearchBot',
  'PerplexityBot',
  'Perplexity-User',
  'Google-Extended',
  'Applebot-Extended',
  'Bingbot',
  'meta-externalagent',
];

/**
 * The Content Signals declaration, as the specification requires it: a comment at the top of the
 * file, before any group. It states the same policy the allow list states, in the vocabulary the
 * signal defines — search, ai-input (retrieval-augmented answers) and ai-train are all yes. Two
 * ways of saying one thing, which is the point: a consumer that reads only one still gets the
 * right answer.
 */
const CONTENT_SIGNAL = '# Content-Signal: search=yes, ai-input=yes, ai-train=yes';

/**
 * The private app + capability-URL surfaces, unchanged from the `robots.ts` metadata route this
 * replaced. NB: /r/ public reports are intentionally NOT blocked — their indexing is controlled
 * per-page (page-level robots meta) so the crawler can actually fetch them and honor that signal,
 * instead of the "indexed but blocked" anti-pattern.
 */
const DISALLOW = ['/embed/', '/audit/', '/dashboard', '/verify/'];

/**
 * The whole file.
 *
 * The wildcard group, its four disallows, `Host` and `Sitemap` reproduce what the metadata route
 * emitted character for character — this change is additive, and `robots-txt.test.ts` pins the old
 * document as one contiguous block so a new directive cannot be spliced into the wildcard group.
 *
 * The named groups carry no `Disallow`. That is deliberate and it is not an oversight: a named
 * group does not inherit the wildcard's rules, so the private surfaces stay unlisted for these
 * agents. They are low-value to an assistant (a capability URL, an embed iframe, the dashboard)
 * and repeating the disallows would invite a crawler to enumerate them.
 *
 * ⚠ Cloudflare's "managed robots.txt" feature, if ever switched on for this zone, is served AT THE
 * EDGE and OVERRIDES this file entirely — the origin is never asked. Keep it OFF (see
 * docs/OPERATING-RULES.md §12).
 */
export function robotsTxt(): string {
  const wildcard = ['User-Agent: *', 'Allow: /', ...DISALLOW.map((p) => `Disallow: ${p}`)].join('\n');
  const named = AI_CRAWLERS.map((agent) => `User-Agent: ${agent}\nAllow: /`);

  return [
    CONTENT_SIGNAL,
    '',
    [wildcard, ...named].join('\n\n'),
    '',
    `Host: ${siteHost()}`,
    `Sitemap: ${siteUrl('/sitemap.xml')}`,
    '',
  ].join('\n');
}
