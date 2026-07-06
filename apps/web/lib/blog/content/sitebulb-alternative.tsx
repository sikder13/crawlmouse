import Link from 'next/link';
import type { Route } from 'next';
import { JsonLd, faqLd } from '../../seo/jsonld';
import type { FaqItem } from '../../seo/faq';

const FAQ: readonly FaqItem[] = [
  {
    question: 'Is there a free alternative to Sitebulb?',
    answer:
      'For internal-linking audits, yes. Crawlmouse is a free, browser-based tool that crawls your site, maps its internal links, and grades the structure — with no install and no free-trial expiry. It focuses on internal linking and site structure rather than a full 300-check technical suite.',
  },
  {
    question: 'Does Sitebulb have a free version?',
    answer:
      'Sitebulb offers a free trial but no permanent free tier. After the trial you need a paid plan — roughly $13.50/month for Lite (capped at 10,000 URLs), about $35/month for Pro, and around $245/month for the cloud version. Pricing can change, so check their site.',
  },
  {
    question: 'Is Crawlmouse a full replacement for Sitebulb?',
    answer:
      'No, and it is fair to say so. Sitebulb runs 300+ prioritised audit checks, accessibility testing, and JavaScript rendering. Crawlmouse does one job: crawl your site, map the internal-link graph, and grade the structure. Use Sitebulb for a full technical audit; use Crawlmouse for a fast, free internal-linking read.',
  },
  {
    question: 'Do I need to install Sitebulb?',
    answer:
      "Sitebulb's main product is a desktop app you download and run, though it now offers a cloud version too. A browser-based alternative like Crawlmouse runs entirely in the browser with nothing to install, on any device.",
  },
  {
    question: 'Which should I use, Sitebulb or a free browser tool?',
    answer:
      'Use Sitebulb when you need deep, all-in-one technical audits with client-ready reports and are set up for a paid tool. Use a free browser grader when you specifically want to see and fix your internal-link structure quickly, without an install or a subscription.',
  },
];

