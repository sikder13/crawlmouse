// The answer-engine layer of each post: its direct answer (shown under the H1 and emitted as the
// Article's `abstract`) and the questions it answers (a visible section plus FAQPage JSON-LD built
// from the same items). Written only from the post's own words: each added summary and answer lists
// the body sentences it is drawn from (`from`, verbatim as rendered), and
// __tests__/blog-answers.test.tsx checks those sentences occur in the body and that every number and
// word in the summary or answer occurs in the post's rendered body.
//
// A post whose body already opens with a "Quick answer" box keeps that box as its direct answer
// (`quick-answer`), rather than gaining a second one above it; its text is the Article's abstract.
// A post whose body already ends with a visible FAQ backed by FAQPage JSON-LD keeps that section
// (`body-faq`), so no page carries two FAQPage nodes.

export interface Drawn {
  text: string;
  /** The body sentences `text` is drawn from, as the rendered body has them. */
  from: readonly string[];
}

export interface DrawnAnswer extends Drawn {
  question: string;
}

export type Summary = ({ kind: 'added' } & Drawn) | { kind: 'quick-answer'; text: string };

export type Questions = { kind: 'added'; items: readonly DrawnAnswer[] } | { kind: 'body-faq' };

export interface PostAnswers {
  summary: Summary;
  questions: Questions;
}

const quick = (text: string): Summary => ({ kind: 'quick-answer', text });
const BODY_FAQ: Questions = { kind: 'body-faq' };

