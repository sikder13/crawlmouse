import Link from 'next/link';
import type { Route } from 'next';
import { JsonLd, faqLd } from '../../seo/jsonld';
import type { FaqItem } from '../../seo/faq';

const FAQ: readonly FaqItem[] = [
  {
    question: 'Why does Webflow create orphan pages?',
    answer:
      'The most common cause is Webflow-specific: putting a limit on a CMS Collection List. When a list shows only the first N items, every item beyond that limit gets no internal link and becomes an orphan as the collection grows. Smaller sites also orphan pages simply by not adding them to the navbar or footer.',
  },
  {
    question: 'What is the Webflow CMS Collection List limit problem?',
    answer:
      'A Collection List in Webflow auto-generates internal links to its items. If you set an item limit on that list, only the first few items get linked; the rest are published with no incoming internal links. It is the single most common way orphan pages are born in Webflow, and it gets worse as you add more CMS items.',
  },
  {
    question: 'How do I find orphan pages on Webflow for free?',
    answer:
      'Crawl your live site with a free browser tool like Crawlmouse. It maps your internal-link graph and lists every page nothing links to — no install, no app added to your Webflow project. Screaming Frog\u2019s free tier (up to 500 URLs) and Ahrefs\u2019 free account connected to Search Console can also find them.',
  },
  {
    question: 'Does Webflow output crawlable HTML?',
    answer:
      'Yes. Webflow renders clean, semantic HTML server-side, with automatic sitemaps and canonical tags — so unlike a JavaScript single-page app, your content is readable by search engines and AI crawlers by default. On Webflow, the usual discoverability problem isn\u2019t rendering; it\u2019s internal linking.',
  },
  {
    question: 'How do I fix an orphaned Webflow page?',
    answer:
      'Remove unnecessary limits on the CMS Collection Lists that should link to it, or add a full listing page. For standalone pages, add contextual links from related pages and, where it fits, the navbar or footer. Consider linking an important page from more than one place. Then re-crawl to confirm it is connected.',
  },
];

/** Body for /blog/find-orphan-pages-webflow. Rendered inside ArticleLayout's `.article-prose`. */
export function FindOrphanPagesWebflowBody() {
  return (
    <>
      <div className="mb-8 rounded-2xl border border-oat bg-white p-6">
        <div className="text-xs font-semibold uppercase tracking-wide text-peach">Quick answer</div>
        <div className="mt-2 text-ink/80 leading-relaxed">
          Webflow usually orphans pages in one of two ways: you put a limit on a CMS Collection List (so items
          past the limit get no internal links), or you publish a page without adding it to the navbar or body
          content. To find them, crawl your live site with a free browser tool like Crawlmouse, which lists
          every page nothing links to &mdash; no app to install.
        </div>
      </div>

      <p>
        Webflow gives you clean, crawlable HTML and a lot of SEO basics for free &mdash; but internal linking
        isn&rsquo;t automatic, and that&rsquo;s where <strong>orphan pages</strong> creep in: pages that exist
        and load fine, but that nothing on your site links to, so crawlers rarely find them and visitors
        can&rsquo;t reach them. On Webflow there&rsquo;s one cause that catches almost everyone. Here&rsquo;s
        what it is, how to find every orphan on your site for free, and how to fix them.
      </p>

      <h2>The CMS Collection List limit trap</h2>
      <p>
        This is the Webflow-specific one. A Collection List automatically generates internal links to the CMS
        items it displays &mdash; that&rsquo;s how your blog posts, projects, or products get linked. But
        Webflow lets you set a <em>limit</em> on how many items a list shows. The moment you do, only the
        first few items get an internal link; every item beyond the limit is published with <em>nothing
        pointing to it</em>. It works fine on day one, then quietly breaks as your collection grows &mdash;
        which is exactly why it&rsquo;s the most common way orphan pages are born in Webflow. Setting a limit
        on any Collection List that&rsquo;s meant to link your items is the trap. (Pagination isn&rsquo;t a
        clean fix either &mdash; it solves the orphan problem but can introduce duplicate-page issues.)
      </p>

      <h2>The other cause: pages that never got linked</h2>
      <p>
        On smaller Webflow sites that don&rsquo;t lean on CMS Collections, orphans usually happen the simple
        way: a page gets built and published but never added to the navbar, footer, or any page&rsquo;s body
        content. One good thing about Webflow &mdash; dead-end pages (pages with no links <em>out</em>) are
        rare, because your navbar and footer give every page at least a few outgoing links. The problem is
        almost always links <em>in</em>.
      </p>

      <h2>How to find orphan pages on Webflow</h2>
      <p>
        You can&rsquo;t spot orphans by clicking around your own site &mdash; by definition you can&rsquo;t
        click to them. You have to compare every page that exists against every page something links to. A few
        ways:
      </p>
      <ul>
        <li>
          <strong>A free browser crawl (no app).</strong> <Link href={{ pathname: '/' }}>Crawlmouse</Link>
          {' '}crawls your live Webflow site, maps the internal-link graph, and lists the pages with no
          inbound internal links &mdash; nothing to install, and no app added to your Webflow project.
        </li>
        <li>
          <strong>Screaming Frog (desktop).</strong> Free up to 500 URLs; its Crawl Analysis &rarr; Orphan
          Pages report compares the crawl against your sitemap. (See the <Link
          href={'/blog/screaming-frog-alternative' as Route}>no-install comparison</Link>.)
        </li>
        <li>
          <strong>Ahrefs free + Search Console.</strong> A free Ahrefs account connected to Search Console
          runs a small audit that flags an &ldquo;Orphan Page&rdquo; error, showing pages with no internal
          links.
        </li>
      </ul>
      <p>
        For the platform-agnostic version of every method, see the full <Link
        href={'/blog/orphan-pages' as Route}>guide to finding orphan pages</Link> &mdash; and if you also work
        on <Link href={'/blog/find-orphan-pages-wordpress' as Route}>WordPress</Link> or <Link
        href={'/blog/find-orphan-pages-shopify' as Route}>Shopify</Link>, each has its own quirks.
      </p>

      <h2>Good news: Webflow is already AI-crawler-friendly</h2>
      <p>
        One thing you don&rsquo;t have to worry about on Webflow: rendering. Because Webflow outputs clean,
        server-rendered HTML rather than a JavaScript-only shell, your content is readable by search engines
        <em> and</em> by AI crawlers like GPTBot and ClaudeBot by default &mdash; which is <Link
        href={'/blog/can-ai-crawlers-see-javascript' as Route}>not true of many JavaScript sites</Link>. So on
        Webflow, the discoverability job is almost entirely about internal linking, not about making your
        content visible in the first place.
      </p>

      <h2>How to fix and prevent Webflow orphans</h2>
      <p>
        For each orphan, keep it or kill it. <strong>Keeping it</strong> means giving it real internal links:
        remove the unnecessary limit on the Collection List that should link to it (or add a full listing
        page), and add contextual links from related pages &mdash; a link in a section, a button, or a
        hyperlink in body copy. For an important page, link it from more than one place, and add it to the
        navbar or a hub. <strong>Killing it</strong> means 301-redirecting an outdated page to the closest
        live one.
      </p>
      <p>
        To stop them coming back: avoid limiting Collection Lists that are meant to link your items, link each
        new page from a couple of relevant existing pages when you publish, and re-crawl after structural
        changes. Run the crawl, connect the orphans worth keeping, re-crawl to confirm, and give crawlers a
        clear path to every page you want found.
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
