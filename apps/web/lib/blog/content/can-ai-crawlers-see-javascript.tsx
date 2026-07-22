import Link from 'next/link';
import type { Route } from 'next';
import { JsonLd, faqLd } from '../../seo/jsonld';
import type { FaqItem } from '../../seo/faq';

const FAQ: readonly FaqItem[] = [
  {
    question: 'Can AI crawlers execute JavaScript?',
    answer:
      'No \u2014 almost none can. As of July 2026, GPTBot, OAI-SearchBot, ClaudeBot, PerplexityBot, Meta-ExternalAgent, Bytespider, Amazonbot, and CCBot all read only the raw HTML your server returns, without executing any JavaScript. A Vercel and MERJ study of hundreds of millions of fetches found zero JavaScript execution by these bots. The exceptions are Google\u2019s Gemini (which uses Googlebot\u2019s renderer), Bingbot, and Applebot.',
  },
  {
    question: 'Does Google crawl JavaScript-generated content?',
    answer:
      'Yes. Googlebot renders pages with an evergreen Chromium browser kept current with stable Chrome, so JavaScript-generated content is indexed. But rendering happens in a second, queued phase that can lag the initial HTML fetch by hours or occasionally days. Server-rendered content skips that queue entirely and is also the only version most AI crawlers can read.',
  },
  {
    question: 'What is the difference between OAI-SearchBot and GPTBot?',
    answer:
      'They are separate bots with separate jobs. GPTBot collects content for training OpenAI\u2019s models. OAI-SearchBot fetches pages to surface in ChatGPT\u2019s search answers \u2014 OpenAI states that sites which block OAI-SearchBot will not appear in ChatGPT search results. Blocking GPTBot does not affect ChatGPT search visibility; blocking OAI-SearchBot removes you from it.',
  },
  {
    question: 'How do I check what AI crawlers see on my site?',
    answer:
      'Four quick tests. View Page Source (not Inspect) and search for your real text and links. Fetch the page with curl and read the response. Disable JavaScript in your browser and reload to see what vanishes. Or crawl the site with a static-HTML tool like Crawlmouse, which reads the same pre-JavaScript HTML a non-rendering AI crawler receives.',
  },
  {
    question: 'How do I fix a JavaScript site so AI crawlers can read it?',
    answer:
      'Get your important content and internal links into the initial HTML response instead of loading them with client-side JavaScript. Server-side rendering (Next.js, Nuxt, Angular Universal) or pre-rendering is the standard fix. Also check that your CDN or firewall is not silently blocking AI bots \u2014 Cloudflare has blocked AI crawlers by default on new domains since July 2025.',
  },
  {
    question: 'Will AI crawlers start rendering JavaScript soon?',
    answer:
      'There is no sign of it yet. Skipping rendering is a deliberate design choice \u2014 executing JavaScript at crawl scale is expensive, and the major AI labs have not announced plans to change it. Capabilities do evolve, though, which is why every claim on this page carries a verification date. If a major bot adds rendering, this page will be updated.',
  },
];

