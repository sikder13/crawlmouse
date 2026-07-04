import Link from 'next/link';
import type { Route } from 'next';
import { JsonLd, faqLd } from '../../seo/jsonld';
import type { FaqItem } from '../../seo/faq';

const FAQ: readonly FaqItem[] = [
  {
    question: 'Why does Shopify create orphan pages?',
    answer:
      'Shopify uses a flat URL structure with no nested hierarchy, so internal links are the only way to signal which pages sit above or below others. Product pages often link up via breadcrumbs but down to nothing, blogs sit in a separate silo, and collection grids frequently link to non-canonical product URLs — all of which leave pages with few or no internal links pointing to them.',
  },
  {
    question: 'How do I find orphan pages on Shopify without an app?',
    answer:
      'Crawl your live store with a free browser tool like Crawlmouse. It maps your internal-link graph and lists the pages nothing links to, plus pages buried too deep — with nothing to install and no app added to your store. It follows canonical tags, so it grades the internal linking of the pages Google actually indexes.',
  },
  {
    question: 'What is the Shopify canonical URL orphan problem?',
    answer:
      'By default, many Shopify themes link to the collection-nested version of a product (/collections/x/products/y) rather than the canonical /products/y URL. Because the canonical is the version Google indexes, this can leave your real product pages with no direct internal links. Fixing the collection template to link canonical URLs resolves it at scale.',
  },
  {
    question: 'Do collection pages matter for Shopify internal linking?',
    answer:
      'A lot. Collection pages target category-level, high-intent keywords and are usually your most valuable pages, so they should receive the most internal links — from your homepage, your navigation, and contextual links in blog posts. Sub-collections also help large catalogs stay shallow instead of hiding products behind deep pagination.',
  },
  {
    question: 'How do I fix an orphaned Shopify page?',
    answer:
      'If the page matters, add contextual internal links to it from related, established pages — blog posts linking to products and collections are especially valuable. If it is outdated or a removed product, 301-redirect it to the closest live page. Then re-crawl to confirm it is connected.',
  },
];

