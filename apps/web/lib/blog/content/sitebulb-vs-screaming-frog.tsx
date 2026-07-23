import Link from 'next/link';
import type { Route } from 'next';
import { JsonLd, faqLd } from '../../seo/jsonld';
import type { FaqItem } from '../../seo/faq';

const FAQ: readonly FaqItem[] = [
  {
    question: 'What is the difference between Sitebulb and Screaming Frog?',
    answer:
      'Both are full technical-SEO crawlers. Screaming Frog is the long-standing power-user standard \u2014 a dense, fast desktop app with a free tier up to 500 URLs and a flat \u00A3199/$279 yearly licence. Sitebulb is more guided and visual: it prioritises issues as plain-language \u201CHints\u201D and draws visual crawl maps, with desktop plans from about $13.50/month and a browser-based Cloud version from \u00A395/month, but no permanent free tier.',
  },
  {
    question: 'Which is better for beginners, Sitebulb or Screaming Frog?',
    answer:
      'Sitebulb is generally friendlier for newcomers. It explains each issue in plain English with a severity and a recommended fix, and its visual crawl maps make site structure easy to grasp. Screaming Frog is more powerful per pound but hands you dense spreadsheets, which means a steeper learning curve.',
  },
  {
    question: 'Is Sitebulb or Screaming Frog cheaper?',
    answer:
      'Screaming Frog is free up to 500 URLs, then \u00A3199 / $279 per year for one user (verified July 2026). Sitebulb has a 14-day free trial but no lasting free tier \u2014 roughly $13.50/month for Lite (10,000-URL audits), about $35/month for Pro (500,000-URL audits), and Sitebulb Cloud from \u00A395/month. For occasional small audits, Screaming Frog\u2019s free tier is the cheapest start. Prices change, so confirm on each vendor\u2019s site.',
  },
  {
    question: 'Does Screaming Frog have an MCP server for AI assistants?',
    answer:
      'Yes. Screaming Frog v24.0, released in May 2026, shipped a native MCP (Model Context Protocol) server, letting AI assistants like Claude run crawls and query crawl data in natural language. It also added semantic similarity analysis using LLM embeddings in v22. Sitebulb has announced its own MCP integration with a waitlist, but it is not generally available yet as of July 2026.',
  },
  {
    question: 'Do both tools render JavaScript?',
    answer:
      'Yes, both crawl JavaScript sites using evergreen Chromium rendering. The difference is packaging: Sitebulb includes JavaScript crawling on every tier, including Lite and the free trial, while Screaming Frog gates JavaScript rendering behind the paid licence \u2014 the free 500-URL tier crawls raw HTML only.',
  },
  {
    question: 'Do I need a full crawler just to check internal linking?',
    answer:
      'Not necessarily. Sitebulb and Screaming Frog do far more than internal linking \u2014 redirects, metadata, duplicate content, and more. If you only want to audit and grade your internal-link structure, a free browser tool like Crawlmouse does that specific job with nothing to install.',
  },
  {
    question: 'What about Sitebulb vs JetOctopus or Oncrawl?',
    answer:
      'JetOctopus and Oncrawl are cloud crawlers aimed at large sites, with server-log analysis as a core feature \u2014 something neither Sitebulb desktop nor Screaming Frog focuses on. If you crawl millions of URLs or need log-file analysis, they belong on your shortlist. Sitebulb positions its Cloud tier (from \u00A395/month) as the more affordable cloud option for teams.',
  },
];

