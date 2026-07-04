import Link from 'next/link';
import type { Route } from 'next';
import { JsonLd, faqLd } from '../../seo/jsonld';
import type { FaqItem } from '../../seo/faq';

const FAQ: readonly FaqItem[] = [
  {
    question: 'What does "Discovered – currently not indexed" mean?',
    answer:
      'It means Google knows your URL exists — usually from your sitemap or an internal link — but has not crawled it yet, so it has not been added to the index. It is a crawl-priority delay, not a penalty, and it is very common on new or low-authority sites.',
  },
  {
    question: 'How is "Crawled – currently not indexed" different?',
    answer:
      'With "Crawled – currently not indexed", Google has already visited the page and made a deliberate decision not to index it. That points to a quality, duplication, or intent-match issue rather than a crawl-budget one, so it usually needs a content or structural fix, not just patience.',
  },
  {
    question: 'How do I fix "Discovered – currently not indexed"?',
    answer:
      'Start with internal linking, because weak links and orphan pages are among the most common causes. Add contextual internal links to the page from a few established, topically related pages, reduce how deep it sits from the homepage, keep your sitemap clean, and give the page a reason to be crawled. Repeatedly clicking "Request indexing" without structural changes rarely helps.',
  },
  {
    question: 'Do orphan pages cause indexing problems?',
    answer:
      'Yes — a page with no internal links pointing to it gives Google no signal that it matters, so it is often deprioritised in the crawl queue or left unindexed. Linking orphan pages from relevant, established pages is one of the most direct fixes for both "discovered" and "crawled" not-indexed statuses.',
  },
  {
    question: 'Does being indexed matter for AI search?',
    answer:
      'It does. ChatGPT, Claude, Perplexity, and similar systems draw on indexed web content to answer and cite sources. A page that is not indexed is largely invisible to them too, so the same fixes that help Google index a page also help it be discoverable in AI answers.',
  },
];

