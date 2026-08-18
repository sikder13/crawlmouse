import Link from 'next/link';
import type { Route } from 'next';
import { JsonLd, faqLd } from '../../seo/jsonld';
import type { FaqItem } from '../../seo/faq';

const FAQ: readonly FaqItem[] = [
  {
    question: 'What is the difference between Screaming Frog and DeepCrawl (Lumar)?',
    answer:
      'They sit at opposite ends of the crawler market. Screaming Frog is a desktop app: \u00A3199/$279 per year, free up to 500 URLs, run on your own machine, single user. Lumar (DeepCrawl rebranded in 2022) is an enterprise cloud platform: quote-based pricing that procurement data places well into five figures annually, continuous monitoring, CI/CD integration, and team workflows. One is a tool you run; the other is a platform your organisation adopts.',
  },
  {
    question: 'Is DeepCrawl still called DeepCrawl?',
    answer:
      'No \u2014 DeepCrawl rebranded to Lumar in September 2022, signalling an expansion beyond SEO crawling into site speed, accessibility, and AI search visibility. Many SEOs still search for and refer to it as DeepCrawl, but the product, website, and contracts are all Lumar now.',
  },
  {
    question: 'How much does Lumar (DeepCrawl) cost?',
    answer:
      'Lumar does not publish pricing \u2014 plans are quoted per organisation based on crawl volume, features, and team size. Third-party procurement data suggests typical contracts commonly land in the five-figure range annually, with entry points reported from a few hundred dollars per month. By contrast, Screaming Frog is a flat \u00A3199/$279 per year. Always confirm current pricing directly with each vendor.',
  },
  {
    question: 'Is Screaming Frog good enough for large websites?',
    answer:
      'Often, yes \u2014 the paid licence has no URL cap, so crawl size is bounded by your machine\u2019s memory and storage, and many SEOs crawl six-figure-URL sites on a well-specced desktop. What Screaming Frog cannot do is what pushes teams to Lumar: continuous scheduled monitoring in the cloud, shared team access to crawl data, and integration into engineering release pipelines.',
  },
  {
    question: 'Do both tools render JavaScript?',
    answer:
      'Yes. Screaming Frog includes Chromium-based JavaScript rendering on the paid licence (the free 500-URL tier crawls raw HTML only). Lumar renders JavaScript as part of its cloud crawls. As always, rendering matters for auditing what Google sees \u2014 most AI crawlers read only the raw HTML either way.',
  },
  {
    question: 'Do I need either tool just to check internal linking?',
    answer:
      'No. Both are full technical-SEO suites. If your question is specifically whether orphan pages, deep pages, or weak internal linking are holding your site back, a free browser-based tool like Crawlmouse maps and grades your internal-link structure with nothing to install \u2014 and no licence or enterprise contract.',
  },
];

