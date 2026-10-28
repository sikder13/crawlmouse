/**
 * Every place a rebuilt screen's visible text differs from its locked HTML, and why. The lock
 * comparisons (__tests__/v2/screens.test.tsx, tests/visual/copy.spec.ts) apply each entry to the
 * locked text and then require the two to be equal, so a difference not listed here fails, and an
 * entry whose locked text no longer appears fails too. The PR's "FACTS over screen" section is
 * rendered from this list.
 *
 * Kinds:
 * - `facts`: FACTS-proposed.md corrects the screen; `source` names the decision.
 * - `fixture`: the contract fixture contradicts unmarked locked copy (D6); `source` says how.
 * Elements the brief adds (`data-v2-addition` in the markup) are left out of the comparison and
 * listed in ADDITIONS instead.
 */

export type LockedScreen = 'home' | 'result' | 'crawl';

export interface CopyChange {
  screen: LockedScreen;
  kind: 'facts' | 'fixture';
  locked: string;
  rendered: string;
  source: string;
  /** Applies to every occurrence on the screen, not only the first. */
  all?: boolean;
}

export const COPY_CHANGES: CopyChange[] = [
  // ── Home ──────────────────────────────────────────────────────────────────────────────────
  {
    screen: 'home',
    kind: 'fixture',
    locked: 'Three fixes take it to A-.',
    rendered: 'Two fixes take it to A-.',
    source: 'Fixes 3 and 5 add 4 + 2 SEO points: 79 → 85, the A- floor, in two fixes, not three.',
  },
  {
    screen: 'home',
    kind: 'facts',
    locked: 'AI visibility',
    rendered: 'AI readability',
    source: 'FACTS A1',
    all: true,
  },
  {
    screen: 'home',
    kind: 'facts',
    locked: 'GPTBot is blocked by a firewall rule; PerplexityBot gets a challenge page.',
    rendered: 'PerplexityBot gets a challenge page.',
    source:
      'FACTS I6: the AI readability grade counts the four scored crawlers; GPTBot is not one.',
  },
  {
    screen: 'home',
    kind: 'facts',
    locked: 'Googlebot 200 200 100% nothing, it renders JavaScript',
    rendered:
      'Googlebot allowed allowed 100% nothing: robots.txt allows it and it renders JavaScript',
    source: 'FACTS B2 (Home row)',
  },
  {
    screen: 'home',
    kind: 'facts',
    locked: 'GPTBot 403 403 0%',
    rendered: 'GPTBot blocked by a rule blocked by a rule 0%',
    source: 'FACTS I2: verdicts, not status codes, in a crawler cell',
  },
  {
    screen: 'home',
    kind: 'facts',
    locked: 'ClaudeBot 200 empty shell 31%',
    rendered: 'ClaudeBot allowed allowed, thin 31%',
    source: 'FACTS I2',
  },
  {
    screen: 'home',
    kind: 'facts',
    locked: 'PerplexityBot challenge challenge 0%',
    rendered:
      'PerplexityBot challenged: the real crawler may pass challenged: the real crawler may pass 0%',
    source: 'FACTS I2 and B8: a challenge is not "blocked", and takes the ○ glyph',
  },
  {
    screen: 'home',
    kind: 'facts',
    locked: 'Bot Fight Mode GPTBot and ClaudeBot',
    rendered:
      'Bot Fight Mode Tested with tagged user agents from published IPs — crawlmouse.com/bot. GPTBot and ClaudeBot',
    source: 'FACTS D1: one line under every crawler table',
  },
  {
    screen: 'home',
    kind: 'facts',
    locked: 'Crawlmouse requests each page as each crawler and keeps the answer',
    rendered:
      'Crawlmouse requests a sample of pages from every template as each AI crawler and keeps the answer',
    source:
      'FACTS I1 (each AI crawler is tested on a sample of at most 50 pages across every template) and I6 (search engines are read from robots.txt, not fetched)',
  },
  {
    screen: 'home',
    kind: 'fixture',
    locked: 'GPTBot sees 134',
    rendered: 'ClaudeBot sees 134',
    source:
      'GPTBot gets 403 on every sampled page, so it sees no words; ClaudeBot, named in the heading and the table above, is let in and reads the product template thin.',
  },
  {
    screen: 'home',
    kind: 'fixture',
    locked: 'ClaudeBot is now blocked Tue 08:12',
    rendered: 'Claude-SearchBot is now blocked Fri 06:02',
    source:
      'The fixture’s change record: Claude-SearchBot first, detected Fri 06:02 in the account’s zone. FACTS l.67 reads “ClaudeBot only” and leaves the change to the fixture owner, whose record names both.',
  },
  {
    screen: 'home',
    kind: 'fixture',
    locked: 'robots.txt changed at 07:40',
    rendered: 'robots.txt changed Thu 19:40',
    source: 'The fixture’s change record (FACTS: robots.txt changed Thu 19:40).',
  },
  {
    screen: 'home',
    kind: 'fixture',
    locked: 'User-agent: ClaudeBot - Allow: / + Disallow: /',
    rendered: '+ User-agent: ClaudeBot + User-agent: Claude-SearchBot + Disallow: /',
    source:
      'The fixture’s diff: a group for both crawlers was added; nothing was removed. FACTS l.67 leaves the change to the fixture owner.',
  },
  {
    screen: 'home',
    kind: 'facts',
    locked: 'When that ends, nothing is deleted.',
    rendered: 'When that ends, nothing you can see is deleted.',
    source: 'FACTS A6',
  },
  // ── Result (both themes) ──────────────────────────────────────────────────────────────────
  {
    screen: 'result',
    kind: 'fixture',
    locked: 'Three fixes take it to A-; one of them is open now.',
    rendered: 'Two fixes take it to A-; one of them is open now.',
    source: 'As on Home: 79 + 4 + 2 = 85, the A- floor.',
  },
  {
    screen: 'result',
    kind: 'facts',
    locked: 'AI visibility',
    rendered: 'AI readability',
    source: 'FACTS A1',
    all: true,
  },
  {
    screen: 'result',
    kind: 'fixture',
    locked:
      "Two AI crawlers never get past Cloudflare's bot defences; product pages are empty to the rest.",
    rendered: 'PerplexityBot gets a challenge page; product pages are empty to the other three.',
    source:
      'FACTS I6 and I2: of the four scored crawlers one is challenged (it may pass), and three read thin product pages.',
  },
  {
    screen: 'result',
    kind: 'fixture',
    locked:
      "2 of 6 blocked GPTBot is refused by a firewall rule; PerplexityBot gets a challenge page. Google, Bing, Claude and OpenAI's search bot get in. 6 crawlers × 214 pages · 1 fix open · 1 on Pro",
    rendered:
      '1 blocked · 1 challenged GPTBot is blocked by a firewall rule; PerplexityBot gets a challenge page. The other four AI crawlers get in; Googlebot and Bingbot are allowed by robots.txt. 6 AI crawlers (4 scored), 2 search engines by robots.txt · 1 fix open',
    source:
      'FACTS I2 (a challenge is not blocked; the headline count is engine-derived), I6 (the crawler set), B2 (the door footer, its page count moved to the coverage line), I10 (the Pro fix was Web Bot Auth).',
  },
  {
    screen: 'result',
    kind: 'fixture',
    locked: 'Homepage and blog are fine. Top 25 pages measured · 1 fix open',
    rendered: 'Homepage, collections and blog are fine. Every page with Pro · 1 fix open',
    source:
      'Every non-product template is allowed in full for the non-rendering crawlers; FACTS I1/K9 for the footer, its page count in the coverage line.',
  },
  {
    screen: 'result',
    kind: 'fixture',
    locked:
      "Blog posts answer their titles in the first paragraph; product pages don't. Headings skip levels on 41 pages. Schema is present on products.",
    rendered:
      "The homepage and blog posts answer their titles in the first paragraph; collection pages and product pages don't. Few headings are phrased as questions. Schema is present on every template.",
    source:
      'FACTS B5 for the headings sentence; the fixture’s content checks for the templates named (homepage 1/1 and collections 9/42 answer rates, schema on 214/214).',
  },
  {
    screen: 'result',
    kind: 'facts',
    locked:
      'No Web Bot Auth directory, no llms.txt, no MCP server card. Weighted by what engines actually use.',
    rendered:
      'No llms.txt, no MCP server card, no markdown negotiation, no agent skills index. Web Bot Auth: Cloudflare can verify signed crawlers; we cannot test this from outside yet. Schema and Content Signals count; the other five do not yet.',
    source:
      'FACTS I10 (Web Bot Auth is not a missing item) and B5 (the last sentence); the absent signals listed in full from the fixture.',
  },
  {
    screen: 'result',
    kind: 'facts',
    locked: 'Fourteen fixes, in order of impact 3 open now 11 on Pro',
    rendered: 'Thirteen fixes, in order of impact 3 open now 10 on Pro',
    source: 'FACTS I10',
  },
  {
    screen: 'result',
    kind: 'fixture',
    locked:
      'Generic anchor text on 6 pages +2 SEO See with Pro 3 pages deeper than three clicks +1 SEO',
    rendered:
      'Replace the generic anchor text on 6 pages +2 SEO See with Pro Open every product page with a two-sentence answer +1 SEO',
    source: 'The fixture’s fix titles, in its rank order (rank 5, then rank 6).',
  },
  {
    screen: 'result',
    kind: 'facts',
    locked: 'Nine more, grouped by type',
    rendered: 'Eight more, grouped by type',
    source: 'FACTS I10',
  },
  {
    screen: 'result',
    kind: 'facts',
    locked: 'All fourteen, and this site checked every week.',
    rendered: 'All thirteen, and this site checked every week.',
    source: 'FACTS I10',
  },
  {
    screen: 'result',
    kind: 'facts',
    locked: 'nothing is deleted after.',
    rendered: 'nothing you can see is deleted after.',
    source: 'FACTS A6',
  },
  // ── Crawl, at the locked moment (0:47) ───────────────────────────────────────────────────
  {
    screen: 'crawl',
    kind: 'facts',
    locked: 'Fetching each page as 6 crawlers',
    rendered: 'Fetching a sample of pages as each AI crawler',
    source: 'FACTS B8',
  },
  {
    screen: 'crawl',
    kind: 'facts',
    locked:
      'That email keeps the audit beyond 24 hours and creates a free account with 14 days of Pro. It also signs you in — no password.',
    rendered: 'That email opens the result for 30 days, and nothing else.',
    source:
      'FACTS J7 and the owner’s ruling on D8: the result email opens the result for 30 days and nothing else.',
  },
];

