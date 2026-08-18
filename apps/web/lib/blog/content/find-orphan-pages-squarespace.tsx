import Link from 'next/link';
import type { Route } from 'next';
import { JsonLd, faqLd } from '../../seo/jsonld';
import type { FaqItem } from '../../seo/faq';

const FAQ: readonly FaqItem[] = [
  {
    question: 'Why does Squarespace create orphan pages?',
    answer:
      'Mostly because of the Not Linked section. Any page you drag there stays fully public and indexable but disappears from your navigation \u2014 and unless you manually link to it from somewhere, it has zero internal links. Add nav redesigns, retired campaign pages, and blog posts whose blog page was removed from the menu, and most Squarespace sites accumulate orphans without anyone deciding to create them.',
  },
  {
    question: 'Are Not Linked pages in Squarespace bad for SEO?',
    answer:
      'The section itself is a legitimate feature \u2014 landing pages, thank-you pages, and drafts belong there. The problem is pages you actually want found sitting there with no internal links: search engines can still index them, but with nothing linking to them they are crawled less, ranked weaker, and invisible to visitors browsing your site. Not Linked should be a deliberate choice, not a forgotten default.',
  },
  {
    question: 'How do I find orphan pages on my Squarespace site for free?',
    answer:
      'Crawl your live site with a free browser tool like Crawlmouse \u2014 it maps every internal link it finds and lists the pages nothing links to, with nothing to install. Then compare that against your Pages panel and sitemap.xml: anything enabled in Not Linked that does not appear in the crawl, and that you want people to find, is an orphan to fix.',
  },
  {
    question: 'Does Squarespace include Not Linked pages in the sitemap?',
    answer:
      'Enabled, non-hidden Not Linked pages are public, indexable, and generally included in the sitemap Squarespace generates automatically. That combination \u2014 in the sitemap but linked from nowhere \u2014 is exactly the pattern that shows up in Google Search Console as pages discovered but rarely crawled or indexed.',
  },
  {
    question: 'How do I fix an orphaned Squarespace page?',
    answer:
      'If the page matters, link to it: drag it into a navigation section, or better, add contextual text links to it from related pages and blog posts. If it should stay out of the nav (a campaign page, for instance), give it at least one or two in-body links from relevant pages. If it is genuinely retired, disable it or set a 301 redirect to the closest live page.',
  },
];