/** Body for /blog/sitebulb-vs-screaming-frog. Rendered inside ArticleLayout's `.article-prose`. */
export function SitebulbVsScreamingFrogBody() {
  return (
    <>
      <div className="mb-8 rounded-2xl border border-oat bg-white p-6">
        <div className="text-xs font-semibold uppercase tracking-wide text-peach">Quick answer</div>
        <div className="mt-2 text-ink/80 leading-relaxed">
          Screaming Frog and Sitebulb are the two big technical-SEO crawlers, and they overlap heavily.
          Screaming Frog (&pound;199/$279 per year, free up to 500 URLs) is the faster, denser power-user tool
          &mdash; and since v24 the more AI-integrated one, with a native MCP server. Sitebulb (from ~$13.50/mo
          desktop, Cloud from &pound;95/mo) is more guided and visual, with prioritised plain-language Hints
          and JavaScript crawling on every tier. Pick Screaming Frog for cheap, granular data and automation;
          Sitebulb for friendlier reporting. For internal linking alone, neither is required.
        </div>
      </div>

      <p>
        If you&rsquo;re choosing a technical-SEO crawler, it usually comes down to these two. Screaming Frog
        and Sitebulb both crawl your whole site and surface hundreds of technical issues, and honestly, either
        one will do the job well. The differences are about <em>how</em> they do it &mdash; price, learning
        curve, dense data versus guided reporting, and, new in 2026, how each connects to AI assistants.
        Here&rsquo;s the honest comparison with pricing verified in July 2026, and a note at the end on when
        you don&rsquo;t need either.
      </p>

      <h2>Sitebulb vs Screaming Frog at a glance (July 2026)</h2>
      <table className="w-full border-collapse text-sm">
        <thead>
          <tr className="border-b-2 border-oat text-left">
            <th className="py-2 pr-3 font-semibold text-ink">&nbsp;</th>
            <th className="py-2 pr-3 font-semibold text-ink">Screaming Frog</th>
            <th className="py-2 font-semibold text-ink">Sitebulb</th>
          </tr>
        </thead>
        <tbody className="text-ink/80">
          <tr className="border-b border-oat">
            <td className="py-2 pr-3 font-medium text-ink">Price</td>
            <td className="py-2 pr-3">Free to 500 URLs; &pound;199/$279 per year</td>
            <td className="py-2">Lite ~$13.50/mo, Pro ~$35/mo (annual); Cloud from &pound;95/mo</td>
          </tr>
          <tr className="border-b border-oat">
            <td className="py-2 pr-3 font-medium text-ink">Free option</td>
            <td className="py-2 pr-3">Permanent free tier (500 URLs, no JS rendering)</td>
            <td className="py-2">14-day trial only, no card required</td>
          </tr>
          <tr className="border-b border-oat">
            <td className="py-2 pr-3 font-medium text-ink">Crawl scale</td>
            <td className="py-2 pr-3">Unlimited on paid (bounded by your machine)</td>
            <td className="py-2">10k (Lite) / 500k (Pro) per audit; millions on Cloud</td>
          </tr>
          <tr className="border-b border-oat">
            <td className="py-2 pr-3 font-medium text-ink">JavaScript rendering</td>
            <td className="py-2 pr-3">Yes (Chromium), paid tier only</td>
            <td className="py-2">Yes (evergreen Chromium), every tier incl. trial</td>
          </tr>
          <tr className="border-b border-oat">
            <td className="py-2 pr-3 font-medium text-ink">Reporting style</td>
            <td className="py-2 pr-3">Raw tables and exports; you interpret</td>
            <td className="py-2">Prioritised plain-language Hints, visual crawl maps, client PDFs</td>
          </tr>
          <tr className="border-b border-oat">
            <td className="py-2 pr-3 font-medium text-ink">AI integration</td>
            <td className="py-2 pr-3">Native MCP server (v24, May 2026); LLM-embedding similarity (v22)</td>
            <td className="py-2">MCP announced, waitlist &mdash; not GA yet</td>
          </tr>
          <tr className="border-b border-oat">
            <td className="py-2 pr-3 font-medium text-ink">Platform</td>
            <td className="py-2 pr-3">Desktop: Windows, macOS, Linux</td>
            <td className="py-2">Desktop (Windows, macOS) + browser-based Cloud</td>
          </tr>
          <tr className="border-b border-oat">
            <td className="py-2 pr-3 font-medium text-ink">Team use</td>
            <td className="py-2 pr-3">Single-user desktop; volume licence discounts</td>
            <td className="py-2">Cloud built for shared crawls &amp; collaboration</td>
          </tr>
        </tbody>
      </table>
      <p className="mt-4">
        Both vendors change pricing and features over time &mdash; confirm on their own sites before buying.
        Everything above was checked against the official pricing and release pages in July 2026.
      </p>

      <h2>Screaming Frog: the power-user standard, now AI-connected</h2>
      <p>
        Screaming Frog&rsquo;s SEO Spider has been a fixture of technical SEO for years. It&rsquo;s a desktop
        app (Windows, macOS, Linux) that crawls fast and exposes an enormous amount of granular data: broken
        links, redirects and redirect chains, duplicate content, metadata problems, and much more. Its
        strengths are speed, depth, and control &mdash; and a genuinely useful <strong>free tier that crawls
        up to 500 URLs</strong> with no time limit, which is enough for many small sites. The paid licence
        (&pound;199 / $279 per year, per user) unlocks unlimited crawl size, saved crawls and configurations,
        JavaScript rendering, scheduling, custom extraction, and the API integrations (Search Console, GA4,
        PageSpeed, and the major link indexes).
      </p>
      <p>
        What&rsquo;s changed recently is the AI side, and it&rsquo;s changed fast. Version 22 (mid-2025) added
        semantic similarity analysis using LLM embeddings &mdash; content clustering and cannibalization
        detection powered by OpenAI, Gemini, or local Ollama models. Version 24 (May 2026) went further and
        shipped a <strong>native MCP server</strong>, which lets AI assistants like Claude drive crawls and
        query crawl data in natural language &mdash; the first major desktop crawler to do it. If your
        workflow is heading toward agent-assisted audits, Screaming Frog is currently ahead. The trade-off
        hasn&rsquo;t changed, though: the interface hands you dense spreadsheets and assumes you know what to
        do with them. Powerful, but a steeper climb for newcomers.
      </p>

      <h2>Sitebulb: guided, visual, prioritised</h2>
      <p>
        Sitebulb crawls the same kind of data but wraps it in guidance. Instead of raw tables, it presents
        prioritised &ldquo;Hints&rdquo; &mdash; each issue explained in plain language with a severity and a
        recommended fix (100+ Hints on Lite, 300+ on Pro) &mdash; and it draws <strong>visual crawl
        maps</strong> that make your site architecture, orphaned clusters, and deep pages easy to see at a
        glance. It also does accessibility checks and produces polished, client-ready PDF reports, which is
        why agencies like it. JavaScript crawling with evergreen Chromium is included on every tier, including
        the trial &mdash; a real difference from Screaming Frog&rsquo;s free tier, which reads raw HTML only.
      </p>
      <p>
        The pricing structure has three shapes. Desktop <strong>Lite</strong> runs about $13.50/month billed
        annually and caps audits at 10,000 URLs &mdash; a genuinely cheap entry for small sites.
        Desktop <strong>Pro</strong> is about $35/month annually, raises the cap to 500,000 URLs per audit,
        and adds scheduled audits, audit comparisons, and customised reports. <strong>Sitebulb Cloud</strong>,
        from &pound;95/month, moves everything into the browser with shared projects, recurring crawls, and
        collaboration &mdash; the option priced for teams. What Sitebulb doesn&rsquo;t have is a permanent
        free tier: after the 14-day trial (no card required), it&rsquo;s a subscription. On the AI side,
        Sitebulb has announced its own MCP integration with a waitlist; as of July 2026 it isn&rsquo;t
        generally available, so treat it as coming rather than shipped.
      </p>

      <h2>How to choose</h2>
      <ul>
        <li>
          <strong>Pick Screaming Frog</strong> if you want the cheapest start (its free 500-URL tier), fast
          and granular data extraction, effectively unlimited crawls for a flat yearly fee, or AI-assistant
          integration today via MCP &mdash; and you&rsquo;re comfortable interpreting dense reports yourself.
          Best for hands-on SEOs and developers.
        </li>
        <li>
          <strong>Pick Sitebulb</strong> if you want issues prioritised and explained, visual site maps,
          JavaScript crawling without paying for a licence first, and polished reports to share with clients
          or a team &mdash; and you&rsquo;re fine with a subscription and no free tier. Cloud is the pick if
          several people need to work from the same crawls. Best for agencies and people newer to technical
          audits.
        </li>
      </ul>
      <p>
        Honestly, they overlap enough that most individuals end up using one, not both. The best way to decide
        is to run each on a real site &mdash; Screaming Frog&rsquo;s free tier and Sitebulb&rsquo;s trial both
        let you do that before paying.
      </p>

      <h2>When neither is the right tool</h2>
      <p>
        Both are audit tools: you run a crawl, you get a snapshot. Some jobs need a different shape of tool
        entirely. If you need <strong>continuous monitoring</strong> that alerts you when something breaks
        between audits, that&rsquo;s the territory of always-on platforms like ContentKing (now part of
        Lumar). If you&rsquo;re crawling <strong>very large sites</strong> &mdash; millions of URLs &mdash;
        or need <strong>server-log analysis</strong> to see how bots actually spend crawl budget, cloud
        platforms like <Link href={'/blog/sitebulb-vs-jetoctopus-vs-oncrawl' as Route}>JetOctopus and Oncrawl</Link> are built specifically for that, with log-file analysis as a
        first-class feature neither desktop tool emphasises. They cost more and assume more expertise;
        they&rsquo;re the right call when scale or logs are the actual problem.
      </p>
      <p>
        And at the other end of the spectrum: both Screaming Frog and Sitebulb are full technical-SEO suites,
        which is more than many people actually need. If the question in front of you is specifically
        &ldquo;is my <Link href={'/blog/crawl-depth-site-architecture' as Route}>internal linking</Link>{' '}
        holding my pages back?&rdquo; &mdash; the orphans, the pages buried too deep, the weak hubs &mdash;
        you don&rsquo;t need to install a desktop crawler or start a subscription.{' '}
        <Link href={{ pathname: '/' }}>Crawlmouse</Link> crawls your live site in the browser, maps the
        internal-link graph, and grades the structure for free, with nothing to install. It won&rsquo;t
        replace Screaming Frog or Sitebulb for a full technical audit &mdash; it does one job &mdash; but for
        the internal-linking question it&rsquo;s the fastest way to an answer. Because it reads raw server
        HTML without executing JavaScript, it also shows you the version of your site that{' '}
        <Link href={'/blog/can-ai-crawlers-see-javascript' as Route}>AI crawlers like GPTBot actually
        see</Link>. (See the fuller comparisons for a{' '}
        <Link href={'/blog/screaming-frog-alternative' as Route}>Screaming Frog alternative</Link> and a{' '}
        <Link href={'/blog/sitebulb-alternative' as Route}>Sitebulb alternative</Link>.)
      </p>
      <p>
        The practical move: start with the free grade to see whether internal linking is even your problem,
        and reach for a full crawler like Screaming Frog or Sitebulb when the audit tells you the issue is
        broader than links.
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
