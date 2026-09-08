import Link from 'next/link';
import type { Route } from 'next';
import { JsonLd, faqLd } from '../../seo/jsonld';
import type { FaqItem } from '../../seo/faq';

const FAQ: readonly FaqItem[] = [
  {
    question: 'How much does Screaming Frog cost?',
    answer:
      'The SEO Spider is free for up to 500 URLs per crawl. The paid licence is £199 per year — about $279 USD at the time of writing — per user, which removes the limit and adds JavaScript rendering, custom extraction, scheduling, and API integrations.',
  },
  {
    question: 'Is there a completely free Screaming Frog alternative?',
    answer:
      'Two real ones: Crawlmouse, which is browser-based and free forever for whole-site internal-linking and AI-readiness grades, and SEOnaut, which is open source but self-hosted. Screaming Frog’s own free version is also genuinely useful under 500 URLs.',
  },
  {
    question: "What's the closest direct replacement for Screaming Frog?",
    answer:
      'Sitebulb — another desktop crawler with comparable depth, prioritized explanations instead of raw tables, and visual reports. It costs more per year and has no free tier.',
  },
  {
    question: 'Do any of these check whether AI can read my site?',
    answer:
      'Only Crawlmouse. The desktop and cloud crawlers on this list audit for search engines; none of them grades whether the crawlers behind ChatGPT, Claude, and Perplexity — which don’t run JavaScript — can access and read your content across the whole site.',
  },
];

const ROWS: readonly (readonly [string, string, string, string])[] = [
  ['Crawlmouse', 'Free; Pro $19/mo', 'Browser', 'Internal linking + AI readiness, zero setup'],
  ['Screaming Frog', 'Free ≤500 URLs; £199/yr (~$279)', 'Desktop', 'Deep technical crawls, custom extraction'],
  ['Sitebulb', '~$13.50–35/mo, no free tier', 'Desktop', 'Same depth, friendlier explanations'],
  ['Ahrefs Site Audit', 'Suite from $129/mo', 'Cloud', 'Teams already paying for Ahrefs'],
  ['JetOctopus', 'Volume-based', 'Cloud', 'Big sites, log-file evidence'],
  ['Oncrawl', 'Volume-based', 'Cloud', 'Enterprise, crawl + analytics joins'],
  ['SEOnaut', 'Free, self-hosted', 'Your server', 'Developers who’d rather host than subscribe'],
];

