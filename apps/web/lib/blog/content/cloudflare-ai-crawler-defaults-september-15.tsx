import Link from 'next/link';
import type { Route } from 'next';
import { JsonLd, faqLd } from '../../seo/jsonld';
import type { FaqItem } from '../../seo/faq';

const FAQ: readonly FaqItem[] = [
  {
    question: 'Will Cloudflare block Googlebot on September 15?',
    answer:
      'Not for most sites. It can happen in one specific scenario: a zone that blocks Training crawlers, on pages showing ads, where the multi-purpose rule then applies the strictest policy to Googlebot because it crawls for both search and AI training. Sites that make explicit allow choices for Googlebot are not affected.',
  },
  {
    question: 'Does this apply to my site if I don\u2019t run ads?',
    answer:
      'The new September 15 defaults apply to pages that display ads. Pages without ads aren\u2019t touched by the ad-scoped default \u2014 though site owners can choose to block on all pages if they want to.',
  },
  {
    question: 'I\u2019m on a paid Cloudflare plan. Am I affected?',
    answer:
      'Per Cloudflare\u2019s announcement, the automatic default change targets new domains, new sites on existing accounts, and free-plan customers with unchanged settings. Paid zones with configured settings keep them \u2014 but if you ever enabled the legacy \u201CBlock AI bots\u201D toggle, review it, because it\u2019s reinterpreted under the new classification.',
  },
  {
    question: 'How do I know if AI crawlers can actually read my site?',
    answer:
      'Check three layers: your served robots.txt, any edge/CDN rules above it, and whether your content is readable without JavaScript. Run a free Crawlmouse audit to check all three across your whole site in one pass.',
  },
];

