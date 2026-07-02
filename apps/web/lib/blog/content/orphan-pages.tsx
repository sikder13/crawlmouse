import Link from 'next/link';
import type { Route } from 'next';
import { JsonLd, faqLd } from '../../seo/jsonld';
import type { FaqItem } from '../../seo/faq';

const FAQ: readonly FaqItem[] = [
  {
    question: 'What is an orphan page?',
    answer:
      'An orphan page is a page on your site that no other page links to. It loads fine at its URL, but because nothing internal points to it, crawlers rarely discover it and visitors can only reach it by typing the address directly.',
  },
  {
    question: 'How do I find orphan pages for free?',
    answer:
      'Crawl your live site with a free browser tool like Crawlmouse — it maps your internal links and lists every page with none pointing to it, and treats a page found only in your sitemap as an orphan too. For orphans that exist only in analytics or server logs, cross-reference with Google Search Console.',
  },
  {
    question: 'Can I find orphan pages without Screaming Frog or Semrush?',
    answer:
      'Yes. Screaming Frog is a desktop install capped at 500 URLs on its free plan, and Semrush is a paid subscription. A browser-based grader like Crawlmouse finds crawl-and-sitemap orphans for free with nothing to install, which is enough for most small and mid-sized sites.',
  },
  {
    question: 'Do orphan pages actually hurt SEO?',
    answer:
      'A handful is normal and rarely a problem. At scale they waste crawl budget, receive no internal link authority, and often go unindexed — so pages you would be glad to have found never get discovered. The orphans worth fixing are the ones you want in search.',
  },
  {
    question: 'How do I find orphan pages in WordPress?',
    answer:
      'You can use an SEO plugin like Rank Math or Yoast that flags posts with no internal links, or crawl the live site with a no-install tool that works regardless of theme, builder, or plugin. See the WordPress-specific guide for the full walkthrough.',
  },
  {
    question: 'How often should I check for orphan pages?',
    answer:
      'Re-crawl after any migration, redesign, or busy publishing stretch, since those are when orphans appear. For a small site a quarterly check is enough; larger or fast-publishing sites benefit from a monthly pass.',
  },
];