export const ANSWERS: Readonly<Record<string, PostAnswers>> = {
  'ai-crawler-access-test-2026': {
    summary: {
      kind: 'added',
      text: 'In October 2026 we fetched 96 websites with the user-agent strings AI crawlers publish, from ordinary cloud IPs, and compared each answer with a plain browser fetch. The same crawler names, sent to the same five sites from two cloud networks a day apart, did not get the same answers. These were simulated requests.',
      from: [
        'In October we ran three rounds of live tests. Each fetched real websites with the published user-agent strings of AI crawlers, such as GPTBot, ClaudeBot and PerplexityBot, and compared the answer with a plain browser fetch of the same page.',
        'Across the rounds we fetched 96 distinct websites.',
        'Round one, 25 October 2026',
        'The same crawler names, sent to the same five sites from two cloud networks a day apart, did not get the same answers.',
        'Ours sent GPTBot’s user-agent string from an ordinary cloud IP.',
        'So the results below are simulated requests: they show how a site treated our infrastructure, and they are labelled as simulated.',
      ],
    },
    questions: {
      kind: 'added',
      items: [
        {
          question: 'Did the same crawler name always get the same answer?',
          text: 'No. The same crawler names, sent to the same five sites from two cloud networks a day apart, did not get the same answers. Our notes single out nike.com, en.wikipedia.org and neilpatel.com.',
          from: [
            'The same crawler names, sent to the same five sites from two cloud networks a day apart, did not get the same answers.',
            'Our notes single out nike.com, en.wikipedia.org and neilpatel.com.',
          ],
        },
        {
          question: 'Did these requests come from the real AI crawlers?',
          text: 'No. Our requests carried crawler names; they did not come from the crawlers. The real GPTBot comes from OpenAI’s published IP ranges, and ours sent GPTBot’s user-agent string from an ordinary cloud IP.',
          from: [
            'Our requests carried crawler names; they did not come from the crawlers.',
            'The real GPTBot comes from OpenAI’s published IP ranges and, on Cloudflare, is a verified bot.',
            'Ours sent GPTBot’s user-agent string from an ordinary cloud IP.',
          ],
        },
        {
          question: 'Is a robots.txt check alone enough?',
          text: 'No. In our tests, robots.txt and the response our requests received disagreed in both directions. On css-tricks.com, whose robots.txt explicitly allows GPTBot, ChatGPT-User and ClaudeBot, each of the six AI crawler names we sent got a 403 on 20 of 20 sampled pages.',
          from: [
            'In our tests, it and the response our requests received disagreed in both directions.',
            'css-tricks.com’s robots.txt explicitly allows GPTBot, ChatGPT-User and ClaudeBot.',
            'In round two, each of the six AI crawler names we sent got a 403 on 20 of 20 sampled pages, while Chrome and our own crawler got 200.',
          ],
        },
        {
          question: 'How did small-business homepages answer compared with large sites?',
          text: 'In the small-business set, 42 of the 48 homepages were recorded as everything allowed. On 21 of the 48 large sites, by our notes’ classification, the edge challenged or blocked even the browser control.',
          from: [
            'In the small-business set, 42 of the 48 homepages were recorded as everything allowed.',
            'On 21 of the 48 large sites, by our notes’ classification, the edge challenged or blocked even the browser control.',
          ],
        },
        {
          question: 'What should I check on my own site?',
          text: 'Read your robots.txt for each crawler name, check your CDN or firewall’s bot settings, and look for the real crawlers in your own logs and confirm them against the IP ranges the crawler’s operator publishes.',
          from: [
            'Read your robots.txt for each crawler name.',
            'Check your CDN or firewall’s bot settings.',
            'Look for the real crawlers in your own logs.',
            'Find hits from the crawler names in your server or CDN logs, and confirm them against the IP ranges the crawler’s operator publishes',
          ],
        },
      ],
    },
  },
  'cloudflare-ai-crawler-defaults-september-15': {
    summary: {
      kind: 'added',
      text: 'From September 15, 2026, Cloudflare blocks Training and Agent crawlers by default on pages that display ads, while Search crawlers stay allowed. The new defaults apply to new domains, new sites added by existing customers, and existing free-plan customers who haven’t changed their settings. Make an explicit choice for all three categories.',
      from: [
        'On September 15, 2026, Cloudflare changes what happens to AI crawlers on a large slice of the web',
        'Starting September 15, the default settings change: Training and Agent crawlers are blocked by default on pages that display ads, while Search crawlers stay allowed.',
        'Per Cloudflare’s announcement, the new defaults apply to new domains joining Cloudflare, new sites added by existing customers, and existing free-plan customers who haven’t changed their settings.',
        'Make an explicit choice for all three and save it.',
      ],
    },
    questions: BODY_FAQ,
  },
  'screaming-frog-vs-lumar-deepcrawl': {
    summary: quick(
      'This is less “which is better” and more “which world are you in.” Screaming Frog (£199/$279 per year, free to 500 URLs) is the desktop standard: fast, granular, run-it-yourself audits, now with a native MCP server for AI assistants. Lumar — the enterprise platform formerly called DeepCrawl — is quote-priced, cloud-based, and built for continuous monitoring, team workflows, and CI/CD integration at organisational scale. Solo SEOs and small teams rarely need Lumar; enterprises with engineering pipelines rarely stay on desktop alone.',
    ),
    questions: BODY_FAQ,
  },
  'find-orphan-pages-squarespace': {
    summary: quick(
      'To find orphan pages on Squarespace, crawl your live site with a free browser tool like Crawlmouse — it maps your internal links and lists every page nothing points to, with nothing to install. Squarespace is unusually prone to orphans because of its Not Linked section: pages there stay public and indexable but vanish from navigation, so unless you link to them manually, they exist with zero internal links.',
    ),
    questions: BODY_FAQ,
  },
  'block-ai-crawlers-robots-txt': {
    summary: quick(
      'Don’t decide “AI crawlers: yes or no.” Decide two separate questions. Training bots (GPTBot, ClaudeBot, CCBot) collect content for future models — blocking them costs you no visibility. Search bots (OAI-SearchBot, Claude-SearchBot, PerplexityBot) fetch pages to cite in AI answers — blocking them removes you from those answers. Most sites that want AI visibility should allow the search bots, choose deliberately on the training bots, and — especially behind Cloudflare — verify nothing is being blocked on their behalf.',
    ),
    questions: BODY_FAQ,
  },
  'sitebulb-vs-jetoctopus-vs-oncrawl': {
    summary: quick(
      'Three cloud crawlers, three shapes. Sitebulb Cloud (from £95/mo) is the guided one: prioritised Hints, visual maps, client reports, JavaScript crawling included. JetOctopus (volume-priced; an advertised 1M-page package is ~$383/mo annually) is the fast, transparent, self-serve one, with server-log analysis built in. Oncrawl (quote-based) is the enterprise data platform: logs at massive scale, segmentation, BI integrations. Pick by site size and whether you need log analysis — and for a small site or a pure internal-linking question, you may not need any of them.',
    ),
    questions: BODY_FAQ,
  },
  'can-ai-crawlers-see-javascript': {
    summary: quick(
      'No — as of July 2026, AI crawlers do not execute JavaScript. GPTBot, OAI-SearchBot, ClaudeBot, and PerplexityBot all read the raw HTML your server returns and nothing more. Only Google’s Gemini (via Googlebot), Bingbot, and Applebot render. So a JavaScript-heavy site can rank on Google while being a blank page to ChatGPT, Claude, and Perplexity. To check yours, View Page Source — or crawl it with a static-HTML tool and see whether your real content and links are actually there.',
    ),
    questions: BODY_FAQ,
  },
  'sitebulb-vs-screaming-frog': {
    summary: quick(
      'Screaming Frog and Sitebulb are the two big technical-SEO crawlers, and they overlap heavily. Screaming Frog (£199/$279 per year, free up to 500 URLs) is the faster, denser power-user tool — and since v24 the more AI-integrated one, with a native MCP server. Sitebulb (from ~$13.50/mo desktop, Cloud from £95/mo) is more guided and visual, with prioritised plain-language Hints and JavaScript crawling on every tier. Pick Screaming Frog for cheap, granular data and automation; Sitebulb for friendlier reporting. For internal linking alone, neither is required.',
    ),
    questions: BODY_FAQ,
  },
  'find-orphan-pages-webflow': {
    summary: quick(
      'Webflow usually orphans pages in one of two ways: you put a limit on a CMS Collection List (so items past the limit get no internal links), or you publish a page without adding it to the navbar or body content. To find them, crawl your live site with a free browser tool like Crawlmouse, which lists every page nothing links to — no app to install.',
    ),
    questions: BODY_FAQ,
  },
  'sitebulb-alternative': {
    summary: quick(
      'If you want a free Sitebulb alternative for internal linking and AI-readiness, Crawlmouse crawls your site in the browser, maps the internal-link graph, and grades the structure — no install, no trial clock. If you want a full technical crawler, Screaming Frog (£199/year, about $279 at the time of writing, free up to 500 URLs) is the closest like-for-like swap. Below: six real alternatives with current pricing, and an honest note on when Sitebulb is still the right buy.',
    ),
    questions: BODY_FAQ,
  },
  'discovered-currently-not-indexed': {
    summary: quick(
      '“Discovered – currently not indexed” means Google knows your page exists but hasn’t crawled it yet, so it’s a crawl-priority problem, not a penalty. The most reliable fix is stronger internal linking: add contextual links to the page from established, related pages, reduce its click depth, and stop it being an orphan.',
    ),
    questions: BODY_FAQ,
  },
  'find-orphan-pages-shopify': {
    summary: quick(
      'To find orphan pages on Shopify, crawl your live store with a free browser tool like Crawlmouse — it maps your internal links and lists every page nothing points to, with no app to install. Shopify is especially prone to orphans because its flat URLs and collection templates often leave product pages with few or no direct internal links.',
    ),
    questions: BODY_FAQ,
  },
  'find-orphan-pages-wordpress': {
    summary: quick(
      'To find orphan pages in WordPress, use an SEO plugin like Rank Math or Yoast that flags posts with no internal links — or, without adding a plugin, crawl your live site with a free browser tool like Crawlmouse, which maps your internal links and lists every orphaned page regardless of your theme, page builder, or plugins.',
    ),
    questions: BODY_FAQ,
  },
  'screaming-frog-alternative': {
    summary: {
      kind: 'added',
      text: 'Screaming Frog’s free version stops at 500 URLs and the paid licence is £199 a year. Match the tool to the job: a browser-based auditor for a free check without installing anything, another desktop crawler for the same depth but friendlier, a cloud platform your whole team can see, or open source if you want free forever.',
      from: [
        'The free version stops at 500 URLs, the paid licence is £199 a year (about $279 at the time of writing), it’s desktop software your laptop has to power through, and reading its output is a skill in itself.',
        'Match the tool to the job and the choice mostly makes itself.',
        '“I want a free check without installing anything” — you want a browser-based auditor.',
        '“I want the same depth but friendlier” — you want another desktop crawler with better explanations.',
        '“I want cloud crawling my whole team can see” — you want a cloud platform, and a bigger budget.',
        '“I want free forever, and I don’t mind hosting it” — you want open source.',
      ],
    },
    questions: BODY_FAQ,
  },
  'how-deep-is-too-deep-crawl-depth': {
    summary: {
      kind: 'added',
      text: 'There is no universal number Google publishes, and depth is not a direct ranking penalty: it is a discovery cost. On small sites (under ~1,000 pages) almost everything should sit within 3 clicks of the homepage. On any site, depth should track importance, and the pages you care about most should be the shallowest.',
      from: [
        'There is no universal number Google publishes, and depth is not a direct ranking penalty.',
        'What depth really is, is a discovery cost: the deeper a page sits, the less often it gets crawled, the less internal authority reaches it, and the longer it takes for changes to be noticed.',
        'Small sites (under ~1,000 pages): almost everything should sit within 3 clicks of the homepage.',
        'The pattern across all three: depth should track importance. The pages you care about most should be the shallowest.',
      ],
    },
    questions: {
      kind: 'added',
      items: [
        {
          question: 'How deep is too deep for a medium-sized site?',
          text: 'For medium sites (1k–50k pages), aim for your important pages at depth 2–3 and the bulk of content within 4 clicks. Some depth is unavoidable; uncontrolled depth isn’t.',
          from: [
            'Medium sites (1k–50k pages): aim for your important pages at depth 2–3 and the bulk of content within 4 clicks. Some depth is unavoidable; uncontrolled depth isn’t.',
          ],
        },
        {
          question: 'Does Google penalize a page for being deep?',
          text: 'No. A page doesn’t get demoted for being at depth 5. The deeper a page sits, the less often it gets crawled, the less internal authority reaches it, and the longer it takes for changes to be noticed.',
          from: [
            'A page doesn’t get demoted for being at depth 5.',
            'the deeper a page sits, the less often it gets crawled, the less internal authority reaches it, and the longer it takes for changes to be noticed.',
          ],
        },
        {
          question: 'Do AI crawlers reach pages that are linked only through JavaScript?',
          text: 'The crawlers behind ChatGPT, Claude, and Perplexity largely don’t execute JavaScript: they read your raw HTML and follow the links that are actually in it. If a link only shows up after a script runs, the page behind it is, to that crawler, at infinite depth.',
          from: [
            'the bots behind ChatGPT, Claude, and Perplexity — largely don’t execute JavaScript. They read your raw HTML and follow the links that are actually in it.',
            'If a link only shows up after a script runs — a “Load more” button, a client-rendered menu — then a crawler that doesn’t execute that script never sees the link, and the page behind it is, to that crawler, at infinite depth.',
          ],
        },
        {
          question: 'What is the fastest way to pull a buried page back up?',
          text: 'Link to it from a shallow, relevant page. A single contextual link from your homepage, a hub page, or a popular article can lift a page several levels in one move.',
          from: [
            'Link to it from a shallow, relevant page. A single contextual link from your homepage, a hub page, or a popular article can lift a page several levels in one move.',
          ],
        },
        {
          question: 'Should every page go in the main navigation to keep it shallow?',
          text: 'No. That makes everything shallow and nothing important: it spreads your authority thin across hundreds of links instead of concentrating it where it counts.',
          from: [
            'That makes everything shallow and nothing important — it spreads your authority thin across hundreds of links instead of concentrating it where it counts.',
          ],
        },
      ],
    },
  },
  'free-internal-link-audit': {
    summary: quick(
      'To check your internal links for free, paste your URL into a browser-based checker like Crawlmouse. It crawls your live site, maps how every page links to every other, and grades the structure — flagging orphan pages, pages buried too deep, and weak hubs — in under two minutes, with no account or install.',
    ),
    questions: BODY_FAQ,
  },
  'orphan-pages': {
    summary: quick(
      'To find orphan pages, compare every page that exists on your site against every page something links to — the gap is your orphan list. The fastest free way is to crawl your site with a browser tool like Crawlmouse, which maps your internal links and flags every page with zero inbound links automatically — no install, license, or plugin required.',
    ),
    questions: BODY_FAQ,
  },
  'crawl-depth-site-architecture': {
    summary: {
      kind: 'added',
      text: 'Click depth is the fewest clicks a visitor or a crawler needs to reach a page from your homepage: it is measured in links, not folders. Pages close to the homepage get visited more often; a shallow page accumulates more internal authority. The pages you care about most should be the shallowest.',
      from: [
        'Click depth is measured in links, not folders: the fewest clicks a visitor (or a crawler) needs to reach the page starting from your homepage.',
        'Pages close to the homepage — and close to other heavily linked pages — get visited more often, so changes to them are noticed sooner.',
        'Over time, the shallow page gets crawled more often, accumulates more internal authority, and ranks better.',
        'The principle underneath it is sound, though: the pages you care about most should be the shallowest.',
      ],
    },
    questions: {
      kind: 'added',
      items: [
        {
          question: 'Is click depth the same as URL depth?',
          text: 'No. Click depth has nothing to do with how many slashes are in your URL. A page at example.com/blog/2021/03/long-old-post is one click from home if your homepage links straight to it.',
          from: [
            'The single biggest misconception: click depth has nothing to do with how many slashes are in your URL.',
            'A page at example.com/blog/2021/03/long-old-post looks “deep” — but if your homepage links straight to it, it’s one click from home.',
          ],
        },
        {
          question: 'Does every page need to be within three clicks of the homepage?',
          text: 'Treat the three-click rule as a rule of thumb, not a law; there’s nothing magic about the number three. The principle underneath it is sound: the pages you care about most should be the shallowest.',
          from: [
            'Treat that as a rule of thumb, not a law. There’s nothing magic about the number three, and a huge site genuinely can’t put a million products three clicks from home.',
            'The principle underneath it is sound, though: the pages you care about most should be the shallowest.',
          ],
        },
        {
          question: 'What controls the click depth of a site?',
          text: 'Three things, in roughly this order of impact: primary navigation, hub and category pages, and contextual links inside content. A link from one article to a related one can single-handedly pull a page up several levels.',
          from: [
            'Three things shape the depth of your site, in roughly this order of impact:',
            'Primary navigation.',
            'Hub and category pages.',
            'Contextual links inside content. A link from one article to a related one can single-handedly pull a page up several levels.',
          ],
        },
        {
          question: 'How do you measure click depth?',
          text: 'You need a crawl that starts at your homepage and records the shortest click-path to every page, because depth is a property of the whole link graph, not of any single page.',
          from: [
            'depth is a property of the whole link graph, not of any single page.',
            'You need a crawl that starts at your homepage and records the shortest click-path to every page.',
          ],
        },
        {
          question: 'How do you reduce click depth without putting every page in the navigation?',
          text: 'Make sure each important page is within a few clicks of home via a hub or a contextual link, strengthen hub pages so they actually link down to the pages beneath them, tame pagination, and add contextual links between related pages as you publish.',
          from: [
            'Identify your money pages and most important content, and make sure each is within a few clicks of home via a hub or a contextual link.',
            'Strengthen hub pages so they actually link down to the pages beneath them, and link up to them from related content.',
            'Tame pagination',
            'Add contextual links between related pages as you publish.',
          ],
        },
      ],
    },
  },
};

/** The post's answer layer, or null for a slug without one. Own keys only. */
export function getAnswers(slug: string): PostAnswers | null {
  return Object.hasOwn(ANSWERS, slug) ? ANSWERS[slug]! : null;
}

/** The summary to render under the H1, or null when the body already opens with one. */
export function addedSummary(slug: string): string | null {
  const s = getAnswers(slug)?.summary;
  return s?.kind === 'added' ? s.text : null;
}

/** The "Questions this answers" items to render, or an empty list when the body has its own FAQ. */
export function addedQuestions(slug: string): readonly DrawnAnswer[] {
  const q = getAnswers(slug)?.questions;
  return q?.kind === 'added' ? q.items : [];
}

/** The post's direct answer as the Article's `abstract`: the added summary or the Quick answer. */
export function postAbstract(slug: string): string | null {
  return getAnswers(slug)?.summary.text ?? null;
}

/** Whether the visible body gained a summary or a questions section here (D4 a or b). */
export function bodyGainedAnswers(slug: string): boolean {
  return addedSummary(slug) !== null || addedQuestions(slug).length > 0;
}