/** Body for /blog/screaming-frog-vs-lumar-deepcrawl. Rendered inside ArticleLayout's `.article-prose`. */
export function ScreamingFrogVsLumarDeepcrawlBody() {
  return (
    <>
      <div className="mb-8 rounded-2xl border border-oat bg-white p-6">
        <div className="text-xs font-semibold uppercase tracking-wide text-peach">Quick answer</div>
        <div className="mt-2 text-ink/80 leading-relaxed">
          This is less &ldquo;which is better&rdquo; and more &ldquo;which world are you in.&rdquo;{' '}
          <strong>Screaming Frog</strong> (&pound;199/$279 per year, free to 500 URLs) is the desktop
          standard: fast, granular, run-it-yourself audits, now with a native MCP server for AI assistants.{' '}
          <strong>Lumar</strong> &mdash; the enterprise platform formerly called DeepCrawl &mdash; is
          quote-priced, cloud-based, and built for continuous monitoring, team workflows, and CI/CD
          integration at organisational scale. Solo SEOs and small teams rarely need Lumar; enterprises with
          engineering pipelines rarely stay on desktop alone.
        </div>
      </div>

      <p>
        People still search &ldquo;Screaming Frog vs DeepCrawl&rdquo; years after DeepCrawl stopped being
        called that &mdash; it rebranded to <strong>Lumar</strong> in September 2022 &mdash; and the
        comparison itself has drifted, because the two products have moved in opposite directions. Screaming
        Frog kept sharpening the hands-on desktop audit. Lumar expanded into an enterprise website-health
        platform covering SEO, monitoring, accessibility, and AI search visibility. Comparing them in 2026 is
        really a comparison of two ways of working. Here&rsquo;s the honest version, with facts checked in
        August 2026.
      </p>

      <h2>Screaming Frog vs Lumar at a glance (August 2026)</h2>
      <table className="w-full border-collapse text-sm">
        <thead>
          <tr className="border-b-2 border-oat text-left">
            <th className="py-2 pr-3 font-semibold text-ink">&nbsp;</th>
            <th className="py-2 pr-3 font-semibold text-ink">Screaming Frog</th>
            <th className="py-2 font-semibold text-ink">Lumar (DeepCrawl)</th>
          </tr>
        </thead>
        <tbody className="text-ink/80">
          <tr className="border-b border-oat">
            <td className="py-2 pr-3 font-medium text-ink">What it is</td>
            <td className="py-2 pr-3">Desktop crawler (Windows, macOS, Linux)</td>
            <td className="py-2">Enterprise cloud platform</td>
          </tr>
          <tr className="border-b border-oat">
            <td className="py-2 pr-3 font-medium text-ink">Pricing</td>
            <td className="py-2 pr-3">Free to 500 URLs; &pound;199/$279 per year per user</td>
            <td className="py-2">Quote-based; no public prices (commonly five figures/year per procurement data)</td>
          </tr>
          <tr className="border-b border-oat">
            <td className="py-2 pr-3 font-medium text-ink">Crawl model</td>
            <td className="py-2 pr-3">On-demand, on your machine</td>
            <td className="py-2">Scheduled &amp; continuous, in the cloud</td>
          </tr>
          <tr className="border-b border-oat">
            <td className="py-2 pr-3 font-medium text-ink">Monitoring</td>
            <td className="py-2 pr-3">Scheduling on paid tier; no always-on monitoring</td>
            <td className="py-2">Core feature (incl. Lumar Monitor, from the ContentKing acquisition)</td>
          </tr>
          <tr className="border-b border-oat">
            <td className="py-2 pr-3 font-medium text-ink">JavaScript rendering</td>
            <td className="py-2 pr-3">Yes (Chromium), paid tier only</td>
            <td className="py-2">Yes</td>
          </tr>
          <tr className="border-b border-oat">
            <td className="py-2 pr-3 font-medium text-ink">Team use</td>
            <td className="py-2 pr-3">Single-user desktop; volume licences</td>
            <td className="py-2">Built for teams: shared data, tasks, dashboards</td>
          </tr>
          <tr className="border-b border-oat">
            <td className="py-2 pr-3 font-medium text-ink">Engineering integration</td>
            <td className="py-2 pr-3">CLI &amp; scheduling; native MCP server (v24, May 2026)</td>
            <td className="py-2">CI/CD testing to catch SEO regressions pre-release</td>
          </tr>
          <tr className="border-b border-oat">
            <td className="py-2 pr-3 font-medium text-ink">Best fit</td>
            <td className="py-2 pr-3">Hands-on SEOs, consultants, small teams</td>
            <td className="py-2">Enterprises with large sites &amp; release pipelines</td>
          </tr>
        </tbody>
      </table>
      <p className="mt-4">
        Both vendors change pricing and packaging; confirm on their own sites before committing. Everything
        above was checked against official pages and current third-party sources in August 2026.
      </p>

      <h2>Screaming Frog in 2026: the desktop standard, still evolving</h2>
      <p>
        Screaming Frog&rsquo;s SEO Spider remains the default answer to &ldquo;crawl this site and tell me
        what&rsquo;s broken.&rdquo; It&rsquo;s fast, granular, and cheap for what it does: the free tier
        crawls up to 500 URLs indefinitely, and the paid licence (&pound;199 / $279 per year) removes the URL
        cap &mdash; crawl size is then bounded by your machine, and plenty of practitioners audit
        six-figure-URL sites on a decent desktop. The paid tier adds JavaScript rendering, saved crawls and
        configs, scheduling, custom extraction, and integrations with Search Console, GA4, PageSpeed, and the
        major link indexes. And it hasn&rsquo;t stood still: version 22 added semantic-similarity analysis
        using LLM embeddings, and version 24 (May 2026) shipped a native MCP server, letting AI assistants
        run crawls and query crawl data in natural language. For one person or a small team doing point-in-time
        audits, it&rsquo;s very hard to out-value. (If you&rsquo;re weighing it against other desktop-class
        options, see our <Link href={'/blog/screaming-frog-alternative' as Route}>Screaming Frog
        alternatives</Link> guide.)
      </p>

      <h2>Lumar in 2026: what DeepCrawl became</h2>
      <p>
        Lumar kept DeepCrawl&rsquo;s core &mdash; a powerful cloud crawler for very large sites, with
        JavaScript rendering &mdash; and built an enterprise platform around it. The pieces that define it
        now: <strong>continuous monitoring</strong> (Lumar absorbed ContentKing, the always-on
        change-tracking tool, into Lumar Monitor), <strong>CI/CD integration</strong> that tests releases for
        SEO regressions before they reach production, team workflows with shared dashboards and task
        assignment, and an expanding scope that covers site speed, accessibility, and AI search visibility
        alongside classic technical SEO. Its customer list skews large &mdash; household-name enterprises
        &mdash; and so does its commercial model: no public pricing, quoted contracts, and third-party
        procurement data indicating typical deals well into five figures annually. User reviews consistently
        praise the platform and just as consistently mention the price. That&rsquo;s not a flaw; it&rsquo;s
        positioning. Lumar is bought by organisations, not individuals.
      </p>

      <h2>How to choose</h2>
      <ul>
        <li>
          <strong>Pick Screaming Frog</strong> if you&rsquo;re a hands-on SEO, consultant, or small team
          doing audits on demand, you&rsquo;re comfortable interpreting raw data, and a flat &pound;199/year
          (or the free 500-URL tier) matches your budget. It covers the overwhelming majority of technical-SEO
          work.
        </li>
        <li>
          <strong>Pick Lumar</strong> if you&rsquo;re an enterprise team where multiple people need shared
          crawl data, site changes ship weekly through engineering pipelines, an SEO regression costs real
          revenue, and continuous monitoring plus CI/CD gates justify an enterprise contract.
        </li>
        <li>
          <strong>In between?</strong> Mid-size teams that have outgrown desktop but not into enterprise
          procurement usually land on the mid-market cloud crawlers &mdash; see our comparison of{' '}
          <Link href={'/blog/sitebulb-vs-jetoctopus-vs-oncrawl' as Route}>Sitebulb Cloud, JetOctopus, and
          Oncrawl</Link>, which cover cloud-scale crawling and log analysis at published prices.
        </li>
      </ul>

      <h2>When neither is the right spend</h2>
      <p>
        Both tools audit everything &mdash; hundreds of checks across redirects, metadata, duplicates,
        rendering, and more. Many real questions are narrower. If what&rsquo;s in front of you is
        specifically &ldquo;is my <Link href={'/blog/crawl-depth-site-architecture' as Route}>internal
        linking</Link> holding pages back?&rdquo; &mdash; orphan pages, content buried too deep, weak hubs
        &mdash; you don&rsquo;t need a licence or an enterprise contract to find out.{' '}
        <Link href={{ pathname: '/' }}>Crawlmouse</Link> crawls your live site in the browser, maps the
        internal-link graph, and grades the structure for free, with nothing to install. It does one job, not
        three hundred &mdash; it won&rsquo;t replace either tool for a full audit &mdash; but for the
        internal-linking question it&rsquo;s the fastest way to an answer, and a sensible first step before
        deciding whether you need the bigger machinery at all.
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
