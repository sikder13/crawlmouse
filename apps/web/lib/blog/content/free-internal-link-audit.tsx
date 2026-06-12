import Link from 'next/link';
import type { Route } from 'next';

/** Body for /blog/free-internal-link-audit. Rendered inside ArticleLayout's `.article-prose`. */
export function FreeInternalLinkAuditBody() {
  return (
    <>
      <p>
        Most internal-linking problems are invisible from the inside. You know your site, so you
        navigate it the way you built it — straight to the page you want, never noticing that nothing
        actually <em>links</em> to it. Search engines don&rsquo;t have that luxury. They follow links,
        and a page that nothing links to is a page they rarely crawl and almost never rank.
      </p>
      <p>
        The good news: you can find these problems in an afternoon, for free, without installing a
        crawler or learning a 300-setting interface. This is the audit I run before I touch anything
        else on a site, and the order I run it in.
      </p>

      <h2>What an internal-link audit actually checks</h2>
      <p>
        Strip away the jargon and an internal-link audit answers four questions about how the pages on
        your site connect to each other:
      </p>
      <ul>
        <li>
          <strong>Can every page be reached?</strong> Pages with no internal links pointing to them are{' '}
          <Link href={'/blog/orphan-pages' as Route}>orphan pages</Link> — dead weight that earns no
          traffic.
        </li>
        <li>
          <strong>How deep is everything?</strong> A page&rsquo;s{' '}
          <Link href={'/blog/crawl-depth-site-architecture' as Route}>click depth</Link> — how many
          clicks it sits from the homepage — predicts how often it gets crawled and how much authority
          it receives.
        </li>
        <li>
          <strong>Where does authority concentrate?</strong> A healthy site funnels link equity into a
          handful of important &ldquo;hub&rdquo; pages. A flat, undifferentiated graph spreads it thin.
        </li>
        <li>
          <strong>Are the links descriptive?</strong> Anchor text like &ldquo;click here&rdquo; tells
          search engines nothing. Descriptive, varied anchors do.
        </li>
      </ul>
      <p>
        You don&rsquo;t need to memorize any of that. You need a tool that crawls the site, builds the
        link graph, and surfaces the four answers — which is exactly the job{' '}
        <Link href={{ pathname: '/' }}>Crawlmouse</Link> does in a couple of minutes.
      </p>

      <h2>Step 1: Crawl the live site</h2>
      <p>
        Paste your homepage URL into Crawlmouse and let it run. It fetches your pages the way a search
        engine would, records every internal link it finds, and assembles the result into a graph. You
        don&rsquo;t configure anything, and you don&rsquo;t install anything — it crawls the live site
        from the cloud while you watch the graph fill in.
      </p>
      <p>
        Crawl the version of the site that real visitors and Googlebot see — your production domain,
        not a staging URL behind a password. If your site has a <code>www</code> and a non-<code>www</code>{' '}
        version, audit the one your canonical URLs point to.
      </p>

      <h2>Step 2: Read the grade, then read the components</h2>
      <p>
        The letter grade is a fast gut check — useful for telling a client &ldquo;you&rsquo;re a C, here&rsquo;s
        why&rdquo; — but the four component scores are where the work is. A site can earn a respectable
        overall grade and still hide one ugly problem in a single component. Look at each one before you
        decide what to fix.
      </p>

      <h2>Step 3: Hunt down orphan pages first</h2>
      <p>
        Orphans are the highest-leverage fix in most audits because the remedy is trivial and the upside
        is real: a page that was getting zero internal links and zero organic traffic can start ranking
        within a crawl cycle once it&rsquo;s linked from somewhere relevant.
      </p>
      <p>
        Go through the orphaned pages and ask, for each one, &ldquo;which existing page <em>should</em>{' '}
        naturally link here?&rdquo; A product belongs in its category page and in related products. A
        blog post belongs in its topic hub and in older posts on the same subject. Add the link where a
        reader would actually expect it — not a dumped list of links in the footer.
      </p>

      <h2>Step 4: Flatten the pages buried too deep</h2>
      <p>
        Next, sort by depth and look at anything sitting five or more clicks from the homepage. Deep
        pages get crawled less often and inherit less authority, so important pages stranded down there
        are quietly underperforming.
      </p>
      <p>
        You rarely fix depth by adding more navigation. You fix it by adding contextual links from
        shallower, related pages, and by making sure your category and hub pages actually link to the
        pages beneath them. Pulling a page from depth six to depth three is often a single well-placed
        link.
      </p>

      <h2>Step 5: Check where your authority pools</h2>
      <p>
        Now look at the structure score and the hub pages it surfaces. You <em>want</em> concentration:
        a few pages that lots of other pages link to, which then pass that strength down to the pages
        that need to rank. This is the logic behind topic clusters and content siloing.
      </p>
      <p>
        The failure mode here is a site where every page links to every other page equally — usually
        because of a bloated mega-menu or a &ldquo;recent posts&rdquo; widget on every template. Link
        equity gets smeared evenly across hundreds of URLs instead of pooling where it matters. If your
        hubs aren&rsquo;t clearly stronger than your leaf pages, that&rsquo;s the signal.
      </p>

      <h2>Step 6: Spot the lazy anchors</h2>
      <p>
        Finally, skim the anchor-text diversity. You&rsquo;re looking for two problems: a wall of
        generic anchors (&ldquo;read more,&rdquo; &ldquo;click here,&rdquo; bare URLs), and the opposite —
        the exact same keyword-stuffed anchor repeated on every link to a page, which reads as
        manipulative. Aim for natural, descriptive variety: the anchor should tell a reader (and a
        crawler) what&rsquo;s on the other side of the link.
      </p>

      <h2>Turn the findings into a punch list</h2>
      <p>
        Don&rsquo;t try to fix everything. Rank the issues by leverage and start at the top:
      </p>
      <ol>
        <li>Link up orphaned pages that you actually want to rank.</li>
        <li>Pull your most important deep pages closer to the homepage.</li>
        <li>Strengthen the hub pages your money pages depend on.</li>
        <li>Rewrite the worst generic anchors as you touch each page.</li>
      </ol>
      <p>
        Make the changes, wait for your next crawl, and re-run the audit to confirm the graph actually
        improved. Internal linking is one of the few SEO levers where you can see the structural change
        immediately, rather than waiting weeks to read it in rankings.
      </p>

      <h2>When you outgrow a free audit</h2>
      <p>
        A free crawl is the right tool for understanding and fixing a site&rsquo;s internal structure,
        and for re-checking it after changes. If you&rsquo;re running enterprise-scale technical
        monitoring across hundreds of thousands of URLs, log-file analysis, or scheduled regression
        alerts, a desktop crawler or a cloud platform earns its price. For the question most people
        actually have — &ldquo;is my internal linking holding me back, and where?&rdquo; — you don&rsquo;t
        need any of that.
      </p>
      <p>
        Run the crawl, read the four components, fix the orphans and the deep pages first, and re-check.
        That&rsquo;s the whole audit.
      </p>
    </>
  );
}
