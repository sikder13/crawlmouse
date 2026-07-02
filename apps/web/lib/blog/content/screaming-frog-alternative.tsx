import Link from 'next/link';
import type { Route } from 'next';
import { JsonLd, faqLd } from '../../seo/jsonld';
import type { FaqItem } from '../../seo/faq';

const FAQ: readonly FaqItem[] = [
  {
    question: 'Is there a free alternative to Screaming Frog?',
    answer:
      "Yes, for internal-linking audits specifically. Crawlmouse is a free, browser-based tool that crawls your site, maps its internal links, and grades the structure — with no install and no 500-URL cap on the structure view. It is focused on internal linking rather than a full technical-SEO suite.",
  },
  {
    question: 'Do I have to install Screaming Frog?',
    answer:
      'Screaming Frog is a desktop application you download and run on Windows, macOS, or Linux, and its free version crawls up to 500 URLs. A browser-based alternative runs in the browser with nothing to install, which is faster to start and works on any device.',
  },
  {
    question: 'Is Crawlmouse a full replacement for Screaming Frog?',
    answer:
      'No, and it is honest to say so. Screaming Frog is a broad technical-SEO crawler that checks hundreds of things — redirects, metadata, duplicate content, images, and more. Crawlmouse focuses on one job: auditing and grading internal-link structure. Use the suite for breadth, the focused tool for a fast internal-linking answer.',
  },
  {
    question: 'How much does Screaming Frog cost?',
    answer:
      'The SEO Spider is free for up to 500 URLs per crawl. To remove that limit and unlock advanced features you buy an annual per-user licence (around £199 / $259 per year at the time of writing). Pricing can change, so check their site for the current figure.',
  },
  {
    question: 'Which should I use, Screaming Frog or a browser tool?',
    answer:
      'Use Screaming Frog when you need a deep, all-in-one technical audit and are comfortable with a desktop tool. Use a free browser-based grader when you specifically want to check internal linking quickly, on any device, without an install or a licence.',
  },
];

/** Body for /blog/screaming-frog-alternative. Rendered inside ArticleLayout's `.article-prose`. */
export function ScreamingFrogAlternativeBody() {
  return (
    <>
      <div className="mb-8 rounded-2xl border border-oat bg-white p-6">
        <div className="text-xs font-semibold uppercase tracking-wide text-peach">Quick answer</div>
        <div className="mt-2 text-ink/80 leading-relaxed">
          If you want a free Screaming Frog alternative specifically for internal linking, Crawlmouse crawls
          your site in the browser, maps its internal links, and grades the structure — with no install and no
          500-URL cap on the structure view. Screaming Frog is the broader technical-SEO crawler; Crawlmouse is
          the focused, no-install internal-linking grader.
        </div>
      </div>

      <p>
        Screaming Frog&rsquo;s SEO Spider is a genuinely great tool — a fixture of technical SEO for a reason.
        But it isn&rsquo;t always the right tool for the job in front of you. It&rsquo;s a desktop application
        you download and install, the free version stops at 500 URLs per crawl, and the full feature set sits
        behind an annual per-user licence. If what you actually need is a quick, clear read on your{' '}
        <Link href={'/blog/crawl-depth-site-architecture' as Route}>internal-link structure</Link> — not the
        entire technical-SEO kitchen sink — that&rsquo;s a lot of setup for one answer. Here&rsquo;s an honest
        look at a lighter alternative, and when each one is the right call.
      </p>

      <h2>What Screaming Frog is great at (and what it costs you)</h2>
      <p>
        Screaming Frog crawls your site like a search engine and surfaces hundreds of technical issues:
        broken links, redirects and redirect chains, duplicate content, missing or duplicated metadata,
        image and alt-text problems, XML sitemap generation, and much more. For a full technical audit,
        it&rsquo;s hard to beat. The trade-offs are real, though: it&rsquo;s a desktop install (Windows,
        macOS, or Linux), the free tier caps at 500 URLs per crawl and locks saved crawls, configuration, and
        integrations, and removing those limits means an annual per-user licence (around £199 / $259 at the
        time of writing). For an agency running deep audits daily, that&rsquo;s easily worth it. For someone
        who just wants to know whether their internal linking is holding their pages back, it&rsquo;s a lot of
        weight.
      </p>

      <h2>The lighter alternative: a browser-based internal-linking grader</h2>
      <p>
        <Link href={{ pathname: '/' }}>Crawlmouse</Link> takes the opposite approach. You paste a URL and it
        crawls the live site in the browser — nothing to download, no licence, no per-seat cost, works on any
        device including your phone. It maps the internal-link graph and returns a single A&ndash;F grade plus
        the specific problems behind it: orphan pages, pages buried too deep, weak hubs, and thin anchor text.
        Where the desktop crawler hands you a dense spreadsheet to interpret, a grader hands you a verdict and
        a prioritised list. For the internal-linking question, that&rsquo;s often all you need — and you have
        it in under two minutes.
      </p>
      <p>
        There&rsquo;s one more difference that matters in 2026. A browser grader that reads the{' '}
        <em>static</em> HTML your server returns is showing you the exact site a non-rendering AI crawler —
        the bots behind ChatGPT, Claude, and Perplexity — actually sees. Links that only appear after
        JavaScript runs are invisible to those crawlers, and a static-HTML grade catches them.
      </p>

      <h2>Where an internal-linking grader stops (the honest limits)</h2>
      <p>
        A focused tool is focused. Crawlmouse won&rsquo;t give you Screaming Frog&rsquo;s full technical
        sweep — it isn&rsquo;t a broken-link auditor, a metadata checker, a redirect mapper, or an
        image-optimisation report, and it won&rsquo;t replace the Spider for a comprehensive site audit. It
        does one thing: audit and grade internal-link structure, well and for free. If you need the whole
        technical picture, use Screaming Frog (or run both). If the internal linking is what you&rsquo;re
        chasing, the focused tool gets you there faster.
      </p>

      <h2>Which should you use?</h2>
      <ul>
        <li>
          <strong>Reach for Screaming Frog</strong> when you need a deep, all-in-one technical audit, you
          crawl large sites regularly, or you want redirects, metadata, and duplicate-content checks in one
          desktop tool — and you&rsquo;re fine installing software and paying for the licence.
        </li>
        <li>
          <strong>Reach for a free browser grader</strong> when you specifically want to{' '}
          <Link href={'/blog/free-internal-link-audit' as Route}>check your internal linking</Link>, you want
          a plain grade rather than a raw export, you&rsquo;re on a phone or a locked-down work machine, or
          you just want the answer now without an install or a licence.
        </li>
      </ul>
      <p>
        They&rsquo;re not really competitors so much as different-sized tools for different jobs. The best
        move is often to start with the free grade to see whether internal linking is even your problem — and
        reach for the heavier crawler only if the audit tells you to.
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