/** Body for /blog/cloudflare-ai-crawler-defaults-september-15. Rendered inside ArticleLayout's `.article-prose`. */
export function CloudflareAiCrawlerDefaultsBody() {
  return (
    <>
      <p>
        On September 15, 2026, Cloudflare changes what happens to AI crawlers on a large slice of the web
        &mdash; by default, without site owners touching anything. If your site runs through Cloudflare, or
        your clients&rsquo; sites do, this is worth ten minutes before the deadline. If you care about showing
        up in AI answers, it&rsquo;s worth twenty.
      </p>
      <p>
        Here is what actually changes, who it affects, and how to check where your site stands &mdash; from
        inside the dashboard and from the outside, the way a crawler sees it.
      </p>

      <h2>What changes on September 15</h2>
      <p>
        Cloudflare announced the change on July 1, 2026. The old one-click &ldquo;Block AI bots&rdquo; toggle
        is being replaced by three independent categories, each with its own policy:
      </p>
      <ul>
        <li>
          <strong>Search</strong> &mdash; crawlers that collect or index content to answer questions later.
          Think classic search indexing.
        </li>
        <li>
          <strong>Agent</strong> &mdash; automated fetches made in real time on a person&rsquo;s behalf, such
          as an assistant opening your page to answer a question someone just asked.
        </li>
        <li>
          <strong>Training</strong> &mdash; crawlers collecting content to train or fine-tune AI models.
        </li>
      </ul>
      <p>
        Starting September 15, the default settings change: <strong>Training and Agent crawlers are blocked
        by default on pages that display ads</strong>, while Search crawlers stay allowed. Per
        Cloudflare&rsquo;s announcement, the new defaults apply to new domains joining Cloudflare, new sites
        added by existing customers, and existing free-plan customers who haven&rsquo;t changed their
        settings. Site owners can opt out &mdash; or opt in harder &mdash; in the dashboard at any time.
      </p>
      <p>Two details in the fine print matter more than the headline.</p>

      <h2>Detail one: the Googlebot trap</h2>
      <p>
        Some crawlers do more than one job. Googlebot, Bingbot, and Applebot all crawl both for search
        indexing and for AI purposes. Cloudflare&rsquo;s new rule treats these multi-purpose crawlers under
        the <strong>strictest applicable policy</strong>: if your zone blocks Training, a crawler that does
        Search <em>and</em> Training gets blocked entirely &mdash; even though Search is allowed.
      </p>
      <p>
        Read that again, because it&rsquo;s the part that will surprise people in October: a site that blocks
        AI training can end up blocking Googlebot itself on the affected pages. Coverage from Search Engine
        Journal at the time of the announcement flagged exactly this scenario, and Cloudflare&rsquo;s own
        documentation confirms the strictest-rule behavior. If you enabled the old &ldquo;Block AI
        bots&rdquo; toggle at some point and never revisited it, that legacy setting is folded into the new
        classification &mdash; a choice that felt safe in 2025 can behave differently after September 15.
      </p>

      <h2>Detail two: the Agent block, or how to vanish from AI answers by accident</h2>
      <p>
        Almost all coverage of this change is written for publishers who want to keep AI <em>out</em>. But
        flip it around. When someone asks an AI assistant a question and the assistant reads your page to
        compose its answer, that live fetch is <strong>Agent</strong> traffic &mdash; and Agent is blocked by
        default on ad pages under the new settings.
      </p>
      <p>
        So picture a business that runs display ads, sits on a Cloudflare free plan, and has spent this year
        trying to show up in AI answers. On September 15, its zone quietly inherits the new defaults. The
        assistant that used to be able to open its pages now gets turned away at the network edge. No error
        on the site. No warning email from the AI company. The site simply stops being readable at the moment
        of the question &mdash; which is the moment that matters.
      </p>
      <p>
        If AI visibility is something you want rather than something you&rsquo;re defending against, the new
        defaults are a setting you need to make deliberately, not inherit.
      </p>

      <h2>Who is affected &mdash; and who isn&rsquo;t</h2>
      <p>
        You&rsquo;re in scope for the new defaults if all of these are true: the site is behind Cloudflare
        (orange-cloud, proxied), it&rsquo;s a new domain, a new site on an existing account, or on the free
        plan with unchanged settings, and the pages in question display ads &mdash; Cloudflare detects ad
        units automatically.
      </p>
      <p>
        Nothing changes automatically for: sites not on Cloudflare, sites whose DNS runs through Cloudflare
        but unproxied (grey-cloud &mdash; the edge never sees the traffic), paid-plan zones with settings
        already configured, and pages without ads. And one more thing worth stating plainly: this enforcement
        happens at Cloudflare&rsquo;s network layer, before a request reaches your server. Unlike robots.txt,
        which is advisory and only binds crawlers polite enough to obey it, an edge block stops the request
        itself.
      </p>

      <h2>How to check your settings (inside)</h2>
      <p>
        Log into the Cloudflare dashboard, pick the zone, and go to <strong>Security → Settings → Configure
        AI bot policies</strong> (naming at the time of writing; Cloudflare has been renaming this area as
        the feature rolls out). You&rsquo;ll see the three categories. For each one, the options are block on
        all pages, block only on pages with ads, or don&rsquo;t block.
      </p>
      <p>
        Make an explicit choice for all three and save it. A recorded choice is exempt from default flips
        &mdash; the September 15 change only moves zones that never chose. If your business depends on
        specific crawlers, set explicit allows for them rather than relying on category defaults, and check
        your logs in the week after the 15th.
      </p>

      <h2>How to check what crawlers actually experience (outside)</h2>
      <p>
        Here&rsquo;s the part the dashboard can&rsquo;t tell you: what your site <em>serves</em> and what a
        crawler <em>experiences</em> are two different layers, and they can disagree. Your robots.txt can say
        allow while an edge rule says block. Your pages can be perfectly crawlable and still be unreadable to
        AI systems for a completely different reason &mdash; because the content only exists after JavaScript
        runs, and{' '}
        <Link href={'/blog/can-ai-crawlers-see-javascript' as Route}>
          AI crawlers don&rsquo;t render JavaScript
        </Link>
        .
      </p>
      <p>
        This isn&rsquo;t a rare setup. Across the sites audited on Crawlmouse, roughly one in three sits
        behind a detected edge or CDN layer whose rules can override whatever robots.txt declares. For those
        sites, reading robots.txt tells you the site&rsquo;s stated policy &mdash; not its behavior.
      </p>
      <p>So the outside check has three parts:</p>
      <ol>
        <li>
          <strong>Read your served robots.txt</strong> &mdash; the file your domain actually returns today,
          not the one in your repo. If you use Cloudflare&rsquo;s managed robots.txt, directives are injected
          at the edge, and after September 15 you may find declarations there you didn&rsquo;t write,
          including the extended Content Signals <code>use</code> parameter Cloudflare is rolling out.
        </li>
        <li>
          <strong>Check per-crawler access</strong> &mdash; whether GPTBot, ClaudeBot, PerplexityBot and the
          rest are allowed, disallowed, or unmentioned, and whether the retrieval bots (the ones that fetch
          pages to answer live questions) are treated differently from the training ones. Our guide to{' '}
          <Link href={'/blog/block-ai-crawlers-robots-txt' as Route}>
            blocking or allowing AI crawlers in robots.txt
          </Link>{' '}
          walks through every major bot token.
        </li>
        <li>
          <strong>Look at what a crawler can actually read</strong> &mdash; a page that&rsquo;s reachable but
          empty without JavaScript is invisible in practice, whatever the access rules say.
        </li>
      </ol>
      <p>
        A <Link href={{ pathname: '/' }}>free Crawlmouse audit</Link> runs all three checks across your whole
        site: the per-bot access matrix, a note when an edge/CDN layer is detected that could override
        robots.txt, and a page-by-page view of what&rsquo;s readable without JavaScript. It takes about the
        time it took to read this section.
      </p>

      <h2>What to do, by situation</h2>
      <p>
        <strong>You want AI visibility and you run ads on a Cloudflare free plan:</strong> act before
        September 15. Make explicit choices in the AI bot policies panel &mdash; at minimum, decide
        deliberately whether Agent stays allowed. Then verify from the outside after the 15th.
      </p>
      <p>
        <strong>You want AI visibility and you&rsquo;re grey-cloud or not on Cloudflare:</strong> nothing
        changes for you on the 15th, but this is a good excuse to verify your actual crawler access anyway
        &mdash; most sites have never checked.
      </p>
      <p>
        <strong>You want AI crawlers out:</strong> the new controls are genuinely better than the old toggle
        &mdash; you can now block Training while keeping Search, which the one-click block couldn&rsquo;t do.
        Just mind the multi-purpose rule: blocking Training can take Googlebot with it on ad pages. If Google
        traffic matters to you, set an explicit allow for the crawlers you depend on and watch your logs
        after the deadline.
      </p>
      <p>
        <strong>You manage client sites:</strong> this is a before-and-after moment. A crawler-access check
        on every client zone this week, and again the week after the 15th, will catch any zone that inherited
        defaults nobody chose.
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

      <p className="mt-10 text-sm text-ink/60">
        <em>
          Sources: Cloudflare&rsquo;s July 1, 2026 announcement and developer documentation on the September
          15 default changes; Search Engine Journal&rsquo;s coverage of the multi-purpose crawler rule (July
          2026); Help Net Security&rsquo;s summary of the Content Signals extension (July 2, 2026). Policy
          details are as published at the time of writing &mdash; September 6, 2026 &mdash; and Cloudflare
          may adjust naming or scope; check your own dashboard for the current state of your zone.
        </em>
      </p>

      <JsonLd data={faqLd(FAQ)} />
    </>
  );
}
