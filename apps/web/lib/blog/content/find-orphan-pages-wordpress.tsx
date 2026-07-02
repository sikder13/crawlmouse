import Link from 'next/link';
import type { Route } from 'next';
import { JsonLd, faqLd } from '../../seo/jsonld';
import type { FaqItem } from '../../seo/faq';

const FAQ: readonly FaqItem[] = [
  {
    question: 'Why does WordPress create orphan pages so easily?',
    answer:
      'WordPress auto-generates archives (tags, categories, authors, dates), lets page builders publish pages outside the normal template flow, and carries links across theme and plugin changes imperfectly. Each of those routinely leaves pages with no internal links pointing to them.',
  },
  {
    question: 'How do I find orphan pages in WordPress without a plugin?',
    answer:
      'Crawl your live site with a browser tool like Crawlmouse. It maps every internal link and lists the pages with none pointing to them, and it works no matter which theme, builder, or plugins you use — nothing to install and no extra weight on your site.',
  },
  {
    question: 'Do Rank Math or Yoast find orphan pages?',
    answer:
      'Rank Math (free) shows an orphan indicator in the SEO Details column of your Posts and Pages lists. Yoast has an orphaned-content filter in its Premium version. Both work inside the dashboard for the posts and pages the plugin manages, and add a little weight to your site.',
  },
  {
    question: 'Do WordPress tags and categories cause orphan pages?',
    answer:
      'They can. Thin or single-use tag archives often end up with almost nothing linking to them, and empty archives add clutter without value. Either link the useful ones meaningfully or set the low-value ones to noindex — and resist creating a new tag for every post.',
  },
  {
    question: 'How do I fix an orphaned WordPress post?',
    answer:
      'If it is worth keeping, add a contextual internal link from two or three related posts or its category page using descriptive anchor text. If it is outdated or duplicate, 301-redirect it to the closest live page or remove it, then update and resubmit your sitemap.',
  },
];

