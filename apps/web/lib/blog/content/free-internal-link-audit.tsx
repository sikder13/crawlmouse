import Link from 'next/link';
import type { Route } from 'next';
import { JsonLd, faqLd } from '../../seo/jsonld';
import type { FaqItem } from '../../seo/faq';

const FAQ: readonly FaqItem[] = [
  {
    question: 'What is an internal link checker?',
    answer:
      'An internal link checker crawls your site, maps how your pages link to each other, and reports problems in that structure — orphan pages with no inbound links, pages buried many clicks from the homepage, weak hub pages, and repetitive or generic anchor text.',
  },
  {
    question: 'How do I check my internal links for free?',
    answer:
      'Paste your URL into a free browser-based checker like Crawlmouse. It crawls the live site, builds the internal-link graph, and grades the structure in under two minutes — no account, no install, and nothing to configure.',
  },
  {
    question: 'What does a good internal link audit measure?',
    answer:
      'Four things: orphan pages (no inbound internal links), click depth (how far pages sit from the homepage), anchor-text diversity, and how authority flows through your hubs. Together these show whether search engines and readers can actually reach and understand your pages.',
  },
  {
    question: 'Do I need Screaming Frog or Semrush to audit internal links?',
    answer:
      'No. Those are powerful, broad tools, but Screaming Frog is a desktop install capped at 500 URLs free and Semrush is a paid subscription. If you specifically want to check and grade your internal linking, a free browser tool does that with nothing to install.',
  },
  {
    question: 'How often should I audit internal links?',
    answer:
      'Re-check after any migration, redesign, or busy publishing stretch, and periodically otherwise — quarterly for a small site, monthly for a larger or fast-publishing one. Internal-linking problems creep back every time the site changes.',
  },
];

/** Body for /blog/free-internal-link-audit. Rendered inside ArticleLayout's `.article-prose`. */
export function FreeInternalLinkAuditBody() {
  return (
    <>
      <div className="mb-8 rounded-2xl border border-oat bg-white p-6">
        <div className="text-xs font-semibold uppercase tracking-wide text-peach">Quick answer</div>
        <div className="mt-2 text-ink/80 leading-relaxed">
          To check your internal links for free, paste your URL into a browser-based checker like Crawlmouse.
          It crawls your live site, maps how every page links to every other, and grades the structure — flagging
          orphan pages, pages buried too deep, and weak hubs — in under two minutes, with no account or install.
        </div>
      </div>

      <p>
        Internal links are the quiet half of SEO. Backlinks get all the attention, but the links{' '}
        <em>within</em> your own site are what let search engines discover your pages, understand how they
        relate, and decide which ones matter. When that internal structure is weak, good pages go unfound —
        and you can&rsquo;t fix what you can&rsquo;t see. An internal-link check makes it visible. The good
        news: you don&rsquo;t need a paid crawler or a desktop install to run one.
      </p>

      <h2>What an internal link checker actually does</h2>
      <p>
        You can&rsquo;t judge internal linking by looking at one page, because it&rsquo;s a property of the
        whole <Link href={'/blog/crawl-depth-site-architecture' as Route}>link graph</Link> — which page
        points to which, and how authority flows across the network. A checker crawls your site the way a
        search engine would, follows every internal link, builds that graph, and then reports where
        it&rsquo;s broken. The useful ones don&rsquo;t just dump a spreadsheet of links; they turn the graph
        into findings you can act on.
      </p>

      <h2>What a good internal link audit measures</h2>
      <p>Four signals do most of the work, and a solid checker reports all four:</p>
      <ul>
        <li>
          <strong>Orphan pages.</strong> Pages with no inbound internal links at all. Crawlers rarely find
          them and readers can&rsquo;t click to them, so the work sits unread. (See the deeper guide on{' '}
          <Link href={'/blog/orphan-pages' as Route}>finding orphan pages</Link>.)
        </li>
        <li>
          <strong>Click depth.</strong> How many clicks a page sits from the homepage. Pages buried deep get
          crawled less and earn less internal authority. Depth should track importance — your key pages
          should be the shallowest.
        </li>
        <li>
          <strong>Anchor text.</strong> Whether your internal links use descriptive, varied anchors or a sea
          of &ldquo;click here&rdquo; and &ldquo;read more.&rdquo; Anchor text tells search engines what the
          target page is about.
        </li>
        <li>
          <strong>Hub strength and authority flow.</strong> Whether a few well-connected hub pages
          concentrate and pass authority to the pages beneath them, or whether it&rsquo;s spread thin across
          hundreds of equal links.
        </li>
      </ul>

      <h2>How to run a free internal-link audit, step by step</h2>
      <p>The whole process, with nothing to install:</p>
      <ol>
        <li>
          <strong>Crawl the site.</strong> Paste your URL into{' '}
          <Link href={{ pathname: '/' }}>Crawlmouse</Link>. It crawls the live site, builds the internal-link
          graph, and returns a single A&ndash;F grade plus the specific problems behind it — in the browser,
          no account or download.
        </li>
        <li>
          <strong>Read the grade, then the findings.</strong> The grade is the headline; the value is in the
          list underneath — the orphans, the deep pages, the weak hubs. Start where the impact is highest.
        </li>
        <li>
          <strong>Fix the cheap, high-leverage problems first.</strong> A single contextual link from a
          shallow, relevant page can lift a buried page several levels and rescue an orphan in one move.
        </li>
        <li>
          <strong>Re-crawl to confirm.</strong> Internal-linking fixes are one of the few SEO changes whose
          effect you can see in your site&rsquo;s structure immediately, long before rankings catch up. Run
          it again and watch the grade move.
        </li>
      </ol>

      <h2>Free checker vs. Screaming Frog vs. Semrush</h2>
      <p>
        The big desktop and suite tools are genuinely powerful and do far more than internal linking — but
        they carry a cost and a setup tax. Screaming Frog is a desktop install whose free version stops at
        500 URLs, with the deeper reports behind an annual per-user licence. Semrush is a full paid
        subscription. If what you actually need right now is to <em>check and grade your internal linking</em>,
        a free browser tool does exactly that with nothing to install, no seat licence, and no 500-URL wall
        for the structure view. Reach for the heavy suites when you need their breadth; reach for a focused
        free checker when you need the internal-linking answer fast. (More on the{' '}
        <Link href={'/blog/screaming-frog-alternative' as Route}>no-install alternative</Link>.)
      </p>

      <h2>One honest note on what a checker can and can&rsquo;t promise</h2>
      <p>
        An internal-link audit improves <em>discoverability</em> — whether your pages can be found, crawled,
        and understood. It doesn&rsquo;t guarantee rankings; nothing honestly can. What it does is remove the
        structural reasons a good page fails to rank, so the content you already made gets a fair chance. One
        more reason it matters now: the AI crawlers behind ChatGPT, Claude, and Perplexity read your raw HTML
        and follow the links in it. A checker that grades the static HTML shows you the site those crawlers
        actually see — which is increasingly where discovery happens.
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