/** Body for /blog/screaming-frog-alternative. Rendered inside ArticleLayout's `.article-prose`. */
export function ScreamingFrogAlternativeBody() {
  return (
    <>
      <p>
        Screaming Frog&rsquo;s SEO Spider is the default answer to &ldquo;how do I crawl my site&rdquo;
        &mdash; and mostly for good reason. But &ldquo;default&rdquo; isn&rsquo;t the same as &ldquo;right for
        you.&rdquo; The free version stops at 500 URLs, the paid licence is £199 a year (about $279 at the time
        of writing), it&rsquo;s desktop software your laptop has to power through, and reading its output is a
        skill in itself.
      </p>
      <p>
        If you&rsquo;re here, one of those is probably the problem. So instead of pretending one tool replaces
        Screaming Frog for everyone, here are six real alternatives matched to the actual jobs people hire a
        crawler for &mdash; and, at the end, the honest cases where you should just pay the £199.
      </p>

      <h2>First, name the job</h2>
      <p>&ldquo;Screaming Frog alternative&rdquo; means different things to different people:</p>
      <ul>
        <li>
          <strong>&ldquo;I want a free check without installing anything&rdquo;</strong> &mdash; you want a
          browser-based auditor.
        </li>
        <li>
          <strong>&ldquo;I want the same depth but friendlier&rdquo;</strong> &mdash; you want another desktop
          crawler with better explanations.
        </li>
        <li>
          <strong>&ldquo;I want cloud crawling my whole team can see&rdquo;</strong> &mdash; you want a cloud
          platform, and a bigger budget.
        </li>
        <li>
          <strong>&ldquo;I want free forever, and I don&rsquo;t mind hosting it&rdquo;</strong> &mdash; you
          want open source.
        </li>
      </ul>
      <p>Match the tool to the job and the choice mostly makes itself.</p>

      <h2>The six alternatives, honestly</h2>

      <h3>1. Crawlmouse &mdash; free, browser-based, focused on structure and AI readiness</h3>
      <p>
        Crawlmouse (that&rsquo;s us, so judge this entry hardest) runs in the browser: paste a URL, get an
        A&ndash;F internal-linking grade and a 0&ndash;100{' '}
        <Link href={'/ai-readiness-checker' as Route}>AI-readiness score</Link> for the whole site, with fixes
        in plain language. Nothing to install, free forever, and the same site gets the same score every time.
      </p>
      <p>
        The honest scope: Crawlmouse is not a 300-check technical crawler. It answers two questions deeply
        &mdash; is your site&rsquo;s link structure helping or burying your pages, and can AI systems actually
        read your content &mdash; instead of forty questions shallowly. That second question is one no desktop
        crawler on this list answers: the crawlers behind ChatGPT, Claude, and Perplexity{' '}
        <Link href={'/blog/can-ai-crawlers-see-javascript' as Route}>don&rsquo;t render JavaScript</Link>, so a
        site can pass every Screaming Frog check and still be invisible to AI. If your problem is orphan pages,
        crawl depth, weak anchors, or AI visibility, this is the fastest route to an answer. If you need
        hreflang validation or custom extraction, it isn&rsquo;t &mdash; read on.
      </p>
      <p>
        <strong>Price:</strong> free; Pro at $19/month for every fix, CSV export, and white-label reports.
      </p>

      <h3>2. Sitebulb &mdash; the closest like-for-like swap</h3>
      <p>
        Sitebulb is the other serious desktop crawler, and its edge over Screaming Frog is explanation: instead
        of raw data tables, it produces prioritized &ldquo;Hints&rdquo; that tell you what each issue is, why
        it matters, and how urgent it is &mdash; plus visual crawl maps clients actually understand. If
        Screaming Frog&rsquo;s learning curve is what&rsquo;s driving you away, Sitebulb is the natural landing
        spot.
      </p>
      <p>
        The trade: there&rsquo;s no free tier at all &mdash; a 14-day trial, then Lite at roughly $13.50/month
        billed annually (about $18 month-to-month) or Pro at about $35/month, at the time of writing. Over a
        year, Pro costs more than a Screaming Frog licence. You&rsquo;re paying for the interpretation layer.
        We&rsquo;ve compared the two in more depth in our{' '}
        <Link href={'/blog/sitebulb-alternative' as Route}>Sitebulb alternatives roundup</Link>.
      </p>

      <h3>3. Ahrefs Site Audit &mdash; if you already pay for the suite</h3>
      <p>
        Ahrefs bundles a competent cloud crawler into its SEO suite (from $129/month at the time of writing).
        Nobody should buy Ahrefs <em>for</em> the crawler &mdash; but if your team already pays for it for
        backlinks and keywords, you may already own a Screaming Frog replacement and not know it. Cloud-based,
        scheduled, shareable, no laptop churning overnight.
      </p>

      <h3>4. JetOctopus &mdash; cloud crawling plus log files</h3>
      <p>
        JetOctopus is a cloud crawler whose real differentiator is log-file analysis: seeing what Googlebot{' '}
        <em>actually did</em> on your site, not just what a simulated crawl predicts. For large sites where
        crawl budget is a genuine concern, that evidence is worth real money. Pricing scales with crawl volume
        &mdash; sensible for big sites, overkill for a 200-page business site.
      </p>

      <h3>5. Oncrawl &mdash; enterprise crawling with a data-science bent</h3>
      <p>
        Oncrawl pairs crawling with log analysis and BI-style dashboards, aimed squarely at enterprise SEO
        teams who want to join crawl data to analytics data. It&rsquo;s the &ldquo;we have a data analyst on
        the SEO team&rdquo; option. Like JetOctopus, pricing is volume-based; if you have to ask whether you
        need it, you probably don&rsquo;t yet.
      </p>

      <h3>6. SEOnaut &mdash; free and open source, if you&rsquo;ll host it yourself</h3>
      <p>
        SEOnaut is an open-source technical crawler you run on your own machine or server. Genuinely free, no
        URL caps, and you can read the code. The cost is your time: installation, updates, and a sparser
        interface than any commercial tool. Right for developers who&rsquo;d rather self-host than subscribe;
        wrong for anyone who just wants an answer this afternoon.
      </p>

      <h2>The comparison at a glance</h2>
      <div className="my-8 overflow-x-auto">
        <table className="w-full text-left text-sm border-collapse">
          <thead>
            <tr className="border-b-2 border-oat">
              <th className="py-3 pr-4 font-display font-semibold text-ink">Tool</th>
              <th className="py-3 px-4 font-display font-semibold text-ink">Price (at the time of writing)</th>
              <th className="py-3 px-4 font-display font-semibold text-ink">Runs</th>
              <th className="py-3 pl-4 font-display font-semibold text-ink">Best for</th>
            </tr>
          </thead>
          <tbody className="text-ink/70">
            {ROWS.map(([tool, price, runs, best]) => (
              <tr key={tool} className="border-b border-oat">
                <td className={`py-3 pr-4 font-medium align-top ${tool === 'Crawlmouse' ? 'text-peach' : 'text-ink'}`}>{tool}</td>
                <td className="py-3 px-4 align-top">{price}</td>
                <td className="py-3 px-4 align-top">{runs}</td>
                <td className="py-3 pl-4 align-top">{best}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <h2>When Screaming Frog is still the right choice</h2>
      <p>
        Honesty cuts both ways, so: if you crawl large sites regularly, need custom extraction
        (XPath/CSS/regex), want scheduled crawls with Search Console and analytics joined in, and you&rsquo;re
        comfortable reading crawl data &mdash; £199 a year is genuinely cheap for what the SEO Spider does. It
        remains the deepest desktop crawler available, and the 500-URL free version is a perfectly good scanner
        for small sites. The reasons to leave are the learning curve, the desktop-only workflow, or the fact
        that none of its 300+ checks tells you whether AI can read your site. If none of those bite you, keep
        it.
      </p>

      <h2>The short version</h2>
      <p>
        Free and instant, for structure and AI visibility: run a{' '}
        <Link href={{ pathname: '/' }}>free Crawlmouse audit</Link>. Same depth as Screaming Frog with better
        explanations: Sitebulb. Already on Ahrefs: use the crawler you&rsquo;re paying for. Big site,
        crawl-budget questions: JetOctopus or Oncrawl. Self-hosting developer: SEOnaut. Power user who lives in
        crawl data: stay with Screaming Frog and don&rsquo;t look back.
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

      <p className="mt-10 text-sm text-ink/60">
        <em>
          Competitor prices verified September 7, 2026 against sources dated July&ndash;September 2026 and
          stated &ldquo;at the time of writing&rdquo;; check each vendor&rsquo;s pricing page for the current
          figure.
        </em>
      </p>

      <JsonLd data={faqLd(FAQ)} />
    </>
  );
}