/** Body for /blog/find-orphan-pages-shopify. Rendered inside ArticleLayout's `.article-prose`. */
export function FindOrphanPagesShopifyBody() {
  return (
    <>
      <div className="mb-8 rounded-2xl border border-oat bg-white p-6">
        <div className="text-xs font-semibold uppercase tracking-wide text-peach">Quick answer</div>
        <div className="mt-2 text-ink/80 leading-relaxed">
          To find orphan pages on Shopify, crawl your live store with a free browser tool like Crawlmouse — it
          maps your internal links and lists every page nothing points to, with no app to install. Shopify is
          especially prone to orphans because its flat URLs and collection templates often leave product pages
          with few or no direct internal links.
        </div>
      </div>

      <p>
        Shopify makes a lot of SEO easy, but internal linking isn&rsquo;t one of them. Between a flat URL
        structure with no real hierarchy, collection grids that link to the &ldquo;wrong&rdquo; version of a
        product, and blogs that live in their own silo, Shopify stores accumulate <strong>orphan pages</strong>
        &mdash; pages that exist and load, but that nothing internal links to, so Google rarely crawls or
        indexes them. Here&rsquo;s why it happens, how to find every orphan on your store for free, and how to
        fix the ones that matter.
      </p>

      <h2>Why Shopify creates orphan pages by default</h2>
      <p>
        Some of this is generic, but a few causes are specific to how Shopify is built:
      </p>
      <ul>
        <li>
          <strong>No URL hierarchy.</strong> Everything lives under flat prefixes — <code>/products/</code>,{' '}
          <code>/collections/</code>, <code>/pages/</code>. You can&rsquo;t build{' '}
          <code>/clothing/shirts/blue-tee</code>. That means internal linking is the <em>only</em> way to tell
          Google which pages sit above or below others.
        </li>
        <li>
          <strong>Isolated product pages.</strong> A typical product page links up to its collection via
          breadcrumbs and down to nothing else — no related products, no contextual links — so it collects
          little internal support.
        </li>
        <li>
          <strong>The blog silo.</strong> Shopify blogs often sit apart from the store, publishing content that
          never links through to the products and collections it&rsquo;s about — a huge missed connection.
        </li>
        <li>
          <strong>Thin, unlinked collections.</strong> Auto-created or one-off collections that nothing links
          to end up stranded, adding orphaned, near-duplicate pages.
        </li>
        <li>
          <strong>Removed or discontinued products.</strong> Pull a product from its collection and the URL
          usually stays live with nothing pointing to it anymore.
        </li>
      </ul>

      <h2>The canonical URL problem (Shopify&rsquo;s built-in orphan)</h2>
      <p>
        This one catches almost everyone. When a product appears in a collection, many Shopify themes link to
        the collection-nested URL — <code>/collections/summer/products/blue-tee</code> — rather than the
        canonical <code>/products/blue-tee</code>. But the canonical is the version Google indexes. So your
        real product page can end up with no <em>direct</em> internal links at all, even though it looks linked
        everywhere. It&rsquo;s the reason audit tools so often flag Shopify stores with &ldquo;canonical URLs
        have no incoming internal links.&rdquo; The fix is structural: update your collection template to link
        canonical <code>/products/</code> URLs, or add an &ldquo;all products&rdquo; page that lists the
        canonical URLs directly.
      </p>

      <h2>How to find orphan pages on Shopify</h2>
      <p>
        You can&rsquo;t spot orphans by clicking around — by definition you can&rsquo;t click to them. Finding
        them means comparing every page that exists against every page something links to. A few ways to do
        that on Shopify:
      </p>
      <ul>
        <li>
          <strong>A free browser crawl (no app).</strong> <Link href={{ pathname: '/' }}>Crawlmouse</Link>
          {' '}crawls your live store, maps the internal-link graph, and lists the pages with no inbound
          internal links plus the ones buried too deep — nothing to install, and no app slowing your storefront
          down. It follows canonical tags, so it grades the internal linking of the pages Google actually
          indexes.
        </li>
        <li>
          <strong>Screaming Frog (desktop).</strong> Free for up to 500 URLs; crawl the store and sort the
          &ldquo;unique inlinks&rdquo; column ascending to see which pages have the fewest links pointing to
          them. It&rsquo;s a desktop install. (See the <Link href={'/blog/screaming-frog-alternative' as Route}>
          no-install comparison</Link>.)
        </li>
        <li>
          <strong>Search Console.</strong> The Links report shows which pages have the most internal links —
          the ones near the bottom, or missing entirely, are your orphan candidates. Pair it with the Pages
          report to see what&rsquo;s going unindexed.
        </li>
      </ul>
      <p>
        For the platform-agnostic version of every method, see the full{' '}
        <Link href={'/blog/orphan-pages' as Route}>guide to finding orphan pages</Link> — and if you&rsquo;re on
        WordPress instead, the <Link href={'/blog/find-orphan-pages-wordpress' as Route}>WordPress
        walkthrough</Link>.
      </p>

      <h2>How to fix orphaned Shopify pages</h2>
      <p>Once you have the list, the fixes are mostly about adding the right links:</p>
      <ul>
        <li>
          <strong>Link canonical product URLs.</strong> Fix the collection template (or add an all-products
          page) so links point to <code>/products/</code> URLs, not the collection-nested duplicates.
        </li>
        <li>
          <strong>Turn your blog into a bridge.</strong> Add two to three contextual links from each blog post
          to the relevant products and collections. This is the highest-value internal linking a Shopify store
          can do — it passes support from content into the pages you most want found.
        </li>
        <li>
          <strong>Link collections from the homepage and navigation.</strong> Your collection pages target your
          most valuable category keywords, so make sure they&rsquo;re well linked and, for large catalogs,
          broken into sub-collections to keep things <Link href={'/blog/crawl-depth-site-architecture' as Route}>
          shallow</Link> rather than hidden behind deep pagination.
        </li>
        <li>
          <strong>Redirect the dead ones.</strong> For discontinued products with no successor,
          301-redirect to the closest live page rather than leaving an orphan floating.
        </li>
      </ul>

      <h2>How to stop Shopify orphaning pages again</h2>
      <p>
        Orphans come back after every theme change, app swap, and catalog update. Build the habit in: link each
        new product and post from a couple of relevant existing pages when you publish, keep the blog linking
        into the store, and re-crawl after any theme or structural change to catch what slipped. Because
        internal linking is one of the few SEO levers entirely within your control — no outreach, no backlinks,
        no cost — it&rsquo;s among the fastest structural wins available to a Shopify store. Run the crawl, link
        up the orphans worth keeping, re-crawl to confirm, and give Google a clear path to the pages you want
        found.
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