/** Body for /blog/sitebulb-alternative. Rendered inside ArticleLayout's `.article-prose`. */
export function SitebulbAlternativeBody() {
  return (
    <>
      <div className="mb-8 rounded-2xl border border-oat bg-white p-6">
        <div className="text-xs font-semibold uppercase tracking-wide text-peach">Quick answer</div>
        <div className="mt-2 text-ink/80 leading-relaxed">
          If you want a free Sitebulb alternative specifically for internal linking, Crawlmouse crawls your
          site in the browser, maps its internal-link graph, and grades the structure — with no install and no
          free-trial expiry. Sitebulb is the broader paid technical-audit crawler; Crawlmouse is the focused,
          free internal-linking grader.
        </div>
      </div>

      <p>
        Sitebulb is one of the most respected technical-SEO crawlers around, and for good reason — its visual
        crawl maps and prioritised &ldquo;Hints&rdquo; turn a raw crawl into something you can actually act on.
        But it&rsquo;s a paid tool with no permanent free tier, its main product is a desktop install, and its
        full feature set is aimed at agencies and consultants running deep audits. If what you actually need is
        a clear read on your <Link href={'/blog/crawl-depth-site-architecture' as Route}>internal-link
        structure</Link> — which pages are orphaned, which are buried too deep, where authority pools — that
        can be more tool than the job requires. Here&rsquo;s an honest look at a lighter, free alternative for
        that specific job.
      </p>

      <h2>What Sitebulb is great at (and what it costs)</h2>
      <p>
        Sitebulb crawls your site and applies 300+ checks, then explains each issue in plain language with a
        severity and a fix — genuinely excellent for a full technical audit and for handing findings to
        clients. Its crawl maps render your architecture as a visual graph so you can spot orphaned clusters,
        deep pages, and hub bottlenecks at a glance, and it renders JavaScript using a real Chromium engine.
        The trade-offs: there&rsquo;s a free trial but no lasting free tier, and after it you&rsquo;re on a paid
        plan — roughly $13.50/month for Lite (capped at 10,000 URLs), about $35/month for Pro, and around
        $245/month for the cloud version at the time of writing. For an agency auditing client sites weekly,
        that&rsquo;s easily worth it. For someone who just wants to know whether their internal linking is
        holding pages back, it&rsquo;s a subscription and a download for one answer.
      </p>

      <div className="my-8 overflow-x-auto">
        <table className="w-full text-left text-sm border-collapse">
          <thead>
            <tr className="border-b-2 border-oat">
              <th className="py-3 pr-4"></th>
              <th className="py-3 px-4 font-display font-semibold text-peach">Crawlmouse</th>
              <th className="py-3 pl-4 font-display font-semibold text-ink">Sitebulb</th>
            </tr>
          </thead>
          <tbody className="text-ink/70">
            {[
              ['Price', 'Free', 'No free tier; ~$13.50–$245 / month'],
              ['Install', 'None — runs in the browser', 'Desktop app (+ cloud)'],
              ['Focus', 'Internal linking + structure grade', 'Full technical SEO (300+ Hints)'],
              ['Output', 'A–F grade + prioritised fixes', 'Prioritised Hints + visual crawl maps'],
              ['JavaScript rendering', 'No — reads static HTML (the AI-crawler view)', 'Yes'],
              ['Visual link graph', 'Yes', 'Yes (crawl maps)'],
              ['Best for', 'A fast, free internal-linking read', 'Agency audits, client-ready reports'],
            ].map(([k, a, b]) => (
              <tr key={k} className="border-b border-oat">
                <td className="py-3 pr-4 font-medium text-ink align-top">{k}</td>
                <td className="py-3 px-4 align-top">{a}</td>
                <td className="py-3 pl-4 align-top">{b}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <h2>The lighter alternative: a free browser-based internal-linking grader</h2>
      <p>
        <Link href={{ pathname: '/' }}>Crawlmouse</Link> takes the narrow-but-free approach. You paste a URL
        and it crawls the live site in the browser — nothing to install, no trial clock, no per-seat licence,
        and it works on any device. It maps the internal-link graph and returns a single A&ndash;F grade plus
        the specific problems behind it: orphan pages, pages buried too deep, weak hubs, and thin anchor text.
        Like Sitebulb, it shows you the structure as a graph rather than a wall of rows — but where Sitebulb
        gives you the whole technical toolbox, Crawlmouse gives you the internal-linking verdict, fast and
        free.
      </p>
      <p>
        One real difference worth naming: Sitebulb renders JavaScript, while Crawlmouse reads the{' '}
        <em>static</em> HTML your server returns. That&rsquo;s deliberate — the static read is exactly what a
        non-rendering AI crawler (the bots behind ChatGPT, Claude, and Perplexity) sees, so it surfaces links
        that only appear after JavaScript and would be invisible to those systems. Different lens, both
        honest: Sitebulb shows you the fully-rendered site; Crawlmouse shows you the site a plain crawler sees.
      </p>

      <h2>Where a free grader stops (the honest limits)</h2>
      <p>
        A focused tool is focused. Crawlmouse won&rsquo;t give you Sitebulb&rsquo;s 300 checks, its
        accessibility auditing, its JavaScript rendering, or its client-ready PDF reporting — it isn&rsquo;t a
        replacement for a full technical audit, and it doesn&rsquo;t pretend to be. What it does is audit and
        grade internal-link structure, well and for free. If you need the whole technical picture or polished
        agency deliverables, Sitebulb (or a similar suite) earns its price. If internal linking is the question
        in front of you, the free grader answers it in about two minutes.
      </p>

      <h2>Which should you use?</h2>
      <ul>
        <li>
          <strong>Reach for Sitebulb</strong> when you need deep, all-in-one technical audits, visual reports
          for clients, JavaScript rendering, or accessibility checks — and you&rsquo;re set up for a paid,
          mostly-desktop tool.
        </li>
        <li>
          <strong>Reach for a free browser grader</strong> when you specifically want to{' '}
          <Link href={'/blog/free-internal-link-audit' as Route}>check your internal linking</Link>, you want a
          plain grade and a prioritised fix list rather than a full audit, or you just want the answer now
          without an install or a subscription. It also pairs well with{' '}
          <Link href={'/blog/screaming-frog-alternative' as Route}>the no-install approach to Screaming
          Frog</Link>.
        </li>
      </ul>
      <p>
        They&rsquo;re really different-sized tools for different jobs. A sensible move is to start with the free
        grade to see whether internal linking is even your problem — and bring in a heavier crawler only if the
        audit says you need one.
      </p>

      <div className="my-10 rounded-2xl border border-peach/40 bg-peach/5 p-6 text-center">
        <div className="font-display font-semibold text-xl text-ink">See where your site stands — free</div>
        <div className="mt-1 text-ink/60">Grade your internal linking in under two minutes. No account, no install.</div>
        <Link href={{ pathname: '/' }} className="mt-4 inline-block rounded-full bg-peach px-6 py-3 font-medium text-white transition-colors hover:bg-peach/90">Grade my site</Link>
      </div>

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