/** Body for /blog/orphan-pages. Rendered inside ArticleLayout's `.article-prose`. */
export function OrphanPagesBody() {
  return (
    <>
      <div className="mb-8 rounded-2xl border border-oat bg-white p-6">
        <div className="text-xs font-semibold uppercase tracking-wide text-peach">Quick answer</div>
        <div className="mt-2 text-ink/80 leading-relaxed">
          To find orphan pages, compare every page that exists on your site against every page something
          links to — the gap is your orphan list. The fastest free way is to crawl your site with a browser
          tool like Crawlmouse, which maps your internal links and flags every page with zero inbound links
          automatically — no install, license, or plugin required.
        </div>
      </div>

      <p>
        You publish a page that deserves to be found — and nothing happens. No rankings, barely any crawls,
        as if it doesn&rsquo;t exist. Often the reason isn&rsquo;t the content at all: it&rsquo;s that no
        other page on your site links to it. That&rsquo;s an <strong>orphan page</strong>, and it&rsquo;s
        the SEO equivalent of writing a great chapter and never binding it into the book. The good news is
        that orphans are among the cheapest problems to fix — the page already exists; all that&rsquo;s
        missing is a link — once you can actually find them.
      </p>

      <h2>What counts as an orphan page (and what doesn&rsquo;t)</h2>
      <p>These get muddled, and the distinctions matter:</p>
      <ul>
        <li>
          <strong>Orphan page:</strong> nothing links <em>to</em> it. This is the problem we&rsquo;re
          solving.
        </li>
        <li>
          <strong>Dead-end page:</strong> it has no links <em>out</em>. Less harmful on its own, but it
          traps crawlers and readers who land there.
        </li>
        <li>
          <strong>Intentionally excluded page:</strong> a <code>noindex</code> page — a thank-you page, a
          checkout step, a paid-ad landing page — that you <em>want</em> kept out of the internal map.
          That&rsquo;s working as designed, not an orphan problem.
        </li>
      </ul>
      <p>
        The ones that cost you are the pages you&rsquo;d be glad to have rank, that simply fell off the
        internal map. An orphan is really the extreme case of{' '}
        <Link href={'/blog/crawl-depth-site-architecture' as Route}>crawl depth</Link> — a page at infinite
        depth, with no click-path from the homepage at all.
      </p>

      <h2>How do pages get orphaned?</h2>
      <p>Almost nobody creates an orphan on purpose. They accumulate quietly:</p>
      <ul>
        <li>
          <strong>Pulled from navigation but not deleted.</strong> A seasonal landing page, an old
          campaign, a discontinued product removed from its category — the menu link goes, the URL stays.
        </li>
        <li>
          <strong>Site migrations.</strong> When URLs change or a CMS is replaced, internal links are the
          easiest thing to miss. Pages survive the move; the links pointing to them don&rsquo;t.
        </li>
        <li>
          <strong>CMS and template quirks.</strong> A one-off built in a page builder, an import, a
          programmatically generated URL — pages created outside the normal content flow often never get
          wired into any listing or hub.
        </li>
        <li>
          <strong>Pagination and filtering.</strong> Deep paginated archives and filtered URLs strand
          older content where nothing reasonable links to it anymore.
        </li>
        <li>
          <strong>&ldquo;We&rsquo;ll link it later.&rdquo;</strong> A post ships to hit a deadline, the
          internal links are a follow-up task, and the follow-up never happens.
        </li>
      </ul>

      <h2>Do orphan pages actually hurt your SEO?</h2>
      <p>
        A handful of orphans is normal and rarely a crisis. The damage shows up at scale, on three levels:
      </p>
      <ul>
        <li>
          <strong>Discovery and crawling.</strong> Search engines find pages mainly by following links.
          With no internal path leading to it, a crawler has little reason to visit and little context for
          how the page fits. On a large site with a limited crawl budget, orphans are exactly what gets
          skipped.
        </li>
        <li>
          <strong>Authority.</strong> Internal links pass ranking signals between pages. An orphan receives
          none, so even strong content starts from a standing stop.
        </li>
        <li>
          <strong>People.</strong> Users browse by clicking. If nothing links to a page, the only way
          anyone reaches it is a direct URL or a search result it probably isn&rsquo;t earning. The work
          sits unread.
        </li>
      </ul>
      <p>
        A quick myth to retire: &ldquo;it&rsquo;s in my sitemap, so it&rsquo;s not orphaned.&rdquo; An XML
        sitemap helps a search engine <em>discover</em> a URL, but it isn&rsquo;t a substitute for internal
        links. The sitemap says the page exists; internal links say it <em>matters</em>, how it fits, and
        which pages vouch for it. Plenty of sitemap-listed pages sit unindexed for exactly this reason.
      </p>

      <h2>How to find orphan pages (the free way and the tool way)</h2>
      <p>
        You can&rsquo;t spot orphans by browsing — by definition, you can&rsquo;t click to them. Finding
        them means comparing two lists: every page that <em>exists</em> on your site against every page
        something <em>links to</em>. The pages in the first list but not the second are your orphans.
        Here&rsquo;s how each method builds those lists:
      </p>
      <ul>
        <li>
          <strong>A free browser crawl (fastest first pass).</strong>{' '}
          <Link href={{ pathname: '/' }}>Crawlmouse</Link> crawls your live site the way a search engine
          would, maps the internal link graph, and flags every page with zero inbound internal links —
          including pages it only found in your sitemap. No install, no license, no plugin. Because it reads
          the <em>static</em> HTML your server returns, it also catches pages whose only links appear after
          JavaScript runs — the same pages a non-rendering AI crawler (GPTBot, ClaudeBot, PerplexityBot)
          can&rsquo;t reach either.
        </li>
        <li>
          <strong>Google Search Console (free, manual).</strong> Look for pages that are indexed but have
          no referring internal links, and compare your sitemap against what a crawl actually reaches. This
          is the one way to surface orphans that exist <em>only</em> in Google&rsquo;s data — pages nothing
          links to <em>and</em> that aren&rsquo;t in your sitemap.
        </li>
        <li>
          <strong>Screaming Frog (desktop install).</strong> Its Crawl Analysis &rarr; Orphan Pages report
          compares the crawl against your XML sitemap, Google Analytics, and Search Console. Thorough, but
          it&rsquo;s a desktop app, the free version stops at 500 URLs, and the full orphan report needs a
          paid licence.
        </li>
        <li>
          <strong>Semrush (paid subscription).</strong> Site Audit &rarr; Issues &rarr; &ldquo;Orphaned
          pages&rdquo; surfaces sitemap and Analytics URLs with no inbound internal links, once you connect
          your Analytics account.
        </li>
        <li>
          <strong>WordPress plugins.</strong> Rank Math (free) shows an orphan indicator in the SEO Details
          column of your Posts/Pages list; Yoast Premium has an orphaned-content filter. Handy if
          you&rsquo;re already in WordPress — see the{' '}
          <Link href={'/blog/find-orphan-pages-wordpress' as Route}>WordPress-specific guide</Link> for the
          full walkthrough.
        </li>
      </ul>
      <p>
        For most small and mid-sized sites, the free crawl catches the vast majority of orphans in under two
        minutes. If you run a large site or want belt-and-braces completeness, pair the crawl with your
        Search Console data to catch the analytics-only stragglers. The same two-list comparison also powers
        a full{' '}
        <Link href={'/blog/free-internal-link-audit' as Route}>internal-link audit</Link>, of which orphans
        are just one finding.
      </p>

      <h2>How to fix orphan pages (and when not to)</h2>
      <p>
        For each orphan, make one decision: <strong>keep it or kill it.</strong>
      </p>
      <p>
        <strong>If the page is worth keeping</strong>, link to it from where a reader would naturally expect
        to find it — the relevant category, the topic hub, a closely related article, the parent product —
        using descriptive anchor text, not &ldquo;click here.&rdquo; One or two contextual links from the
        right pages beat a dozen shoved into a sitewide footer. Make the link make sense to a human; the
        crawlability benefit follows.
      </p>
      <p>
        <strong>If the page shouldn&rsquo;t exist anymore</strong> — a dead campaign, a thin duplicate, a
        discontinued product with no successor — don&rsquo;t leave it floating. Redirect it to the most
        relevant live page, or remove it cleanly, then update your sitemap. An orphan you don&rsquo;t want
        indexed is still crawl budget you don&rsquo;t need to spend.
      </p>
      <p>
        One honest exception: some orphans are deliberate. A paid-ad landing page or a gated thank-you page
        is often intentionally kept out of the internal graph. That&rsquo;s fine — just make sure
        it&rsquo;s a decision, not an accident.
      </p>

      <h2>How to stop orphan pages coming back</h2>
      <p>
        Orphans regenerate. Every migration, redesign, and busy publishing week creates a few more. The
        teams that stay clean bake &ldquo;does anything link to this?&rdquo; into publishing — a simple rule
        of thumb is to link every new page from two or three existing, relevant pages before it goes live —
        and re-crawl periodically to catch the ones that slip through. Run the crawl, link up the orphans
        worth keeping, re-crawl to confirm, and watch pages that earned nothing for months become findable
        again.
      </p>
      <p>
        If a page you care about is buried with no path to it, the hard part is already done. All
        that&rsquo;s missing is a link — and that&rsquo;s a fix you can ship today.
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
