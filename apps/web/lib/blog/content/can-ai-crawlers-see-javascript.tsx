import Link from 'next/link';
import type { Route } from 'next';
import { JsonLd, faqLd } from '../../seo/jsonld';
import type { FaqItem } from '../../seo/faq';

const FAQ: readonly FaqItem[] = [
  {
    question: 'Do AI crawlers render JavaScript?',
    answer:
      'Almost none do. As of 2026, GPTBot, ClaudeBot, PerplexityBot, OAI-SearchBot, and the other major AI crawlers fetch your raw HTML and read the text in it without executing JavaScript. A Vercel and MERJ analysis of over 500 million GPTBot fetches found zero JavaScript execution. The one exception is Google Gemini, which uses Googlebot\u2019s rendering.',
  },
  {
    question: 'Can a page rank on Google but be invisible to ChatGPT?',
    answer:
      'Yes. Googlebot renders JavaScript, so a client-rendered page can rank well in Google Search. But ChatGPT, Claude, and Perplexity read only the raw HTML, so the same page can be a blank shell to them. One URL, two readers, two completely different outcomes.',
  },
  {
    question: 'How do I check if AI crawlers can see my content?',
    answer:
      'Three quick tests. Right-click the page and choose View Page Source: if your real text and links are in the raw HTML, AI crawlers can see them. Or disable JavaScript in your browser and reload to see what vanishes. Or crawl the page with a static-HTML tool like Crawlmouse, which reads the same pre-JavaScript HTML an AI crawler does.',
  },
  {
    question: 'How do I fix a JavaScript site so AI crawlers can read it?',
    answer:
      'Get your important content and internal links into the initial HTML response rather than loading them with client-side JavaScript. Server-side rendering (Next.js, Nuxt, Angular Universal) or pre-rendering is the standard fix. If the content is in the HTML before scripts run, every crawler can read it.',
  },
  {
    question: 'Does Google rendering JavaScript mean AI crawlers do too?',
    answer:
      'No, and this is the most common mistake. Google removed its JavaScript SEO warning in March 2026 because Googlebot\u2019s rendering is mature. That applies only to Google. The AI crawlers built by OpenAI, Anthropic, and Perplexity skip rendering by design for speed, so solving JavaScript SEO for Google does not solve it for AI search.',
  },
];