/** Body for /blog/discovered-currently-not-indexed. Rendered inside ArticleLayout's `.article-prose`. */
export function DiscoveredNotIndexedBody() {
  return (
    <>
      <div className="mb-8 rounded-2xl border border-oat bg-white p-6">
        <div className="text-xs font-semibold uppercase tracking-wide text-peach">Quick answer</div>
        <div className="mt-2 text-ink/80 leading-relaxed">
          &ldquo;Discovered &ndash; currently not indexed&rdquo; means Google knows your page exists but
          hasn&rsquo;t crawled it yet, so it&rsquo;s a crawl-priority problem, not a penalty. The most reliable
          fix is stronger internal linking: add contextual links to the page from established, related pages,
          reduce its click depth, and stop it being an orphan.
        </div>
      </div>

      <p>
        Few things in Search Console are as quietly maddening as a page that returns a clean 200, sits in your
        sitemap, has no errors — and still won&rsquo;t index. You submit it, you wait, you click{' '}
        &ldquo;Request indexing&rdquo; again, and nothing moves. Usually the culprit isn&rsquo;t a bug or a
        penalty. It&rsquo;s that Google hasn&rsquo;t been given a strong enough reason to prioritise the page —
        and the strongest reason you control is how your own site links to it.
      </p>

      <h2>What &ldquo;Discovered &ndash; currently not indexed&rdquo; actually means</h2>
      <p>
        This status means Google is aware of the URL — it found it via your sitemap or an internal link — but
        hasn&rsquo;t crawled it yet, so it hasn&rsquo;t evaluated the content and hasn&rsquo;t indexed it.
        Google&rsquo;s own framing is that the URL is known but scheduled for crawling later based on system
        priority. It is not a penalty; it&rsquo;s a priority delay. And if your site is new or still building
        authority — under a few months old especially — a lot of pages sitting in this state is normal. Google
        is rationing its crawl of your site until it has more reason to trust and prioritise it.
      </p>

      <h2>How is &ldquo;Crawled &ndash; currently not indexed&rdquo; different?</h2>
      <p>
        The two statuses look similar but sit at different stages. With <em>Discovered</em>, Google
        hasn&rsquo;t crawled the page yet. With <em>Crawled &ndash; currently not indexed</em>, Google has
        visited the page and made a deliberate choice not to index it — which points to a quality, duplication,
        or intent-match problem rather than a crawl-budget one. Roughly: <em>discovered</em> is usually a
        crawl-priority and internal-signal issue, while <em>crawled</em> is usually a &ldquo;this page
        didn&rsquo;t clear the bar&rdquo; issue. Neither is a penalty; both are Google being selective about
        what earns a place in a finite index.
      </p>

      <h2>Why Google skips your pages</h2>
      <p>
        The common causes, roughly in the order worth checking:
      </p>
      <ul>
        <li>
          <strong>Weak internal linking and orphan pages.</strong> A page with few or no internal links
          pointing to it gives Google no signal that it matters. <Link href={'/blog/orphan-pages' as Route}>
          Orphan pages</Link> — those with zero inbound internal links — are one of the most common and most
          fixable causes of both not-indexed statuses.
        </li>
        <li>
          <strong>Too much click depth.</strong> Pages buried four or five clicks from the homepage get
          crawled far less often. Keeping important pages shallow — via hubs and contextual links — raises
          their crawl priority. (More on <Link href={'/blog/crawl-depth-site-architecture' as Route}>crawl
          depth</Link>.)
        </li>
        <li>
          <strong>Sitemap-only discovery.</strong> A URL Google only knows from your sitemap, with no internal
          links reinforcing it, tends to sit low in the crawl queue. The sitemap says the page exists; internal
          links say it matters.
        </li>
        <li>
          <strong>Duplication and thin content</strong> (mostly for <em>crawled</em> cases). If the page
          closely mirrors another, or doesn&rsquo;t add much beyond what&rsquo;s already indexed, Google may
          crawl it and decline. Consolidate duplicates with canonicals and make sure the page earns its place.
        </li>
        <li>
          <strong>Slow or unreliable server, and low overall site authority.</strong> A slow site gets crawled
          more conservatively, and a young domain simply hasn&rsquo;t earned much crawl demand yet. Time and
          consistency help here.
        </li>
      </ul>

      <h2>How to fix it (start with internal linking)</h2>
      <p>
        The single most effective lever you control is internal linking, and it&rsquo;s the one most people
        skip in favour of hammering the &ldquo;Request indexing&rdquo; button. Requesting indexing without
        changing anything rarely works; strengthening the page&rsquo;s internal signals does. Concretely:
      </p>
      <ol>
        <li>
          <strong>Link the page from established, related pages.</strong> Find pages on your site that are
          already indexed and topically relevant, and add a contextual internal link to the stuck page with
          descriptive anchor text. Even a single strong internal link from a well-regarded page can change how
          Google weighs the target&rsquo;s importance. A useful trick: search{' '}
          <code>site:yourdomain.com &ldquo;your topic&rdquo;</code> to find natural linking spots.
        </li>
        <li>
          <strong>Pull the page shallower.</strong> If it&rsquo;s buried deep, add a link from a hub or a
          higher-level page so it sits within a few clicks of the homepage.
        </li>
        <li>
          <strong>Make it a publishing habit.</strong> Link every new page from two or three existing relevant
          pages on the day you publish, so it never enters the queue as an orphan.
        </li>
        <li>
          <strong>For &ldquo;crawled&rdquo; cases, raise the page&rsquo;s value.</strong> Expand thin content,
          add genuine information the indexed pages lack, and resolve duplication with canonicals — then
          request a re-crawl.
        </li>
      </ol>
      <p>
        Research consistently points the same way: strengthening internal linking can meaningfully raise how
        often Googlebot crawls a site, and pages that go from orphaned to well-linked are far more likely to be
        picked up. It won&rsquo;t force Google&rsquo;s hand — indexing is always Google&rsquo;s decision — but
        it removes the most common structural reason a good page gets skipped.
      </p>

      <h2>How to find which of your pages are affected</h2>
      <p>
        Start in Search Console under Indexing &rarr; Pages &rarr; &ldquo;Why pages aren&rsquo;t
        indexed&rdquo; to see the exact URLs in each status. That tells you <em>what&rsquo;s</em> stuck; to fix
        it you need to know <em>why</em> — which of those pages are orphaned or buried. Crawling your own site
        surfaces that directly. <Link href={{ pathname: '/' }}>Crawlmouse</Link> maps your internal-link graph
        and flags the pages with zero inbound links and the ones sitting too deep — the exact structural causes
        behind most &ldquo;not indexed&rdquo; statuses — for free, in the browser. Cross-reference that orphan
        and depth list against your not-indexed URLs, and the fixes usually name themselves. (It&rsquo;s the
        same crawl behind a full <Link href={'/blog/free-internal-link-audit' as Route}>internal-link
        audit</Link>.)
      </p>

      <h2>Does this matter for AI search too?</h2>
      <p>
        Increasingly, yes. ChatGPT, Claude, Perplexity, and other AI systems lean on indexed web content to
        answer questions and cite sources. A page that never gets indexed is largely invisible to them as well
        as to Google. The reassuring part is that the fixes overlap almost entirely: clear internal linking, a
        sensible structure, and pages worth keeping are what earn a place in Google&rsquo;s index <em>and</em>{' '}
        a citation in an AI answer. And because tools like Crawlmouse grade the static HTML — what a
        non-rendering AI crawler actually sees — you&rsquo;re fixing the site both audiences read.
      </p>
      <p>
        You can&rsquo;t make Google index a page. What you can do is remove every structural excuse for it not
        to — link it well, keep it shallow, make it worth keeping — and give a young site the time it needs to
        earn the crawl.
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