/** Body for /blog/can-ai-crawlers-see-javascript. Rendered inside ArticleLayout's `.article-prose`. */
export function CanAiCrawlersSeeJavascriptBody() {
  return (
    <>
      <div className="mb-8 rounded-2xl border border-oat bg-white p-6">
        <div className="text-xs font-semibold uppercase tracking-wide text-peach">Quick answer</div>
        <div className="mt-2 text-ink/80 leading-relaxed">
          No &mdash; as of July 2026, AI crawlers do not execute JavaScript. GPTBot, OAI-SearchBot, ClaudeBot,
          and PerplexityBot all read the raw HTML your server returns and nothing more. Only Google&rsquo;s
          Gemini (via Googlebot), Bingbot, and Applebot render. So a JavaScript-heavy site can rank on Google
          while being a blank page to ChatGPT, Claude, and Perplexity. To check yours, View Page Source &mdash;
          or crawl it with a static-HTML tool and see whether your real content and links are actually there.
        </div>
      </div>

      <p>
        Here&rsquo;s a problem most teams don&rsquo;t know they have: your site can rank on the first page of
        Google and be completely invisible to ChatGPT at the same time. The reason is a quiet split in how
        crawlers work. Googlebot runs a full browser engine that executes your JavaScript before indexing the
        result. The AI crawlers &mdash; the bots behind ChatGPT, Claude, and Perplexity &mdash; don&rsquo;t.
        They fetch your raw HTML, read whatever text is in it, and leave. If your content only appears after
        JavaScript runs, they see nothing. And this is no longer a niche concern: in June 2026, Cloudflare
        reported that automated traffic passed human traffic on the web for the first time &mdash; 57.5% of
        HTML requests on its network came from bots.
      </p>

      <h2>Which AI crawlers execute JavaScript? (verified July 2026)</h2>
      <p>
        The definitive public evidence remains the Vercel and MERJ study of AI crawler behavior, which
        analyzed hundreds of millions of fetches across Vercel&rsquo;s network and found that none of the
        major AI crawlers rendered JavaScript. They <em>download</em> JavaScript files &mdash; GPTBot fetched
        JS on about 11.5% of requests, Claude on about 24% &mdash; but they never <em>execute</em> them. We
        re-verified each bot&rsquo;s documented behavior for this update. Here&rsquo;s the full picture:
      </p>
      <table className="w-full border-collapse text-sm">
        <thead>
          <tr className="border-b-2 border-oat text-left">
            <th className="py-2 pr-3 font-semibold text-ink">Crawler</th>
            <th className="py-2 pr-3 font-semibold text-ink">Operator &amp; purpose</th>
            <th className="py-2 font-semibold text-ink">Executes JavaScript?</th>
          </tr>
        </thead>
        <tbody className="text-ink/80">
          <tr className="border-b border-oat">
            <td className="py-2 pr-3">GPTBot</td>
            <td className="py-2 pr-3">OpenAI &mdash; model training</td>
            <td className="py-2">No &mdash; raw HTML only</td>
          </tr>
          <tr className="border-b border-oat">
            <td className="py-2 pr-3">OAI-SearchBot</td>
            <td className="py-2 pr-3">OpenAI &mdash; ChatGPT search results</td>
            <td className="py-2">No</td>
          </tr>
          <tr className="border-b border-oat">
            <td className="py-2 pr-3">ChatGPT-User</td>
            <td className="py-2 pr-3">OpenAI &mdash; user-triggered page fetches</td>
            <td className="py-2">No</td>
          </tr>
          <tr className="border-b border-oat">
            <td className="py-2 pr-3">ClaudeBot</td>
            <td className="py-2 pr-3">Anthropic &mdash; model training</td>
            <td className="py-2">No</td>
          </tr>
          <tr className="border-b border-oat">
            <td className="py-2 pr-3">Claude-SearchBot / Claude-User</td>
            <td className="py-2 pr-3">Anthropic &mdash; search &amp; user fetches</td>
            <td className="py-2">No</td>
          </tr>
          <tr className="border-b border-oat">
            <td className="py-2 pr-3">PerplexityBot</td>
            <td className="py-2 pr-3">Perplexity &mdash; answer-engine retrieval</td>
            <td className="py-2">No</td>
          </tr>
          <tr className="border-b border-oat">
            <td className="py-2 pr-3">Meta-ExternalAgent</td>
            <td className="py-2 pr-3">Meta &mdash; AI training &amp; inference</td>
            <td className="py-2">No</td>
          </tr>
          <tr className="border-b border-oat">
            <td className="py-2 pr-3">Amazonbot</td>
            <td className="py-2 pr-3">Amazon &mdash; Alexa &amp; AI answers</td>
            <td className="py-2">No</td>
          </tr>
          <tr className="border-b border-oat">
            <td className="py-2 pr-3">Bytespider</td>
            <td className="py-2 pr-3">ByteDance &mdash; AI training</td>
            <td className="py-2">No</td>
          </tr>
          <tr className="border-b border-oat">
            <td className="py-2 pr-3">CCBot</td>
            <td className="py-2 pr-3">Common Crawl &mdash; open LLM training data</td>
            <td className="py-2">No</td>
          </tr>
          <tr className="border-b border-oat">
            <td className="py-2 pr-3">Googlebot / Gemini</td>
            <td className="py-2 pr-3">Google &mdash; Search &amp; Gemini</td>
            <td className="py-2"><strong>Yes</strong> &mdash; evergreen Chromium</td>
          </tr>
          <tr className="border-b border-oat">
            <td className="py-2 pr-3">Bingbot</td>
            <td className="py-2 pr-3">Microsoft &mdash; Bing Search &amp; Copilot</td>
            <td className="py-2"><strong>Yes</strong></td>
          </tr>
          <tr className="border-b border-oat">
            <td className="py-2 pr-3">Applebot</td>
            <td className="py-2 pr-3">Apple &mdash; Siri, Spotlight, Apple Intelligence</td>
            <td className="py-2"><strong>Yes</strong> &mdash; browser-based</td>
          </tr>
        </tbody>
      </table>
      <p className="mt-4">
        The pattern is stark: the bots that render are the ones attached to decades-old search infrastructure.
        Everything built for the AI era reads raw HTML. There&rsquo;s a logic to it &mdash; AI crawlers
        operate under tight timeouts at enormous scale, and executing JavaScript for every page would be
        hugely expensive in compute. Skipping it keeps them fast and cheap. This isn&rsquo;t a temporary gap
        they&rsquo;re rushing to close; for now, it&rsquo;s a design choice.
      </p>

      <h2>OAI-SearchBot vs GPTBot: the mix-up that silently costs AI visibility</h2>
      <p>
        OpenAI runs multiple crawlers, and conflating them is one of the most common &mdash; and most
        invisible &mdash; mistakes in AI-era robots.txt files. <strong>GPTBot</strong> gathers content for
        model training. <strong>OAI-SearchBot</strong> fetches pages to show in ChatGPT&rsquo;s search
        answers, and OpenAI&rsquo;s own documentation is blunt about it: sites opted out of OAI-SearchBot will
        not be shown in ChatGPT search results. These are independent decisions. Blocking GPTBot to stay out
        of training data is a legitimate choice that costs nothing in ChatGPT search. Blocking OAI-SearchBot
        &mdash; often by accident, via a blanket disallow or an over-eager firewall rule &mdash; removes you
        from an answer channel entirely, with no error, no warning, and nothing in your analytics to tell you
        it happened.
      </p>
      <p>If you want search visibility without contributing to training, the robots.txt is simply:</p>
      <pre>
        <code>{`User-agent: OAI-SearchBot
Allow: /

User-agent: GPTBot
Disallow: /`}</code>
      </pre>
      <p>
        This matters more than it used to, because blocking is becoming the default posture of the web.
        Cloudflare has blocked AI crawlers by default on newly onboarded domains since July 1, 2025, and
        announced that from September 15, 2026 it will also block &ldquo;mixed-use&rdquo; AI crawlers by
        default on pages carrying ads, alongside a &ldquo;Pay Per Use&rdquo; model that compensates publishers
        when content surfaces in AI answers. Per Originality.ai&rsquo;s tracking, about 25% of the top 1,000
        websites now block GPTBot, up from 5% at its 2023 launch. If your site sits behind a CDN or WAF, it is
        worth checking what it decided on your behalf.
      </p>

      <h2>Does Google crawl JavaScript-generated content?</h2>
      <p>
        Yes &mdash; and it&rsquo;s worth being precise about how, because &ldquo;Google renders
        JavaScript&rdquo; hides a two-phase process. In phase one, Googlebot fetches your raw HTML and can
        index what&rsquo;s in it immediately. In phase two, the page enters a render queue for Google&rsquo;s
        Web Rendering Service, an evergreen Chromium kept current with stable Chrome, which executes your
        JavaScript and indexes the full result. That second phase happens once resources allow &mdash;
        usually quickly, sometimes hours, occasionally days. (Google most recently updated its JavaScript
        documentation in December 2025, clarifying how it handles status codes, canonicals, and noindex in
        JavaScript-rendered environments.)
      </p>
      <p>
        Two practical consequences. First, server-rendered content skips the queue entirely &mdash; it&rsquo;s
        indexable from the first fetch. Second, and more importantly for this page: Google&rsquo;s rendering
        maturity applies <em>only to Google</em>. Solving JavaScript SEO for Googlebot does nothing for the AI
        crawlers, because they never enter a rendering phase at all.
      </p>

      <h2>Why a page can rank on Google but be blank to ChatGPT</h2>
      <p>
        This is the part that&rsquo;s easy to miss, because every signal you normally watch says things are
        fine. Googlebot renders your client-side app, indexes the result, and the page ranks. An AI crawler
        fetches the same URL, reads the raw HTML, finds a near-empty shell of <code>&lt;div&gt;</code> and
        script tags, and moves on. One URL, two readers, two entirely different outcomes. The pages most
        likely to be client-rendered in modern stacks &mdash; pricing tables, product grids, comparison pages,
        docs, FAQs &mdash; are exactly the pages AI engines most often draw on for answers.
      </p>
      <p>
        The subtler failure modes bite even on mostly server-rendered sites: content that loads on scroll via
        Intersection Observer, tab and accordion panels fetched on click, product lists that render
        client-side after filtering, and internal links injected by JavaScript. Each of those is invisible to
        a non-rendering bot even when the rest of the page reads fine. JavaScript-injected internal links are
        the quiet one &mdash; they can make whole sections of a site unreachable to an AI crawler that
        discovers pages by following links in raw HTML.
      </p>
      <p>
        Should you care? Honestly: proportionally. AI referral traffic is still small next to Google, and the
        crawl-to-referral exchange is lopsided &mdash; Cloudflare&rsquo;s 2026 Radar data measured Anthropic
        crawling roughly 10,000 pages per referral sent, OpenAI around 900, versus about 5 for Googlebot. The
        case for fixing it isn&rsquo;t today&rsquo;s traffic share; it&rsquo;s that the fix is usually
        one-time architectural work, the channel keeps growing, and the same raw-HTML completeness also serves
        Google&rsquo;s fast first-phase indexing. You don&rsquo;t want your best pages structurally unreadable
        to the fastest-growing discovery surface on the web.
      </p>

      <h2>How to check what AI crawlers see on your site</h2>
      <p>
        You don&rsquo;t need special software for the basic test &mdash; you need to look at your raw HTML,
        the version that exists before any JavaScript executes. Four ways, from quickest to most thorough:
      </p>
      <ul>
        <li>
          <strong>View Page Source.</strong> Right-click a page and choose &ldquo;View Page Source&rdquo;
          &mdash; not &ldquo;Inspect,&rdquo; which shows the post-JavaScript DOM and will mislead you. Search
          the source for your real text, headings, and internal links. If they&rsquo;re there, non-rendering
          bots can read them. If you find mostly an empty <code>&lt;div id=&quot;root&quot;&gt;</code> and
          script tags, they can&rsquo;t.
        </li>
        <li>
          <strong>Fetch it like a bot.</strong> From a terminal:{' '}
          <code>curl -A &quot;GPTBot&quot; -s https://yoursite.com | less</code>. That response body is
          literally what a non-rendering crawler receives. (Testing with a bot user-agent also reveals whether
          your CDN or firewall serves bots something different &mdash; or blocks them outright.)
        </li>
        <li>
          <strong>Disable JavaScript and reload.</strong> Turn off JS in your browser settings and refresh.
          Whatever disappears is what an AI crawler never had.
        </li>
        <li>
          <strong>Crawl the static HTML at site scale.</strong> The three tests above check one page at a
          time. <Link href={{ pathname: '/' }}>Crawlmouse</Link> crawls your whole site the way a
          non-rendering bot does &mdash; raw server HTML, no JavaScript execution &mdash; and maps the
          internal-link graph it finds. If pages or links are missing from that crawl, or it flags the site as
          JavaScript-rendered, those pages and links are invisible to AI crawlers too. It won&rsquo;t diagnose
          every content type &mdash; it&rsquo;s an internal-linking grader, not a rendering debugger &mdash;
          but it shows you the site structure a raw-HTML reader actually sees, free and with nothing to
          install. (It&rsquo;s the same crawl behind a full{' '}
          <Link href={'/blog/free-internal-link-audit' as Route}>internal-link audit</Link>.)
        </li>
      </ul>
      <p>
        One more check that costs thirty seconds: grep your server or CDN logs for <code>GPTBot</code>,{' '}
        <code>OAI-SearchBot</code>, <code>ClaudeBot</code>, and <code>PerplexityBot</code>. If they&rsquo;re
        absent entirely, your problem may be access &mdash; robots.txt, firewall, or CDN defaults &mdash;
        rather than rendering.
      </p>

      <h2>How to fix it</h2>
      <p>
        The fix is well-established and mostly a one-time architectural decision: get your important content
        and internal links into the <em>initial HTML response</em>, not loaded afterward by client-side
        JavaScript. In practice that means server-side rendering &mdash; Next.js for React, Nuxt for Vue,
        Angular Universal for Angular &mdash; or pre-rendering pages to static HTML. Content in the raw HTML
        before scripts run is readable by everyone: Google, Bing, and every AI crawler in the table above. It
        doesn&rsquo;t have to be visible prose, either &mdash; server-rendered payloads and JSON-LD in the
        initial response are readable; content fetched after load is not.
      </p>
      <p>
        And don&rsquo;t forget the plumbing: none of this helps if crawlers can&rsquo;t reach the page in the
        first place. Make sure your <Link href={'/blog/orphan-pages' as Route}>internal linking</Link> is
        solid and your pages are actually{' '}
        <Link href={'/blog/discovered-currently-not-indexed' as Route}>getting crawled and indexed</Link>{' '}
        &mdash; a page an AI crawler could read but never finds is just as invisible as one it finds but
        can&rsquo;t read. And check your access layer: an inherited robots.txt rule or a CDN&rsquo;s default
        AI-block can undo everything the architecture gets right.
      </p>
      <p>
        Run the View Source test on your five most important pages today. If your content and links are in the
        raw HTML, you&rsquo;re in good shape. If they&rsquo;re not, you&rsquo;ve just found the reason your
        best pages aren&rsquo;t showing up in AI answers.
      </p>

      <section className="mt-16 border-t border-oat pt-8">
        <h2>Frequently asked questions</h2>
        <dl className="mt-2">
          {FAQ.map((f) => (
            <div key={f.question} className="border-b border-oat py-6">
              <dt className="font-display font-semibold text-lg text-ink">{f.question}</dt>
              <dd className="mt-2 text-ink/70 leading-relaxed">{f.answer}</dd>
            </div>
          ))}
        </dl>
      </section>

      <JsonLd data={faqLd(FAQ)} />
    </>
  );
}