/** Body for /blog/can-ai-crawlers-see-javascript. Rendered inside ArticleLayout's `.article-prose`. */
export function CanAiCrawlersSeeJavascriptBody() {
  return (
    <>
      <div className="mb-8 rounded-2xl border border-oat bg-white p-6">
        <div className="text-xs font-semibold uppercase tracking-wide text-peach">Quick answer</div>
        <div className="mt-2 text-ink/80 leading-relaxed">
          Most AI crawlers &mdash; GPTBot, ClaudeBot, PerplexityBot &mdash; don&rsquo;t run JavaScript. They
          read the raw HTML your server returns and move on. So a JavaScript-heavy site can rank on Google
          (which does render JS) while being a blank page to ChatGPT, Claude, and Perplexity. To check yours,
          View Page Source or crawl it with a static-HTML tool and see whether your real content and links are
          actually there.
        </div>
      </div>

      <p>
        Here&rsquo;s a problem most teams don&rsquo;t know they have: your site can rank on the first page of
        Google and be completely invisible to ChatGPT at the same time. The reason is a quiet split in how
        crawlers work. Googlebot runs a full browser engine that executes your JavaScript before indexing the
        result. The AI crawlers &mdash; the bots behind ChatGPT, Claude, and Perplexity &mdash; don&rsquo;t.
        They fetch your raw HTML, read whatever text is in it, and leave. If your content only appears after
        JavaScript runs, they see nothing.
      </p>

      <h2>Do AI crawlers actually render JavaScript?</h2>
      <p>
        Overwhelmingly, no. A Vercel and MERJ analysis of more than 500 million GPTBot fetches found zero
        evidence of JavaScript execution &mdash; and the same held for Anthropic&rsquo;s ClaudeBot,
        PerplexityBot, and the rest. Even when these crawlers download JavaScript files (GPTBot did about 11.5%
        of the time), they don&rsquo;t run them. There&rsquo;s a logic to it: AI crawlers work under tight
        timeouts and enormous scale, and rendering JavaScript for every page would be hugely expensive in
        compute. Skipping it keeps them fast and cheap. This isn&rsquo;t a temporary gap they&rsquo;re rushing
        to close &mdash; for now, it&rsquo;s a design choice.
      </p>
      <p>
        The one meaningful exception is Google&rsquo;s Gemini, which inherits Googlebot&rsquo;s rendering
        infrastructure. Apple&rsquo;s crawler renders too. But GPTBot, OAI-SearchBot, ClaudeBot,
        Claude-SearchBot, and PerplexityBot all read raw HTML only.
      </p>

      <h2>Why a page can rank on Google but be blank to ChatGPT</h2>
      <p>
        This is the part that&rsquo;s easy to miss, because every signal you normally watch says things are
        fine. Googlebot fetches your page, executes the scripts, builds the full page, and indexes it &mdash;
        so your client-rendered content ranks. Google even removed its longstanding JavaScript SEO warning in
        March 2026 because its rendering is now mature. The trap is assuming that progress transfers. It
        doesn&rsquo;t. An AI crawler fetches the same URL, reads the raw HTML, finds an empty shell, and moves
        on. One URL, two readers, two entirely different outcomes.
      </p>
      <p>
        It compounds through Bing, too: roughly 92% of ChatGPT Search responses draw on Bing&rsquo;s index,
        and Bingbot has limited JavaScript rendering. So a fully client-rendered site can lose AI visibility
        from two directions at once &mdash; the direct crawler fetch and the Bing index behind ChatGPT Search.
        And the pages most likely to be client-rendered in modern stacks &mdash; product pages, comparison
        pages, FAQs, and docs &mdash; are exactly the ones AI engines cite most.
      </p>

      <h2>Why this matters more every quarter</h2>
      <p>
        Because the AI channel is growing fast and converts well. AI search visits grew roughly 43% year over
        year, and AI-referred visitors have been measured converting far better than standard Google clicks
        (one dataset put it at 14.2% versus 2.8%). You don&rsquo;t have to bet your whole strategy on it to
        care &mdash; you just don&rsquo;t want your best pages to be structurally unreadable to the
        fastest-growing discovery channel on the web. And it&rsquo;s worth being clear-eyed:
        AI referrals are still a fraction of traditional search. The curve is the story, not today&rsquo;s
        share.
      </p>

      <h2>How to check what AI crawlers see on your site</h2>
      <p>
        You don&rsquo;t need special software to run the basic test &mdash; you need to look at your raw HTML,
        the version before any JavaScript executes. Three ways:
      </p>
      <ul>
        <li>
          <strong>View Page Source.</strong> Right-click a page and choose &ldquo;View Page Source&rdquo;
          (not &ldquo;Inspect&rdquo; &mdash; that shows the rendered DOM). Search it for your real text,
          headings, and internal links. If they&rsquo;re there, AI crawlers can see them. If you find mostly
          an empty <code>&lt;div&gt;</code> and script tags, they can&rsquo;t.
        </li>
        <li>
          <strong>Disable JavaScript and reload.</strong> Turn off JS in your browser and refresh. Whatever
          disappears is what an AI crawler never had.
        </li>
        <li>
          <strong>Crawl the static HTML.</strong> <Link href={{ pathname: '/' }}>Crawlmouse</Link> crawls the
          same pre-JavaScript HTML an AI crawler reads and maps your internal-link graph from it. If pages or
          links are missing from its crawl &mdash; or it flags a JS-rendered site &mdash; that&rsquo;s a
          strong sign those pages and links are JavaScript-dependent and invisible to AI crawlers too. It
          won&rsquo;t diagnose every content type, but it shows you the internal structure a non-rendering
          crawler actually sees, for free. (It&rsquo;s the same crawl behind a full{' '}
          <Link href={'/blog/free-internal-link-audit' as Route}>internal-link audit</Link>.)
        </li>
      </ul>

      <h2>How to fix it</h2>
      <p>
        The fix is well-established and mostly a one-time architectural decision: get your important content
        and internal links into the <em>initial HTML response</em>, not loaded afterward by client-side
        JavaScript. In practice that means server-side rendering &mdash; Next.js for React, Nuxt for Vue,
        Angular Universal for Angular &mdash; or pre-rendering pages to static HTML. Content in the raw HTML
        before scripts run is readable by everyone: Google, Bing, and every AI crawler. A few specific traps
        to watch: content that only loads on scroll or on tab/accordion click, and product lists that render
        client-side after filtering &mdash; those stay invisible to AI crawlers even on an otherwise
        server-rendered site.
      </p>
      <p>
        And don&rsquo;t forget the plumbing: none of this helps if the crawlers can&rsquo;t reach the page in
        the first place. Make sure your <Link href={'/blog/orphan-pages' as Route}>internal linking</Link> is
        solid and your pages are actually <Link href={'/blog/discovered-currently-not-indexed' as Route}>
        getting crawled and indexed</Link> &mdash; a page an AI crawler can render but never finds is just as
        invisible as one it finds but can&rsquo;t read.
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
