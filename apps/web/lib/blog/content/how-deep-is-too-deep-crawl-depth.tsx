import Link from 'next/link';
import type { Route } from 'next';

/** Body for /blog/how-deep-is-too-deep-crawl-depth. Rendered inside ArticleLayout's `.article-prose`. */
export function HowDeepIsTooDeepBody() {
  return (
    <>
      <p>
        You published a page weeks ago. It&rsquo;s genuinely good — useful, well-written, exactly what
        someone searching would want. And it&rsquo;s getting nothing. No rankings, barely any crawls,
        as if Google never noticed it exists. Before you blame the content, ask a simpler question:{' '}
        <strong>how many clicks does it take to reach that page from your homepage?</strong> If the
        answer is &ldquo;more than I&rsquo;d like,&rdquo; you&rsquo;ve probably found the problem.
      </p>
      <p>
        That number — clicks from the homepage — is the page&rsquo;s{' '}
        <Link href={'/blog/crawl-depth-site-architecture' as Route}>crawl depth</Link> (also called
        click depth). This guide answers the question everyone actually has once they understand it:
        not &ldquo;what is crawl depth,&rdquo; but <em>how deep is too deep</em> — and exactly what to
        do about the pages that have slipped too far.
      </p>

      <h2>What counts as &ldquo;too deep&rdquo;</h2>
      <p>
        Here&rsquo;s the honest version, because most articles oversimplify it. There is no universal
        number Google publishes, and depth is <strong>not a direct ranking penalty</strong>. A page
        doesn&rsquo;t get demoted for being at depth 5. What depth really is, is a{' '}
        <em>discovery cost</em>: the deeper a page sits, the less often it gets crawled, the less
        internal authority reaches it, and the longer it takes for changes to be noticed. Those costs
        compound until a page is effectively invisible — not penalized, just never found.
      </p>
      <p>
        So the threshold depends on your site&rsquo;s size, and the realistic guidance looks like this:
      </p>
      <ul>
        <li>
          <strong>Small sites (under ~1,000 pages):</strong> almost everything should sit within{' '}
          <strong>3 clicks</strong> of the homepage. If your blog or small store has pages at depth 5+,
          that&rsquo;s a structural problem you can fix, not a constraint you have to accept.
        </li>
        <li>
          <strong>Medium sites (1k–50k pages):</strong> aim for your important pages at depth 2–3 and
          the bulk of content within <strong>4 clicks</strong>. Some depth is unavoidable; uncontrolled
          depth isn&rsquo;t.
        </li>
        <li>
          <strong>Large sites (50k+ pages):</strong> a flat three-click architecture is impossible —
          you&rsquo;d need an unusable menu. Keep your <em>money pages</em> and pillar content at depth
          1–2, accept that long-tail pages live deeper, and use internal linking to keep depth 4–6 from
          sliding into depth 10+.
        </li>
      </ul>
      <p>
        The pattern across all three: <strong>depth should track importance.</strong> The pages you
        care about most should be the shallowest. The danger zone isn&rsquo;t &ldquo;any page past
        depth 3&rdquo; — it&rsquo;s an <em>important</em> page that has quietly drifted to depth 7.
      </p>

      <h2>Why &ldquo;more than three clicks&rdquo; became the warning sign</h2>
      <p>
        The famous &ldquo;three-click rule&rdquo; isn&rsquo;t a law, and there&rsquo;s nothing magic
        about the number three. But it persists for a sound reason: real data on visitor behavior and
        crawl frequency both fall off a cliff with depth. Roughly speaking, each click down loses a
        large share of the visitors who&rsquo;d have continued — and search engines mirror that, crawling
        pages near the homepage far more often than pages buried deep. Three clicks is just the point
        where, on most sites, the drop-off starts to bite. Treat it as a smoke alarm, not a building code.
      </p>

      <h2>The traps that bury pages without you noticing</h2>
      <p>
        Depth problems are rarely deliberate. They&rsquo;re side effects of structures that seemed
        reasonable at the time:
      </p>
      <ul>
        <li>
          <strong>Pagination chains.</strong> If older content is only reachable through &ldquo;page 2,
          page 3, … page 40&rdquo; of an archive, the posts on page 40 are effectively at depth 40.
          Blogs and stores bury enormous amounts of good content this way.
        </li>
        <li>
          <strong>Hubs that don&rsquo;t link down.</strong> A category page that exists but links to
          nothing useful strands everything beneath it. The hub is shallow; its children are orphaned in
          practice.
        </li>
        <li>
          <strong>Filters and parameters.</strong> Faceted navigation can spawn endless deep URLs that
          soak up crawl attention meant for your real pages.
        </li>
        <li>
          <strong>Links that need JavaScript to appear.</strong> This one is increasingly important and
          widely missed. If a link only shows up after a script runs — a &ldquo;Load more&rdquo; button,
          a client-rendered menu — then a crawler that doesn&rsquo;t execute that script never sees the
          link, and the page behind it is, to that crawler, at infinite depth.
        </li>
      </ul>

      <h2>The depth most people never check: what AI crawlers see</h2>
      <p>
        Here&rsquo;s a blind spot worth its own section. Google can render JavaScript, but the new wave
        of crawlers feeding AI answers — the bots behind ChatGPT, Claude, and Perplexity — largely{' '}
        <strong>don&rsquo;t execute JavaScript</strong>. They read your raw HTML and follow the links
        that are actually in it. So a page that&rsquo;s three clicks deep in your fancy JS-driven
        navigation might be <em>unreachable</em> to an AI crawler — effectively orphaned in the exact
        place a growing share of discovery now happens.
      </p>
      <p>
        That means &ldquo;how deep is my page&rdquo; now has two answers: how deep it is for a
        JavaScript-rendering crawler like Googlebot, and how deep it is in the raw, static HTML that AI
        crawlers (and, notably, the view Google indexes first) actually read. The static answer is the
        stricter one, and it&rsquo;s the one almost no one measures.
      </p>

      <h2>How to find your deep pages (you can&rsquo;t eyeball this)</h2>
      <p>
        Depth is a property of your whole link graph, not of any single page, so you can&rsquo;t guess
        it by looking at a URL — a page at <code>example.com/blog/2021/03/old-post</code> can be one
        click from home if your homepage links to it, while a short URL can be buried six clicks deep.
        You need a crawl that starts at the homepage and records the shortest click-path to every page.
      </p>
      <p>
        That&rsquo;s exactly what <Link href={{ pathname: '/' }}>Crawlmouse</Link> does: it crawls your
        live site the way a search engine would, computes the click depth of every page it finds, and
        rolls depth into your structure grade — so you can see, in under two minutes, which important
        pages have drifted too deep. Because it reads the <em>static</em> HTML, the depth it reports is
        the strict, AI-crawler-honest version, not a flattering one. Pair it with an{' '}
        <Link href={'/blog/orphan-pages' as Route}>orphan-page check</Link> — orphans are simply the
        extreme case, pages at infinite depth — and you&rsquo;ll have the full reachability picture.
      </p>

      <h2>How to pull a buried page back up</h2>
      <p>
        The fix for depth is never &ldquo;rewrite the URL.&rdquo; Depth is measured in links, so you fix
        it by changing what links to what. In rough order of impact:
      </p>
      <ol>
        <li>
          <strong>Link to it from a shallow, relevant page.</strong> A single contextual link from your
          homepage, a hub page, or a popular article can lift a page several levels in one move. This is
          the cheapest, highest-leverage fix you have.
        </li>
        <li>
          <strong>Strengthen your hub and category pages</strong> so they actually link down to the
          pages beneath them — and link up to those hubs from related content.
        </li>
        <li>
          <strong>Tame pagination.</strong> Surface key older content through hubs, &ldquo;related
          posts&rdquo; modules, or an HTML sitemap, instead of relying on a 40-page archive chain.
        </li>
        <li>
          <strong>Make sure the links are in the HTML, not just the JavaScript</strong> — so every
          crawler, including the AI ones, can actually follow them.
        </li>
        <li>
          <strong>For a genuinely urgent page,</strong> add a temporary homepage link (a &ldquo;New&rdquo;
          or &ldquo;Featured&rdquo; section). It moves the page to depth 1 instantly and gets it
          re-crawled in hours rather than weeks.
        </li>
      </ol>
      <p>
        Resist the temptation to fix depth by dumping every URL into your main navigation. That makes
        everything shallow and nothing important — it spreads your authority thin across hundreds of
        links instead of concentrating it where it counts. Good architecture is shallow where it
        matters and clearly organized everywhere else.
      </p>

      <h2>The fastest way to know where you stand</h2>
      <p>
        You don&rsquo;t need to map this by hand. Crawl your site, sort the pages by depth, and look at
        what&rsquo;s sitting past the threshold for your size — then pull the important ones up with a
        link or two and re-crawl to confirm. It&rsquo;s one of the few SEO changes whose effect you can
        see in your site&rsquo;s structure the moment you make it, long before the rankings catch up.
      </p>
      <p>
        If a page you care about is buried, the work that made it is already done. All that&rsquo;s
        missing is a path to it — and that&rsquo;s a fix you can ship today.
      </p>
    </>
  );
}
