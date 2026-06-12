import Link from 'next/link';
import type { Route } from 'next';

/** Body for /blog/orphan-pages. Rendered inside ArticleLayout's `.article-prose`. */
export function OrphanPagesBody() {
  return (
    <>
      <p>
        An orphan page is a page on your site that no other page links to. It exists, it loads, it may
        even be excellent — but because nothing internally points to it, both visitors and search engines
        struggle to find it. It&rsquo;s the SEO equivalent of writing a great chapter and then never
        binding it into the book.
      </p>
      <p>
        Orphan pages are one of the most common findings in a real internal-link{' '}
        <Link href={'/blog/free-internal-link-audit' as Route}>audit</Link>, and one of the most
        worthwhile to fix, because the page already exists. The hard part — making the thing — is done.
        All that&rsquo;s missing is a link.
      </p>

      <h2>Orphan vs. dead-end vs. noindex</h2>
      <p>
        It&rsquo;s worth being precise, because these get muddled:
      </p>
      <ul>
        <li>
          <strong>Orphan page:</strong> nothing links <em>to</em> it. This is the problem we&rsquo;re
          solving.
        </li>
        <li>
          <strong>Dead-end page:</strong> it has no links <em>out</em>. Less harmful on its own, but it
          traps crawlers and visitors who land there.
        </li>
        <li>
          <strong>Intentionally excluded page:</strong> a <code>noindex</code> page (a thank-you page, a
          checkout step) that you <em>want</em> kept out of search. That&rsquo;s not an orphan problem —
          that&rsquo;s working as designed.
        </li>
      </ul>
      <p>
        The pages that hurt you are the ones you&rsquo;d be glad to have rank, that simply fell off the
        internal map.
      </p>

      <h2>How pages get orphaned</h2>
      <p>
        Almost nobody creates an orphan on purpose. They accumulate quietly, usually from one of these:
      </p>
      <ul>
        <li>
          <strong>It was pulled from navigation but not deleted.</strong> A seasonal landing page, an old
          campaign, a discontinued product removed from its category — the menu link goes, the URL stays.
        </li>
        <li>
          <strong>Site migrations.</strong> When URLs change or a CMS is replaced, internal links are the
          easiest thing to miss. Pages survive the move; the links that pointed to them don&rsquo;t.
        </li>
        <li>
          <strong>CMS and template quirks.</strong> Pages created outside the normal content flow — a
          one-off built in a page builder, an import, a programmatically generated URL — often never get
          wired into any listing or hub.
        </li>
        <li>
          <strong>Pagination and filtering.</strong> Deep paginated archives and filtered URLs can strand
          older content where nothing reasonable links to it anymore.
        </li>
        <li>
          <strong>&ldquo;We&rsquo;ll link it later.&rdquo;</strong> A post goes live to hit a deadline,
          the internal links are a follow-up task, and the follow-up never happens.
        </li>
      </ul>

      <h2>Why orphan pages cost you traffic</h2>
      <p>
        Search engines discover and understand pages primarily by following links. An orphan undercuts
        that on three levels:
      </p>
      <ul>
        <li>
          <strong>Discovery and crawling.</strong> With no internal paths leading to it, a crawler has
          little reason to visit, and little context for how the page relates to the rest of your site.
          On a large site with a limited crawl budget, orphans are exactly what gets skipped.
        </li>
        <li>
          <strong>Authority.</strong> Internal links pass ranking signals between pages. An orphan
          receives none, so even strong content starts from a standing stop.
        </li>
        <li>
          <strong>People.</strong> Users browse by clicking. If nothing links to a page, the only way
          anyone reaches it is a direct link from outside or a search result it probably isn&rsquo;t
          earning. The work you put into the page sits unread.
        </li>
      </ul>

      <h2>The XML sitemap myth</h2>
      <p>
        A common objection: &ldquo;it&rsquo;s not orphaned — it&rsquo;s in my sitemap.&rdquo; An XML
        sitemap helps search engines <em>discover</em> a URL, but it isn&rsquo;t a substitute for internal
        links. The sitemap tells Google the page exists; internal links tell Google the page{' '}
        <em>matters</em>, how it fits into your site, and which other pages vouch for it. Plenty of
        sitemap-listed pages sit unindexed precisely because nothing internal reinforces them. Treat the
        sitemap as a discovery aid, not as your linking strategy.
      </p>

      <h2>How to find your orphan pages</h2>
      <p>
        You can&rsquo;t spot orphans by browsing — by definition, you can&rsquo;t click to them. Finding
        them means comparing two lists: every page that <em>exists</em> on your site against every page
        that something <em>links to</em>. The pages in the first list but not the second are your orphans.
      </p>
      <p>
        Building those two lists by hand is miserable, which is the whole point of crawling.{' '}
        <Link href={{ pathname: '/' }}>Crawlmouse</Link> maps your internal link graph and flags pages
        with no inbound internal links directly, so you get the orphan list without assembling it
        yourself. For an even fuller picture, cross-reference that with the URLs in your analytics or
        Search Console that the crawl never reached — those are strong orphan candidates too.
      </p>

      <h2>How to fix them (and when not to)</h2>
      <p>
        For each orphan, make one decision: <strong>keep it or kill it.</strong>
      </p>
      <p>
        <strong>If the page is worth keeping</strong>, link to it from the place a reader would naturally
        expect to find it — the relevant category, the topic hub, a closely related article, the parent
        product. One or two contextual links from the right pages beat a dozen links shoved into a sitewide
        footer. The link should make sense to a human; the SEO benefit follows from that.
      </p>
      <p>
        <strong>If the page shouldn&rsquo;t exist anymore</strong> — a dead campaign, a thin duplicate, a
        discontinued product with no successor — don&rsquo;t just leave it floating. Redirect it to the
        most relevant live page, or remove it cleanly. An orphan you don&rsquo;t want indexed is still
        crawl budget you don&rsquo;t need to spend.
      </p>
      <p>
        One honest exception: some orphans are deliberate. A paid-ad landing page or a gated
        thank-you page is often intentionally kept out of the internal graph. That&rsquo;s fine — just
        make sure it&rsquo;s a decision, not an accident.
      </p>

      <h2>Make it a habit, not a one-time cleanup</h2>
      <p>
        Orphans regenerate. Every migration, redesign, and busy publishing week creates a few more. The
        teams that stay clean treat &ldquo;does anything link to this?&rdquo; as part of publishing, and
        re-crawl periodically to catch the ones that slip through. Run the crawl, link up the orphans you
        want to keep, and watch pages that earned nothing for months start showing up again.
      </p>
    </>
  );
}