/** Body for /blog/find-orphan-pages-wordpress. Rendered inside ArticleLayout's `.article-prose`. */
export function FindOrphanPagesWordpressBody() {
  return (
    <>
      <div className="mb-8 rounded-2xl border border-oat bg-white p-6">
        <div className="text-xs font-semibold uppercase tracking-wide text-peach">Quick answer</div>
        <div className="mt-2 text-ink/80 leading-relaxed">
          To find orphan pages in WordPress, use an SEO plugin like Rank Math or Yoast that flags posts with
          no internal links — or, without adding a plugin, crawl your live site with a free browser tool like
          Crawlmouse, which maps your internal links and lists every orphaned page regardless of your theme,
          page builder, or plugins.
        </div>
      </div>

      <p>
        WordPress orphans pages faster than almost any platform, and it&rsquo;s not your fault. Between
        auto-generated tag and category archives, pages built in Elementor or Divi that live outside the
        normal template flow, and links that quietly break every time you switch themes or plugins, a
        WordPress site accumulates pages with no internal links pointing to them without anyone deciding it
        should. Those are <strong>orphan pages</strong> — pages that exist and load, but that crawlers rarely
        find and visitors can only reach by typing the URL. Here&rsquo;s how to find every one of them, with
        or without a plugin, and fix the ones worth keeping.
      </p>

      <h2>Why WordPress sites accumulate orphan pages</h2>
      <p>The usual culprits are specific to how WordPress works:</p>
      <ul>
        <li>
          <strong>Page-builder pages outside the loop.</strong> A landing page built in a page builder is
          often published as a standalone URL that never gets linked from a menu, category, or related list.
        </li>
        <li>
          <strong>Auto-generated archives.</strong> Tag, category, author, and date archives are created
          automatically. A tag used on a single post can spawn an archive that almost nothing links to.
        </li>
        <li>
          <strong>Theme and plugin swaps.</strong> Change a theme or a related-posts plugin and the internal
          links it generated can vanish, stranding the pages they used to point to.
        </li>
        <li>
          <strong>Removed from the menu, not deleted.</strong> An old service or seasonal page comes out of
          navigation, but the URL stays live with nothing pointing to it.
        </li>
        <li>
          <strong>&ldquo;Publish now, link later.&rdquo;</strong> A post ships to hit a schedule and the
          internal links never get added.
        </li>
      </ul>

      <h2>How to find orphan pages in WordPress</h2>
      <p>
        Finding orphans always comes down to the same comparison: every page that <em>exists</em> versus
        every page something <em>links to</em>. On WordPress you have three practical ways to run it:
      </p>
      <ul>
        <li>
          <strong>Without a plugin (free).</strong> Crawl your live site with{' '}
          <Link href={{ pathname: '/' }}>Crawlmouse</Link>. It maps your whole internal link graph and lists
          every page with zero inbound links — including pages it only finds in your sitemap — no matter
          which theme, builder, or plugins you run, and with nothing added to your site. Because it reads the{' '}
          <em>static</em> HTML WordPress outputs, it also flags pages whose links only appear after
          JavaScript, which is exactly what a non-rendering AI crawler misses too.
        </li>
        <li>
          <strong>With an SEO plugin.</strong> Rank Math (free) shows an orphan indicator in the SEO Details
          column of your Posts and Pages lists — enable it from Screen Options if you don&rsquo;t see it.
          Yoast Premium has an orphaned-content filter. Both are convenient inside the dashboard, but they
          only cover the posts and pages the plugin manages, and they add a little weight to your site.
        </li>
        <li>
          <strong>Google Search Console (free).</strong> Look for indexed URLs with no referring internal
          links, and compare your sitemap against what a crawl actually reaches. This is the way to catch
          orphans that exist only in Google&rsquo;s data rather than in your sitemap.
        </li>
      </ul>
      <p>
        For most WordPress sites the no-plugin crawl is the fastest complete picture — it doesn&rsquo;t care
        how the page was built, only whether anything links to it. See the{' '}
        <Link href={'/blog/orphan-pages' as Route}>full orphan-pages guide</Link> for the platform-agnostic
        version of every method.
      </p>

      <h2>Do tags and categories count as orphan pages?</h2>
      <p>
        Sometimes, and this is where WordPress trips people up. A category page that&rsquo;s linked from your
        navigation and lists real posts is fine. A tag you used once, whose archive lists a single post and
        is linked from nowhere, is effectively an orphan that also adds thin, near-duplicate clutter to your
        site. The fix isn&rsquo;t to link every archive into your menu — that buries your real pages.
        It&rsquo;s to be deliberate: link the archives that genuinely help people navigate, set the low-value
        ones to <code>noindex</code>, and stop minting a new tag for every post.
      </p>

      <h2>How to fix orphaned WordPress pages</h2>
      <p>For each orphan, decide: keep it or kill it.</p>
      <p>
        <strong>Keep it?</strong> Add a contextual internal link from two or three genuinely related posts
        and, where it fits, its category or a hub page — with descriptive anchor text, not &ldquo;read
        more.&rdquo; If it&rsquo;s an important page, put it back in the menu or a prominent hub. A couple of
        relevant links beat a pile of footer links.
      </p>
      <p>
        <strong>Kill it?</strong> If the page is outdated, duplicated, or a dead campaign, 301-redirect it to
        the closest live page or remove it, then update your sitemap and resubmit it in Search Console so
        Google re-crawls the cleaned-up structure.
      </p>

      <h2>How to stop WordPress orphaning pages again</h2>
      <p>
        Orphans come back after every theme change, plugin swap, and busy publishing week. Build the habit
        into how you publish: link each new post from two or three relevant older posts before it goes live,
        lean on a sensible category and hub structure rather than a sprawl of one-off tags, and re-crawl
        after any theme or plugin change. Run the crawl, link up the orphans worth keeping, re-crawl to
        confirm they&rsquo;re connected, and the pages that were invisible become findable — by Google and by
        the AI crawlers reading your raw HTML. While you&rsquo;re at it, it&rsquo;s worth checking your{' '}
        <Link href={'/blog/crawl-depth-site-architecture' as Route}>crawl depth</Link> too, since the same
        thin linking that orphans a page also buries the ones that do have links.
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
