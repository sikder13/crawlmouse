import Link from 'next/link';
import type { Route } from 'next';
import { JsonLd, faqLd } from '../../seo/jsonld';
import type { FaqItem } from '../../seo/faq';

const FAQ: readonly FaqItem[] = [
  {
    question: 'What is the difference between Sitebulb and JetOctopus?',
    answer:
      'Sitebulb Cloud is a guided auditing platform: prioritised plain-language Hints, visual crawl maps, and client-ready reports, from \u00A395/month with JavaScript crawling included. JetOctopus is a speed-and-data platform: crawls up to 250 pages per second, pairs crawl data with server-log analysis, and prices by volume (an advertised 1M-page configuration runs about $383/month billed annually). Sitebulb interprets for you; JetOctopus hands you merged datasets.',
  },
  {
    question: 'Which is better, JetOctopus or Oncrawl?',
    answer:
      'They overlap heavily \u2014 both are cloud crawlers with server-log analysis at the core. JetOctopus publishes transparent volume-based pricing, is praised for speed and ease of setup, and suits teams that want self-serve. Oncrawl is quote-based, leans enterprise (it markets data-science depth, BI integrations, and 500M+ log lines a day), and suits organisations that want a data platform with onboarding. For most small and mid-size teams, JetOctopus is the easier starting point; test both on a trial.',
  },
  {
    question: 'Is JetOctopus cheaper than Oncrawl?',
    answer:
      'Usually, at comparable volumes \u2014 but the honest answer is that Oncrawl no longer publishes flat pricing, so it depends on your quote. JetOctopus shows its prices publicly and scales by crawl pages and log lines. Oncrawl is quote-based; procurement data suggests typical contracts land far above entry-level tool budgets. If price transparency matters to you, that difference itself is a signal.',
  },
  {
    question: 'Do cloud crawlers render JavaScript?',
    answer:
      'All three can, with different cost models. Sitebulb Cloud includes Chromium-based JavaScript crawling at no extra cost. JetOctopus supports JS crawling but counts one JS page as two HTML pages, effectively doubling the per-page cost. Oncrawl offers JavaScript crawling on its plans. Note that rendering is for auditing what Google sees \u2014 most AI crawlers read only raw HTML regardless.',
  },
  {
    question: 'Do I need a cloud crawler for a small site?',
    answer:
      'Usually not. Cloud crawlers earn their price on large sites (hundreds of thousands to millions of URLs) and on server-log analysis. For a site under ~10,000 pages, a desktop tool like Screaming Frog (free up to 500 URLs) or Sitebulb\u2019s desktop app covers a full audit \u2014 and if your question is specifically internal linking, a free browser tool like Crawlmouse answers it with nothing to install.',
  },
  {
    question: 'What is server-log analysis and why does it matter?',
    answer:
      'Your server logs record every real visit from search bots \u2014 which pages Googlebot actually crawls, how often, and what it skips. Crawlers simulate a bot; logs show the real one. On large sites this reveals crawl-budget waste and never-crawled sections that no simulated crawl can prove. It\u2019s the core feature that separates JetOctopus and Oncrawl from desktop crawlers.',
  },
];

