import Link from 'next/link';
import type { Route } from 'next';
import { JsonLd, faqLd } from '../../seo/jsonld';
import type { FaqItem } from '../../seo/faq';

const FAQ: readonly FaqItem[] = [
  {
    question: 'Is there a free alternative to Sitebulb?',
    answer:
      "Two real ones. Crawlmouse is a free, browser-based grader for internal linking and AI-readiness — no install, no trial expiry. Screaming Frog's free version is a full crawler capped at 500 URLs. For a complete free replacement on a small site, use both: Screaming Frog for the technical sweep, Crawlmouse for the structure grade and the AI-crawler view.",
  },
  {
    question: 'Does Sitebulb have a free version?',
    answer:
      'Sitebulb offers a free trial but no permanent free tier. After the trial, pricing at the time of writing (August 2026) is $18/month for Lite (capped at 10,000 URLs), $42/month for Pro, and from $245/month for the cloud version. Pricing can change, so check their site.',
  },
  {
    question: 'What is the closest replacement for Sitebulb?',
    answer:
      "Screaming Frog SEO Spider. It covers the same core job — a deep desktop technical crawl with JavaScript rendering — at £199/year (about $279 at the time of writing). What you give up is Sitebulb's prioritised Hints and reporting polish; what you gain is a lower annual cost and the industry-default tool.",
  },
  {
    question: 'Is Crawlmouse a full replacement for Sitebulb?',
    answer:
      'No, and it is fair to say so. Sitebulb runs 300+ prioritised audit checks, accessibility testing, and JavaScript rendering. Crawlmouse does one job: crawl your site, map the internal-link graph, and grade the structure. Use Sitebulb for a full technical audit; use Crawlmouse for a fast, free internal-linking read.',
  },
  {
    question: 'Do I need to install Sitebulb?',
    answer:
      "Sitebulb's main product is a desktop app you download and run, though it offers a cloud version too. A browser-based alternative like Crawlmouse runs entirely in the browser with nothing to install, on any device.",
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
          If you want a free Sitebulb alternative for internal linking and AI-readiness, Crawlmouse crawls
          your site in the browser, maps the internal-link graph, and grades the structure — no install, no
          trial clock. If you want a full technical crawler, Screaming Frog (£199/year, about $279 at the time of writing, free up to 500 URLs)
          is the closest like-for-like swap. Below: six real alternatives with current pricing, and an honest
          note on when Sitebulb is still the right buy.
        </div>
      </div>

      <p>
        Sitebulb is one of the most respected technical-SEO crawlers around, and it earns the reputation — its
        visual crawl maps and prioritised &ldquo;Hints&rdquo; turn a raw crawl into something you can act on.
        But people go looking for alternatives for consistent reasons: there is no permanent free tier, the
        main product is a desktop install, and pricing now runs $18/month for Lite (capped at 10,000 URLs),
        $42/month for Pro, and from $245/month for the cloud version at the time of writing (August 2026). For
        an agency running weekly client audits, that can be money well spent. If you have one site and one
        question — usually some version of &ldquo;<Link href={'/blog/crawl-depth-site-architecture' as Route}>is
        my structure holding me back?</Link>&rdquo; — it&rsquo;s a subscription and a download for a single
        answer.
      </p>
      <p>
        This is an honest comparison of the six alternatives worth considering, sorted by the job you&rsquo;re
        actually trying to do. We build one of them, and we&rsquo;ll be clear about what ours doesn&rsquo;t do.
      </p>

      <h2>First, name the job</h2>
      <p>
        &ldquo;Sitebulb alternative&rdquo; hides three different needs, and the right pick depends on which one
        is yours:
      </p>
      <ol>
        <li>
          <strong>A full technical audit</strong> — hundreds of checks, JavaScript rendering, client-ready
          reports. You need a heavyweight crawler, and you should expect to pay.
        </li>
        <li>
          <strong>One specific answer</strong> — orphan pages, crawl depth, internal-link structure, what AI
          crawlers can see. A focused free tool answers this faster than a suite.
        </li>
        <li>
          <strong>Continuous monitoring at scale</strong> — scheduled cloud crawls, log-file analysis, big
          sites. That&rsquo;s a cloud platform with cloud pricing.
        </li>
      </ol>

      <div className="my-8 overflow-x-auto">
        <table className="w-full text-left text-sm border-collapse">
          <thead>
            <tr className="border-b-2 border-oat">
              <th className="py-3 pr-4 font-display font-semibold text-ink">Tool</th>
              <th className="py-3 px-4 font-display font-semibold text-ink">Price (Aug 2026)</th>
              <th className="py-3 px-4 font-display font-semibold text-ink">Runs where</th>
              <th className="py-3 pl-4 font-display font-semibold text-ink">Best for</th>
            </tr>
          </thead>
          <tbody className="text-ink/70">
            {[
              ['Crawlmouse', 'Free', 'Browser, nothing to install', 'Internal linking, structure grade, the AI-crawler view'],
              ['Screaming Frog', 'Free to 500 URLs; £199/year (~$279)', 'Desktop (Win/Mac/Linux)', 'The closest full Sitebulb replacement'],
              ['Ahrefs Site Audit', 'From $29/month (Starter, limited)', 'Cloud, part of the Ahrefs suite', 'Audits when you already pay for Ahrefs'],
              ['JetOctopus', 'From €379/month per its G2 listing', 'Cloud', 'Big sites, log-file analysis'],
              ['Oncrawl', 'Quote-based', 'Cloud', 'Enterprise crawling and data science'],
              ['SEOnaut', 'Free, open source (MIT)', 'Self-hosted', 'Developers who want to run their own auditor'],
            ].map(([tool, price, where, best]) => (
              <tr key={tool} className="border-b border-oat">
                <td className={`py-3 pr-4 font-medium align-top ${tool === 'Crawlmouse' ? 'text-peach' : 'text-ink'}`}>{tool}</td>
                <td className="py-3 px-4 align-top">{price}</td>
                <td className="py-3 px-4 align-top">{where}</td>
                <td className="py-3 pl-4 align-top">{best}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <h2>The six alternatives, honestly</h2>

      <h3>1. Crawlmouse — free, browser-based, focused on structure</h3>
      <p>
        Full disclosure: this is our tool. <Link href={{ pathname: '/' }}>Crawlmouse</Link> takes the
        narrow-but-free approach. You paste a URL and it crawls the live site in the browser — nothing to
        install, no trial clock, no per-seat licence. It maps the internal-link graph and returns a single
        A&ndash;F grade plus the specific problems behind it: orphan pages, pages buried too deep, weak hubs,
        thin anchor text.
      </p>
      <p>
        One real difference worth naming: Sitebulb renders JavaScript, while Crawlmouse deliberately reads the
        static HTML your server returns — because that static read is what a non-rendering AI crawler (the bots
        behind ChatGPT, Claude, and Perplexity) sees. It surfaces links that only exist after JavaScript runs
        and would be invisible to those systems. Different lens, both honest: Sitebulb shows you the fully
        rendered site; Crawlmouse shows you the site a plain crawler sees.
      </p>
      <p>
        <strong>What it won&rsquo;t do:</strong> Sitebulb&rsquo;s 300+ checks, accessibility auditing,
        JavaScript rendering, or client-ready PDF reports. It isn&rsquo;t a replacement for a full technical
        audit and doesn&rsquo;t pretend to be. If internal linking or AI-readiness is the question in front of
        you, it answers in about two minutes, free.
      </p>
      <p>
        <strong>Pick it when:</strong> you want the internal-linking or AI-visibility verdict now, without an
        install or a subscription.
      </p>

      <h3>2. Screaming Frog SEO Spider — the closest like-for-like swap</h3>
      <p>
        If you want everything Sitebulb does in spirit — a deep desktop crawler that finds broken links,
        redirect chains, duplicate content, metadata problems, and renders JavaScript — Screaming Frog is the
        industry default and the closest true replacement. The free version crawls up to 500 URLs, which
        genuinely covers many small sites; the paid licence is £199/year (about $279 at the time of writing), which undercuts Sitebulb Pro over a
        year of use.
      </p>
      <p>
        The trade-off is presentation. Screaming Frog gives you power and spreadsheet-like density;
        Sitebulb&rsquo;s whole pitch is turning that density into prioritised, explained Hints. If you know
        what you&rsquo;re looking at, Screaming Frog is arguably the better value. If you want the tool to
        explain the findings, that&rsquo;s the thing you&rsquo;d be giving up. We&rsquo;ve written a fuller
        comparison in <Link href={'/blog/sitebulb-vs-screaming-frog' as Route}>Sitebulb vs Screaming
        Frog</Link> and a no-install take in <Link href={'/blog/screaming-frog-alternative' as Route}>the
        Screaming Frog alternative post</Link>.
      </p>
      <p>
        <strong>Pick it when:</strong> you want a full technical crawler, you&rsquo;re comfortable reading
        crawl data, and £199/year (about $279 at the time of writing) beats a monthly subscription for you.
      </p>

      <h3>3. Ahrefs Site Audit — if you already pay for the suite</h3>
      <p>
        Ahrefs&rsquo; Site Audit is a cloud crawler bundled into a broader SEO suite (backlinks, keywords, rank
        tracking). Starter pricing begins at $29/month with meaningful limits, and the plans most teams
        actually use cost more. As a pure Sitebulb replacement it&rsquo;s rarely the reason to subscribe — but
        if you already pay for Ahrefs, its Site Audit may cover enough of the job that a second crawler is
        redundant.
      </p>
      <p>
        <strong>Pick it when:</strong> you already have (or need) the suite, and a good-enough cloud audit
        beats managing another tool.
      </p>

      <h3>4. JetOctopus — cloud crawling and log files at scale</h3>
      <p>
        JetOctopus is a cloud crawler whose real strength is log-file analysis — seeing what Googlebot actually
        crawls, not just what your site contains. Entry pricing is listed at €379/month on its G2 profile at
        the time of writing, which places it in a different budget category from Sitebulb&rsquo;s desktop
        plans. For big sites where crawl budget is a real problem, that can be justified; for a small
        site&rsquo;s structure question, it&rsquo;s the wrong size of tool. We compare it in more depth in{' '}
        <Link href={'/blog/sitebulb-vs-jetoctopus-vs-oncrawl' as Route}>Sitebulb vs JetOctopus vs
        Oncrawl</Link>.
      </p>
      <p>
        <strong>Pick it when:</strong> you run a large site, you need log-file truth, and the budget matches.
      </p>

      <h3>5. Oncrawl — enterprise crawling with a data-science bent</h3>
      <p>
        Oncrawl pairs cloud crawling with log analysis and lets you cross crawl data with analytics and Search
        Console data. Pricing is quote-based — no public price list — which tells you the intended customer:
        enterprise sites and technical teams, not solo site owners. It&rsquo;s a genuine Sitebulb alternative
        only at the top end of what Sitebulb Cloud does.
      </p>
      <p>
        <strong>Pick it when:</strong> you&rsquo;re enterprise-scale and want crawl data joined to analytics
        data.
      </p>

      <h3>6. SEOnaut — free and open source, if you&rsquo;ll host it yourself</h3>
      <p>
        SEOnaut is an open-source (MIT-licensed) auditing tool that crawls a site and reports issues ordered by
        severity. It&rsquo;s free forever and yours to run — the honest cost is that you host and maintain it
        yourself, and its check depth is closer to &ldquo;solid essentials&rdquo; than Sitebulb&rsquo;s 300
        Hints. For developers who prefer owning their tools, it&rsquo;s a legitimate path most roundups ignore.
      </p>
      <p>
        <strong>Pick it when:</strong> you&rsquo;re technical, you self-host by preference, and
        free-with-effort beats paid-with-polish.
      </p>

      <h2>When Sitebulb is still the right choice</h2>
      <p>
        An honest alternatives post should say this plainly: if you audit client sites regularly, need findings
        explained with severity and a fix, want visual crawl maps for reports, or care about the accessibility
        auditing almost nobody else bundles in — Sitebulb earns its price, and switching would cost you more in
        time than it saves in money. The alternatives above win on price, on focus, or on scale. None of them
        beats Sitebulb at being Sitebulb.
      </p>

      <h2>The short version</h2>
      <ul>
        <li>
          <strong>Full audit, best value:</strong> Screaming Frog (£199/year, about $279 at the time of writing, free under 500 URLs).
        </li>
        <li>
          <strong>One fast, free answer on structure or AI-readiness:</strong> Crawlmouse (browser, no signup).
        </li>
        <li>
          <strong>Already an Ahrefs customer:</strong> use Site Audit before buying anything else.
        </li>
        <li>
          <strong>Big site, log files, budget to match:</strong> JetOctopus or Oncrawl.
        </li>
        <li>
          <strong>Developer who self-hosts:</strong> SEOnaut.
        </li>
        <li>
          <strong>Weekly client audits with polished reports:</strong> stay with Sitebulb.
        </li>
      </ul>
      <p>
        A sensible sequence for most site owners:{' '}
        <Link href={'/blog/free-internal-link-audit' as Route}>run the free grade first</Link> to see whether
        structure is even your problem — and bring in a heavier crawler only if the answer says you need one.
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