/** What the brief adds that no locked screen has; marked `data-v2-addition` where it renders. */
export const ADDITIONS: { screen: string; what: string; source: string }[] = [
  {
    screen: 'home, result',
    what: 'The evidence class beside each verdict',
    source: 'CC-22 brief, scope 1',
  },
  {
    screen: 'result',
    what: 'A coverage line on each door that measures pages',
    source: 'CC-22 brief, scope 1',
  },
  {
    screen: 'result',
    what: 'The clean-bill and withheld variants: a crawler table, a competitor offer without numbers',
    source: 'CC-22 brief, scope 1; owner ruling on the competitor box',
  },
  {
    screen: 'result',
    what: 'Loading, not-started, failed and expired states',
    source: 'CC-22 brief, scope 4',
  },
  { screen: 'home', what: 'Inline errors under the address field', source: 'CC-22 brief, scope 3' },
  {
    screen: 'crawl',
    what: 'Milliseconds on each fetch-log line',
    source: 'CC-22 brief, scope 2; D4',
  },
  { screen: 'crawl', what: 'The "Found so far" strip under the steps', source: 'D4' },
  {
    screen: 'crawl',
    what: 'The six AI crawlers’ verdicts, from the start of the crawler tests',
    source: 'CC-22 brief, scope 2; D4',
  },
  { screen: 'crawl', what: 'The grade reveal and its result button, at the end', source: 'D4, D7' },
  {
    screen: 'crawl',
    what: 'Once the audit has ended, the header says so: “Audited”, “The result is ready.”, and “See the result” where “Cancel this audit” was',
    source: 'Design review: the locked header describes an audit still running',
  },
  { screen: 'crawl', what: 'An error under the email field', source: 'CC-22 brief, scope 5' },
];

/**
 * Text the brief adds inside a line the lock already has, where wrapping it in a marked element
 * would make the line move as it changes: removed from the rendered side before comparing.
 */
export const ADDED_TEXT: { screen: LockedScreen; pattern: RegExp; what: string }[] = [
  { screen: 'crawl', pattern: / · [\d,]+\sms/g, what: 'Milliseconds on each fetch-log line' },
];

/** The rendered text without the added text registered for `screen`. */
export function withoutAddedText(rendered: string, screen: LockedScreen): string {
  return ADDED_TEXT.filter((a) => a.screen === screen).reduce(
    (t, a) => t.replace(a.pattern, ''),
    rendered,
  );
}

/** The locked text with this screen's changes applied; throws on an entry that matches nothing. */
export function applyChanges(
  locked: string,
  screen: LockedScreen,
  squash = (s: string) => s,
): string {
  let text = locked;
  for (const c of COPY_CHANGES.filter((x) => x.screen === screen)) {
    const from = squash(c.locked);
    if (!text.includes(from))
      throw new Error(`Copy change no longer matches the locked ${screen}: "${c.locked}"`);
    text = c.all
      ? text.split(from).join(squash(c.rendered))
      : text.replace(from, squash(c.rendered));
  }
  return text;
}