/** Body for /blog/sitebulb-vs-jetoctopus-vs-oncrawl. Rendered inside ArticleLayout's `.article-prose`. */
export function SitebulbVsJetoctopusVsOncrawlBody() {
  return (
    <>
      <div className="mb-8 rounded-2xl border border-oat bg-white p-6">
        <div className="text-xs font-semibold uppercase tracking-wide text-peach">Quick answer</div>
        <div className="mt-2 text-ink/80 leading-relaxed">
          Three cloud crawlers, three shapes. <strong>Sitebulb Cloud</strong> (from &pound;95/mo) is the
          guided one: prioritised Hints, visual maps, client reports, JavaScript crawling included.{' '}
          <strong>JetOctopus</strong> (volume-priced; an advertised 1M-page package is ~$383/mo annually) is
          the fast, transparent, self-serve one, with server-log analysis built in. <strong>Oncrawl</strong>{' '}
          (quote-based) is the enterprise data platform: logs at massive scale, segmentation, BI
          integrations. Pick by site size and whether you need log analysis &mdash; and for a small site or a
          pure internal-linking question, you may not need any of them.
        </div>
      </div>

      <p>
        Desktop crawlers get compared constantly &mdash; we&rsquo;ve done{' '}
        <Link href={'/blog/sitebulb-vs-screaming-frog' as Route}>Sitebulb vs Screaming Frog</Link> ourselves.
        But once your site outgrows a desktop app, or you need to know what Googlebot <em>actually</em> does
        rather than what a simulated crawl predicts, you end up comparing the cloud platforms: Sitebulb
        Cloud, JetOctopus, and Oncrawl. There&rsquo;s surprisingly little independent writing on this
        matchup &mdash; mostly auto-generated compare pages and the vendors reviewing each other &mdash; so
        here&rsquo;s an honest comparison with facts checked in July 2026, and a clear note on when none of
        the three is the right spend.
      </p>

      <h2>The three at a glance (verified July 2026)</h2>
      <table className="w-full border-collapse text-sm">
        <thead>
          <tr className="border-b-2 border-oat text-left">
            <th className="py-2 pr-3 font-semibold text-ink">&nbsp;</th>
            <th className="py-2 pr-3 font-semibold text-ink">Sitebulb Cloud</th>
            <th className="py-2 pr-3 font-semibold text-ink">JetOctopus</th>
            <th className="py-2 font-semibold text-ink">Oncrawl</th>
          </tr>
        </thead>
        <tbody className="text-ink/80">
          <tr className="border-b border-oat">
            <td className="py-2 pr-3 font-medium text-ink">Pricing model</td>
            <td className="py-2 pr-3">Published; from &pound;95/mo</td>
            <td className="py-2 pr-3">Published; scales by volume (~$383/mo for the advertised 1M-page annual package)</td>
            <td className="py-2">Quote-based; no public prices</td>
          </tr>
          <tr className="border-b border-oat">
            <td className="py-2 pr-3 font-medium text-ink">Server-log analysis</td>
            <td className="py-2 pr-3">Not the focus</td>
            <td className="py-2 pr-3">Core feature; bills only validated Googlebot/Bing lines</td>
            <td className="py-2">Core feature; markets 500M+ log lines/day</td>
          </tr>
          <tr className="border-b border-oat">
            <td className="py-2 pr-3 font-medium text-ink">JavaScript crawling</td>
            <td className="py-2 pr-3">Included, evergreen Chromium</td>
            <td className="py-2 pr-3">Supported; 1 JS page counts as 2 HTML pages</td>
            <td className="py-2">Supported on plans</td>
          </tr>
          <tr className="border-b border-oat">
            <td className="py-2 pr-3 font-medium text-ink">Crawl speed / scale</td>
            <td className="py-2 pr-3">Millions of URLs; recurring crawls</td>
            <td className="py-2 pr-3">Up to 250 pages/sec; no project or user limits</td>
            <td className="py-2">Built for very large, complex sites</td>
          </tr>
          <tr className="border-b border-oat">
            <td className="py-2 pr-3 font-medium text-ink">Reporting style</td>
            <td className="py-2 pr-3">Prioritised Hints, visual maps, client PDFs</td>
            <td className="py-2 pr-3">Dashboards, merged crawl+logs+GSC+GA datasets</td>
            <td className="py-2">Data-science: segmentation, BI, custom dashboards</td>
          </tr>
          <tr className="border-b border-oat">
            <td className="py-2 pr-3 font-medium text-ink">Trial</td>
            <td className="py-2 pr-3">14 days, no card</td>
            <td className="py-2 pr-3">7 days, no card (10k-URL crawl, export caps)</td>
            <td className="py-2">Trial available</td>
          </tr>
          <tr className="border-b border-oat">
            <td className="py-2 pr-3 font-medium text-ink">Best fit</td>
            <td className="py-2 pr-3">Agencies &amp; teams wanting guided audits</td>
            <td className="py-2 pr-3">Hands-on SEOs on large sites, self-serve</td>
            <td className="py-2">Enterprise teams with data/BI workflows</td>
          </tr>
        </tbody>
      </table>
      <p className="mt-4">
        All three vendors change pricing and packaging over time &mdash; confirm on their own sites before
        committing. Everything above was checked against official pricing pages and current third-party data
        in July 2026.
      </p>

      <h2>Sitebulb Cloud: the guided one</h2>
      <p>
        Sitebulb built its reputation on the desktop app&rsquo;s prioritised &ldquo;Hints&rdquo; &mdash; each
        issue explained in plain language with a severity and a recommended fix &mdash; and Sitebulb Cloud
        (from &pound;95/month) moves that experience into the browser: no project limits, automated recurring
        crawls, shared crawl data for teams, and JavaScript crawling with evergreen Chromium at no extra
        cost. Crawls scale into the millions of URLs. The pitch is interpretation: where the other two hand
        you datasets, Sitebulb tells you what&rsquo;s wrong, how much it matters, and produces a report you
        can put in front of a client the same day. What it doesn&rsquo;t centre is server-log analysis
        &mdash; if logs are the reason you&rsquo;re going cloud, the other two are built around them.
      </p>

      <h2>JetOctopus: the fast, transparent one</h2>
      <p>
        JetOctopus is a cloud crawler and log analyzer with an unusually self-serve posture for this
        category: prices on the pricing page, configurable by volume, no project, user, simultaneous-crawl,
        or export limits. It advertises crawling at up to 250 pages per second, and its log analyzer bills
        only validated Googlebot and Bingbot lines while analysing 40+ bots &mdash; so you can overlay what
        your crawl <em>predicts</em> with what search bots <em>actually do</em>, plus 16 months of Search
        Console data and a Google Analytics module in the same interface. The advertised 1-million-page
        configuration (with 1M log lines, one GSC and one GA property) runs about $383/month billed annually;
        smaller and larger packages scale from there. Two costs to note honestly: JavaScript crawling counts
        one JS page as two HTML pages, effectively doubling per-page cost on JS-heavy sites, and the 7-day
        trial caps crawls at 10,000 URLs with limited exports &mdash; enough to evaluate, not to audit.
      </p>

      <h2>Oncrawl: the enterprise data platform</h2>
      <p>
        Oncrawl sits furthest up-market. It combines a crawler and a log analyzer with a data-science
        framing: dynamic segmentation, machine-learning-driven analysis, BI and API integrations, and log
        processing it markets at over 500 million lines per day. Customers it cites include Rakuten and
        Forbes, which tells you the intended buyer. The trade-off is opacity: Oncrawl no longer publishes
        flat pricing &mdash; plans are quote-based, and third-party procurement data indicates typical
        contracts land well into four or five figures annually depending on volume. That&rsquo;s not a
        criticism so much as a category marker: Oncrawl is bought like enterprise software, with a sales
        conversation, onboarding, and a data team ready to use it. If that sentence describes your
        organisation, it belongs on your shortlist; if it doesn&rsquo;t, you&rsquo;ll likely be happier with
        one of the other two.
      </p>

      <h2>How to choose between them</h2>
      <ul>
        <li>
          <strong>Pick Sitebulb Cloud</strong> if you want the platform to interpret findings for you,
          produce client-ready reports, and include JavaScript crawling without surcharges &mdash; and log
          analysis isn&rsquo;t your driving need. The natural home for agencies.
        </li>
        <li>
          <strong>Pick JetOctopus</strong> if you want speed, transparent self-serve pricing, and
          crawl-plus-logs analysis on a large site without an enterprise procurement cycle. The natural home
          for hands-on technical SEOs.
        </li>
        <li>
          <strong>Pick Oncrawl</strong> if you&rsquo;re an enterprise team that will feed crawl and log data
          into BI dashboards and custom analysis, and a quoted contract is normal for how you buy software.
        </li>
      </ul>
      <p>
        And if you&rsquo;re choosing between cloud and desktop in the first place: the fork is site size and
        logs. Under a few hundred thousand URLs with no log-analysis need, a desktop tool is dramatically
        cheaper &mdash; see our{' '}
        <Link href={'/blog/sitebulb-vs-screaming-frog' as Route}>Sitebulb vs Screaming Frog</Link>{' '}
        comparison for that decision.
      </p>

      <h2>When none of the three is the right spend</h2>
      <p>
        All three are serious platforms priced for serious scope. Plenty of real situations need less. If
        your site is small, a desktop crawler &mdash; or Screaming Frog&rsquo;s free 500-URL tier &mdash;
        covers a full technical audit. And if the question in front of you is specifically &ldquo;is my{' '}
        <Link href={'/blog/crawl-depth-site-architecture' as Route}>internal linking</Link> holding pages
        back?&rdquo; &mdash; the orphans, the pages buried too deep, the weak hubs &mdash; you don&rsquo;t
        need a cloud subscription to find out. <Link href={{ pathname: '/' }}>Crawlmouse</Link> crawls your
        live site in the browser, maps the internal-link graph, and grades the structure for free, with
        nothing to install. It does one job, not three hundred &mdash; it won&rsquo;t replace any of these
        platforms for a full audit or log analysis &mdash; but for the internal-linking question it&rsquo;s
        the fastest way to an answer. Because it reads raw server HTML without executing JavaScript, it also
        shows the version of your site that{' '}
        <Link href={'/blog/can-ai-crawlers-see-javascript' as Route}>non-rendering AI crawlers actually
        see</Link>.
      </p>
      <p>
        The practical move: run the free grade first. If internal linking is the problem, you&rsquo;ve
        answered it for nothing. If the audit points somewhere broader &mdash; crawl budget, logs, rendering
        at scale &mdash; you now know which of the three platforms above fits, and you&rsquo;ll walk into
        the trial knowing what to test.
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
