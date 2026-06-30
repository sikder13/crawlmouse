import Link from 'next/link';
import type { Route } from 'next';

/** Body for /blog/crawl-depth-site-architecture. Rendered inside ArticleLayout's `.article-prose`. */
export function CrawlDepthBody() {
  return (
    <>
      <p>
        Take two identical pages with identical content. Put one three clicks from your homepage and bury
        the other eight clicks deep. Over time, the shallow page gets crawled more often, accumulates more
        internal authority, and ranks better. Same content, different outcome — and the only variable is
        <strong> click depth</strong>.
      </p>
      <p>
        Click depth (often called crawl depth) is one of the most underrated levers in technical SEO,
        partly because it&rsquo;s easy to confuse with things it isn&rsquo;t. Let&rsquo;s clear that up and
        then make it actionable.
      </p>

      <h2>Click depth is not URL depth</h2>
      <p>
        The single biggest misconception: click depth has nothing to do with how many slashes are in your
        URL. A page at <code>example.com/blog/2021/03/long-old-post</code> looks &ldquo;deep&rdquo; — but if
        your homepage links straight to it, it&rsquo;s one click from home. Click depth is measured in{' '}
        <em>links</em>, not folders: the fewest clicks a visitor (or a crawler) needs to reach the page
        starting from your homepage.
      </p>
      <p>
        That distinction matters because it tells you where the fix lives. You don&rsquo;t flatten a site
        by rewriting URLs. You flatten it by changing what links to what.
      </p>

      <h2>Why depth moves rankings</h2>
      <p>
        Depth affects three things that all feed into how a page performs:
      </p>
      <ul>
        <li>
          <strong>Crawl frequency.</strong> Search engines spend a finite amount of effort crawling any
          given site. Pages close to the homepage — and close to other heavily linked pages — get visited
          more often, so changes to them are noticed sooner. Deep pages can go weeks between crawls.
        </li>
        <li>
          <strong>Authority flow.</strong> Internal links pass ranking signals, and that strength
          attenuates with every hop. Your homepage is usually your strongest page; each link out divides
          its authority among the pages it points to, and so on down the chain. A page eight links removed
          is living on the fumes of whatever survived the journey.
        </li>
        <li>
          <strong>Reachability for people.</strong> Depth isn&rsquo;t just a crawler concern. Every extra
          click is a place a real visitor drops off. Pages buried deep get less engagement, which is its
          own quiet ranking headwind.
        </li>
      </ul>

      <h2>About the &ldquo;three-click rule&rdquo;</h2>
      <p>
        You&rsquo;ve probably heard that every page should be reachable within three clicks. Treat that as a
        rule of thumb, not a law. There&rsquo;s nothing magic about the number three, and a huge site
        genuinely can&rsquo;t put a million products three clicks from home. The principle underneath it
        <em> is</em> sound, though: <strong>the pages you care about most should be the shallowest.</strong>{' '}
        Don&rsquo;t obsess over hitting three clicks everywhere — obsess over not letting important pages
        slide to depth seven.
      </p>

      <h2>What actually controls your depth</h2>
      <p>
        Three things shape the depth of your site, in roughly this order of impact:
      </p>
      <ul>
        <li>
          <strong>Primary navigation.</strong> Anything in your main menu is effectively one or two clicks
          from everywhere. This is powerful and easy to overuse — a mega-menu linking to 200 pages makes
          them all shallow, but smears your authority thin across all of them.
        </li>
        <li>
          <strong>Hub and category pages.</strong> Well-built hubs are the workhorses of a shallow site:
          the homepage links to the hub, the hub links to its pages. This keeps things shallow{' '}
          <em>and</em> communicates topical structure, which a flat mega-menu doesn&rsquo;t.
        </li>
        <li>
          <strong>Contextual links inside content.</strong> A link from one article to a related one can
          single-handedly pull a page up several levels. These are the cheapest depth fixes you have.
        </li>
      </ul>

      <h2>The architectures that go wrong</h2>
      <p>
        A few patterns reliably create depth problems:
      </p>
      <ul>
        <li>
          <strong>Pagination chains.</strong> If old content is only reachable through &ldquo;page 2, page
          3, … page 40&rdquo; of an archive, the stuff on page 40 is effectively at depth 40. Large blogs and
          stores bury enormous amounts of content this way.
        </li>
        <li>
          <strong>Hubs that don&rsquo;t link down.</strong> A category page that lists products is fine; a
          category page that exists but links to nothing useful strands everything beneath it.
        </li>
        <li>
          <strong>Over-siloing.</strong> Strict silos can be good for topical clarity, but taken too far
          they trap pages deep inside a single branch with no shortcuts, pushing depth up.
        </li>
      </ul>

      <h2>How to measure it</h2>
      <p>
        You can&rsquo;t fix depth you can&rsquo;t see, and you can&rsquo;t eyeball it — depth is a property
        of the whole link graph, not of any single page. You need a crawl that starts at your homepage and
        records the shortest click-path to every page.{' '}
        <Link href={{ pathname: '/' }}>Crawlmouse</Link> computes click depth for every page it finds and
        rolls it into the structure grade, so you can sort your site by depth and immediately see what&rsquo;s
        stranded. Pair that with an <Link href={'/blog/orphan-pages' as Route}>orphan check</Link> — orphans
        are just the extreme case, pages at infinite depth. For the practical thresholds — how deep is too
        deep for your size, and how to pull buried pages up — see{' '}
        <Link href={'/blog/how-deep-is-too-deep-crawl-depth' as Route}>how deep is too deep</Link>.
      </p>

      <h2>How to flatten without flattening into mush</h2>
      <p>
        The goal isn&rsquo;t minimum depth everywhere — it&rsquo;s the <em>right</em> depth for each page&rsquo;s
        importance. To get there:
      </p>
      <ol>
        <li>
          Identify your money pages and most important content, and make sure each is within a few clicks of
          home via a hub or a contextual link.
        </li>
        <li>
          Strengthen hub pages so they actually link down to the pages beneath them, and link up to them from
          related content.
        </li>
        <li>
          Tame pagination — surface key older content through hubs, related-content modules, or an HTML
          sitemap, rather than relying on a 40-page archive chain.
        </li>
        <li>
          Add contextual links between related pages as you publish. It&rsquo;s the lowest-effort depth fix
          and it improves the reader&rsquo;s experience at the same time.
        </li>
      </ol>
      <p>
        Resist the urge to solve depth by dumping every URL into the navigation. That makes everything
        shallow and nothing important — the structural equivalent of shouting. A good architecture is
        shallow where it counts and clearly organized everywhere else.
      </p>
      <p>
        Crawl your site, sort by depth, pull your important pages up, and re-check. It&rsquo;s one of the few
        SEO changes whose effect you can see in the structure the moment you make it — long before the
        rankings catch up.
      </p>
    </>
  );
}