/** Body for /blog/find-orphan-pages-squarespace. Rendered inside ArticleLayout's `.article-prose`. */
export function FindOrphanPagesSquarespaceBody() {
  return (
    <>
      <div className="mb-8 rounded-2xl border border-oat bg-white p-6">
        <div className="text-xs font-semibold uppercase tracking-wide text-peach">Quick answer</div>
        <div className="mt-2 text-ink/80 leading-relaxed">
          To find orphan pages on Squarespace, crawl your live site with a free browser tool like Crawlmouse
          &mdash; it maps your internal links and lists every page nothing points to, with nothing to
          install. Squarespace is unusually prone to orphans because of its <strong>Not Linked</strong>{' '}
          section: pages there stay public and indexable but vanish from navigation, so unless you link to
          them manually, they exist with zero internal links.
        </div>
      </div>

      <p>
        Squarespace has a feature no other major platform makes quite so prominent: a{' '}
        <strong>Not Linked</strong> section, sitting at the bottom of every Pages panel, where you can park
        pages that shouldn&rsquo;t appear in the menu. It&rsquo;s genuinely useful &mdash; and it&rsquo;s
        also a built-in orphan-page factory. Pages there remain fully public and indexable; Squarespace&rsquo;s
        own documentation describes them as hidden from menus but reachable by URL and indexable by search
        engines. Which means every page you drag there and forget becomes an{' '}
        <Link href={'/blog/orphan-pages' as Route}>orphan page</Link>: live, in your sitemap, and linked from
        absolutely nowhere. Here&rsquo;s why it happens, how to find every orphan on your Squarespace site
        for free, and how to fix the ones that matter.
      </p>

      <h2>Why Squarespace creates orphan pages by default</h2>
      <p>
        A few of these are universal; the first two are distinctly Squarespace:
      </p>
      <ul>
        <li>
          <strong>The Not Linked section.</strong> It&rsquo;s the intended home for landing pages, thank-you
          pages, and works-in-progress &mdash; but nothing about it reminds you that its pages have no
          internal links. Sites accumulate years of &ldquo;temporary&rdquo; pages there: old promos, seasonal
          offers, that services page from the previous redesign. All public, all indexable, all unlinked.
        </li>
        <li>
          <strong>Navigation redesigns.</strong> On Squarespace, navigation largely <em>is</em> the internal
          linking &mdash; most templates generate few automatic contextual links between pages. So when you
          simplify your menu from twelve items to five, the seven pages you dragged to Not Linked lose, in
          many cases, their only internal links in one gesture.
        </li>
        <li>
          <strong>Blogs and collections in silos.</strong> If a blog page is removed from navigation, its
          posts can remain live and indexed while the path to reach them from your site disappears. Old posts
          with no in-body links pointing to them orphan quietly.
        </li>
        <li>
          <strong>Version migrations and template switches.</strong> Moving between Squarespace 7.0 and 7.1
          or restructuring index pages into sections changes what&rsquo;s linked from where; pages that were
          part of an index can end up standalone and unreferenced.
        </li>
        <li>
          <strong>Campaign and one-off pages.</strong> Pages built for an email blast or a social push get
          their traffic from the link in the campaign &mdash; and from nowhere on the site itself. When the
          campaign ends, the page keeps existing with zero paths to it.
        </li>
      </ul>

      <h2>How to find every orphan page, free</h2>
      <p>
        The definition is mechanical, so the method is too: build the list of pages that <em>exist</em>,
        build the map of pages your internal links <em>reach</em>, and diff them.
      </p>
      <p>
        <strong>Step 1 &mdash; crawl your live site.</strong> Run your domain through{' '}
        <Link href={{ pathname: '/' }}>Crawlmouse</Link> &mdash; it&rsquo;s free, runs in the browser, and
        needs nothing installed (there&rsquo;s no code injection or plugin involved, which on Squarespace is
        the only kind of tool you can use anyway). It follows every internal link from your homepage the way
        a search-engine crawler does, maps the link graph, and grades the structure &mdash; listing orphaned
        and near-orphaned pages and how deep each page sits. This is the &ldquo;what&rsquo;s
        reachable&rdquo; half of the diff.
      </p>
      <p>
        <strong>Step 2 &mdash; open your Pages panel and your sitemap.</strong> The &ldquo;what
        exists&rdquo; half lives in two places: the Pages panel (scroll to Not Linked and actually read
        what&rsquo;s in there &mdash; most site owners are surprised) and{' '}
        <code>yoursite.com/sitemap.xml</code>, which Squarespace generates automatically and which includes
        your enabled public pages. Any URL in the sitemap that didn&rsquo;t appear in the crawl is a page
        with no internal path to it.
      </p>
      <p>
        <strong>Step 3 &mdash; cross-check with Google Search Console.</strong> If you have GSC set up, the
        Pages report shows URLs Google has discovered but not indexed &mdash; orphans are heavily
        over-represented there, because a page in the sitemap with no internal links is exactly what Google
        deprioritises. (Our guide to{' '}
        <Link href={'/blog/discovered-currently-not-indexed' as Route}>&ldquo;Discovered &ndash; currently
        not indexed&rdquo;</Link> covers that report in depth.)
      </p>

      <h2>How to fix the orphans that matter</h2>
      <ul>
        <li>
          <strong>Triage first.</strong> Not every Not Linked page is a problem. Thank-you pages, private
          client pages, and active campaign landers are <em>deliberate</em> orphans &mdash; leave them (or
          hide them from search properly if they shouldn&rsquo;t be indexed at all). You&rsquo;re looking for
          pages you actually want found: services, portfolio pieces, evergreen posts, old pages still earning
          search impressions.
        </li>
        <li>
          <strong>Re-link deliberately, not just via the menu.</strong> Dragging a page back into navigation
          works, but menus shouldn&rsquo;t carry everything. The stronger fix on Squarespace is contextual:
          text links from related pages and blog posts, buttons on relevant sections, and a footer that
          carries your important secondary pages. Contextual links also tell search engines what the page is
          about &mdash; a menu link doesn&rsquo;t.
        </li>
        <li>
          <strong>Give every kept page at least one real link.</strong> The minimum standard: no page you
          care about should have zero internal links. One good contextual link from an established page moves
          a URL from &ldquo;orphan&rdquo; to &ldquo;connected&rdquo;; two or three from related content is
          better. Watch <Link href={'/blog/how-deep-is-too-deep-crawl-depth' as Route}>click depth</Link>{' '}
          too &mdash; a page linked only from another buried page is barely better off.
        </li>
        <li>
          <strong>Retire the rest.</strong> Pages that no longer serve a purpose: disable them, or if they
          have inbound links or search traffic, 301-redirect them to the closest live page (Squarespace
          supports URL mappings under Developer Tools).
        </li>
        <li>
          <strong>Re-crawl to confirm.</strong> Run the crawl again after fixing. Orphan-hunting is a diff;
          the after-picture is how you know the fix landed.
        </li>
      </ul>

      <p>
        The same method works platform-to-platform &mdash; we&rsquo;ve covered the specifics for{' '}
        <Link href={'/blog/find-orphan-pages-wordpress' as Route}>WordPress</Link>,{' '}
        <Link href={'/blog/find-orphan-pages-shopify' as Route}>Shopify</Link>, and{' '}
        <Link href={'/blog/find-orphan-pages-webflow' as Route}>Webflow</Link> &mdash; but Squarespace is the
        one where the platform hands you a labelled box of orphans and politely never mentions it again. Ten
        minutes with the crawl and your Pages panel is usually all it takes to find years of them.
      </p>

      <p className="mt-10 text-sm text-ink/60">
        Crawlmouse is a free internal-linking grader built by{' '}
        <a href="https://nahltech.com" rel="noopener">Nahl Technologies</a>.
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
