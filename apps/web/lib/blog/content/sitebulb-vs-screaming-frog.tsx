import Link from 'next/link';
import type { Route } from 'next';
import { JsonLd, faqLd } from '../../seo/jsonld';
import type { FaqItem } from '../../seo/faq';

const FAQ: readonly FaqItem[] = [
  {
    question: 'What is the difference between Sitebulb and Screaming Frog?',
    answer:
      'Both are full technical-SEO crawlers with 300+ checks. Screaming Frog is the long-standing power-user standard — a dense, fast desktop app with a free tier up to 500 URLs. Sitebulb is more guided and visual: it prioritises issues as plain-language "Hints" and draws visual crawl maps, but has no permanent free tier and is subscription-based.',
  },
  {
    question: 'Which is better for beginners, Sitebulb or Screaming Frog?',
    answer:
      'Sitebulb is generally friendlier for newcomers. It explains each issue in plain English with a severity and a recommended fix, and its visual crawl maps make site structure easy to grasp. Screaming Frog is more powerful but hands you dense spreadsheets, which has a steeper learning curve.',
  },
  {
    question: 'Is Sitebulb or Screaming Frog cheaper?',
    answer:
      'Screaming Frog is free up to 500 URLs, then about £199 / $259 per year for one user. Sitebulb has a free trial but no lasting free tier — roughly $13.50/month for Lite (10,000-URL cap), about $35/month for Pro, and around $245/month for the cloud version. For occasional small audits, Screaming Frog\u2019s free tier is the cheapest start. Prices can change, so check both sites.',
  },
  {
    question: 'Do I need a full crawler just to check internal linking?',
    answer:
      'Not necessarily. Sitebulb and Screaming Frog do far more than internal linking — redirects, metadata, duplicate content, and more. If you only want to audit and grade your internal-link structure, a free browser tool like Crawlmouse does that specific job with nothing to install.',
  },
  {
    question: 'Can I use both Sitebulb and Screaming Frog?',
    answer:
      'Plenty of SEOs do. Some prefer Screaming Frog for fast, granular data extraction and Sitebulb for its prioritised reporting and visualisations. They overlap heavily, though, so most individuals settle on one. Try each on a real site before committing.',
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
          Screaming Frog is the faster, denser power-user tool with a free tier up to 500 URLs; Sitebulb is
          more guided and visual, with prioritised plain-language issues but no free tier. Pick Screaming Frog
          for cheap, granular data; Sitebulb for friendlier reporting. For internal linking alone, neither is
          required.
        </div>
      </div>

      <p>
        If you&rsquo;re choosing a technical-SEO crawler, it usually comes down to these two. Screaming Frog
        and Sitebulb both crawl your whole site and surface hundreds of technical issues, and honestly, either
        one will do the job well. The differences are about <em>how</em> they do it &mdash; price, learning
        curve, and whether you want dense data or guided reporting. Here&rsquo;s the honest comparison, and a
        note at the end on when you don&rsquo;t need either.
      </p>

      <h2>Screaming Frog: the power-user standard</h2>
      <p>
        Screaming Frog&rsquo;s SEO Spider has been a fixture of technical SEO for years. It&rsquo;s a desktop
        app (Windows, macOS, Linux) that crawls fast and exposes an enormous amount of granular data: broken
        links, redirects and redirect chains, duplicate content, metadata problems, and much more. Its
        strengths are speed, depth, and control &mdash; and a genuinely useful <strong>free tier that crawls
        up to 500 URLs</strong>, which is enough for many small sites. Beyond that, a licence runs roughly
        £199 / $259 per year per user and unlocks unlimited crawls, saved configurations, JavaScript
        rendering, and integrations. The trade-off is the interface: it hands you dense spreadsheets and
        assumes you know what to do with them. Powerful, but a steeper climb for newcomers.
      </p>

      <h2>Sitebulb: guided, visual, prioritised</h2>
      <p>
        Sitebulb crawls the same kind of data but wraps it in guidance. Instead of raw tables, it presents
        prioritised &ldquo;Hints&rdquo; &mdash; each issue explained in plain language with a severity and a
        recommended fix &mdash; and it draws <strong>visual crawl maps</strong> that make your site
        architecture, orphaned clusters, and deep pages easy to see at a glance. It also does accessibility
        checks and client-ready reports, which is why agencies like it. The catch is pricing: there&rsquo;s a
        free trial but <strong>no permanent free tier</strong>. Plans run about $13.50/month for Lite (capped
        at 10,000 URLs), roughly $35/month for Pro, and around $245/month for the cloud version. (Both tools
        change pricing over time &mdash; confirm on their sites.)
      </p>

      <h2>How to choose</h2>
      <ul>
        <li>
          <strong>Pick Screaming Frog</strong> if you want the cheapest start (its free 500-URL tier), fast
          and granular data extraction, and you&rsquo;re comfortable interpreting dense reports yourself. Best
          for hands-on SEOs and developers.
        </li>
        <li>
          <strong>Pick Sitebulb</strong> if you want issues prioritised and explained, visual site maps, and
          polished reports to share with clients or a team &mdash; and you&rsquo;re fine with a subscription
          and no free tier. Best for agencies and people newer to technical audits.
        </li>
      </ul>
      <p>
        Honestly, they overlap enough that most individuals end up using one, not both. The best way to
        decide is to run each on a real site &mdash; Screaming Frog&rsquo;s free tier and Sitebulb&rsquo;s
        trial both let you do that before paying.
      </p>

      <h2>When you don&rsquo;t need either</h2>
      <p>
        Both tools are full technical-SEO suites, which is more than many people actually need. If the
        question in front of you is specifically &ldquo;is my <Link
        href={'/blog/crawl-depth-site-architecture' as Route}>internal linking</Link> holding my pages
        back?&rdquo; &mdash; the orphans, the pages buried too deep, the weak hubs &mdash; you don&rsquo;t need
        to install a desktop crawler or start a subscription. <Link href={{ pathname: '/' }}>Crawlmouse</Link>
        {' '}crawls your live site in the browser, maps the internal-link graph, and grades the structure for
        free, with nothing to install. It won&rsquo;t replace Screaming Frog or Sitebulb for a full technical
        audit &mdash; it does one job &mdash; but for the internal-linking question it&rsquo;s the fastest way
        to an answer. (See the fuller comparisons for a <Link
        href={'/blog/screaming-frog-alternative' as Route}>Screaming Frog alternative</Link> and a{' '}
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
