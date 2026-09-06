import Link from 'next/link';
import type { Route } from 'next';
import { JsonLd, faqLd } from '../../seo/jsonld';
import type { FaqItem } from '../../seo/faq';

const FAQ: readonly FaqItem[] = [
  {
    question: 'Should I block AI crawlers in robots.txt?',
    answer:
      'It depends on which crawler and what you want. Blocking training bots (GPTBot, ClaudeBot, CCBot) keeps your content out of future model training without affecting your visibility. Blocking search/retrieval bots (OAI-SearchBot, Claude-SearchBot, PerplexityBot) removes you from AI search answers \u2014 OpenAI states sites that block OAI-SearchBot will not appear in ChatGPT search results. Decide the two questions separately.',
  },
  {
    question: 'What is the difference between GPTBot and OAI-SearchBot?',
    answer:
      'GPTBot collects content for training OpenAI\u2019s models. OAI-SearchBot fetches pages to surface in ChatGPT\u2019s search answers. They honor separate robots.txt rules, so you can block training while staying visible in ChatGPT search \u2014 or vice versa. Conflating them is the most common mistake in AI-era robots.txt files, and blocking the wrong one silently removes you from an answer channel.',
  },
  {
    question: 'Does blocking AI crawlers in robots.txt actually work?',
    answer:
      'Mostly, with caveats. robots.txt is a voluntary convention: the major operators (OpenAI, Anthropic, Google, Microsoft) document compliance, while some crawlers \u2014 ByteDance\u2019s Bytespider has been repeatedly reported as an offender \u2014 ignore it. Blocking also is not retroactive: content already collected in past crawls or in Common Crawl snapshots does not get removed. For enforcement rather than requests, CDN-level blocking (e.g. Cloudflare) actually refuses the connection.',
  },
  {
    question: 'Will blocking GPTBot hurt my Google rankings?',
    answer:
      'No. GPTBot is OpenAI\u2019s bot and has nothing to do with Google Search. Googlebot is controlled separately, and Google\u2019s AI training opt-out (Google-Extended) is a separate robots.txt token that does not affect Search either. What blocking GPTBot does affect: your content\u2019s presence in future OpenAI model training.',
  },
  {
    question: 'What is Cloudflare doing about AI crawlers in 2026?',
    answer:
      'Cloudflare has blocked AI crawlers by default on newly onboarded domains since July 1, 2025, and announced that from September 15, 2026 it will also block \u201Cmixed-use\u201D AI crawlers by default on pages carrying ads, alongside a \u201CPay Per Use\u201D model that compensates publishers when content surfaces in AI answers. Practical takeaway: if your site is behind Cloudflare, check what is being blocked on your behalf \u2014 you may be blocking AI search bots you want.',
  },
  {
    question: 'How do I check which AI crawlers are visiting my site?',
    answer:
      'Grep your server or CDN logs for the user-agents: GPTBot, OAI-SearchBot, ChatGPT-User, ClaudeBot, Claude-SearchBot, PerplexityBot, Meta-ExternalAgent, Amazonbot, Bytespider, CCBot. If the search-focused bots are absent entirely, check robots.txt and your CDN\u2019s bot settings before assuming they are not interested \u2014 an inherited block is the most common cause.',
  },
];

/** Body for /blog/block-ai-crawlers-robots-txt. Rendered inside ArticleLayout's `.article-prose`. */
export function BlockAiCrawlersRobotsTxtBody() {
  return (
    <>
      <div className="mb-8 rounded-2xl border border-oat bg-white p-6">
        <div className="text-xs font-semibold uppercase tracking-wide text-peach">Quick answer</div>
        <div className="mt-2 text-ink/80 leading-relaxed">
          Don&rsquo;t decide &ldquo;AI crawlers: yes or no.&rdquo; Decide two separate questions.{' '}
          <strong>Training bots</strong> (GPTBot, ClaudeBot, CCBot) collect content for future models &mdash;
          blocking them costs you no visibility. <strong>Search bots</strong> (OAI-SearchBot,
          Claude-SearchBot, PerplexityBot) fetch pages to cite in AI answers &mdash; blocking them removes
          you from those answers. Most sites that want AI visibility should allow the search bots, choose
          deliberately on the training bots, and &mdash; especially behind Cloudflare &mdash; verify
          nothing is being blocked on their behalf.
        </div>
      </div>

      <p>
        A quarter of the web&rsquo;s biggest sites now block OpenAI&rsquo;s training crawler &mdash; about
        25% of the top 1,000 websites per Originality.ai&rsquo;s tracking, up from 5% when GPTBot launched in
        2023. Cloudflare blocks AI crawlers by default for new domains, and from September 15, 2026 extends
        default blocking to &ldquo;mixed-use&rdquo; AI crawlers on ad-supported pages. Blocking has become
        the fashionable default &mdash; and that&rsquo;s exactly why it&rsquo;s worth slowing down, because
        the single most common mistake in AI-era robots.txt files is blocking bots whose job is to{' '}
        <em>send you visibility</em> while trying to opt out of training. This guide separates the bots by
        what they actually do, gives you copy-paste rules for each stance, and covers what blocking can and
        cannot achieve. Facts verified August 2026.
      </p>

      <h2>Update &mdash; September 15, 2026: Cloudflare changes its defaults</h2>
      <p>
        If your site runs through Cloudflare, robots.txt is no longer the whole story. From September 15,
        2026, Cloudflare blocks Training and Agent crawlers by default on pages that display ads &mdash; for
        new domains, new sites on existing accounts, and free-plan zones with unchanged settings &mdash; and
        enforces it at the network edge, above robots.txt. We&rsquo;ve covered what changes, the
        multi-purpose crawler rule that can catch Googlebot, and how to check your site in our guide to{' '}
        <Link href={'/blog/cloudflare-ai-crawler-defaults-september-15' as Route}>
          Cloudflare&rsquo;s September 15 AI crawler defaults
        </Link>
        .
      </p>

      <h2>Know what each bot does before you block it</h2>
      <p>
        The decision only makes sense per-purpose. Three categories cover the bots that matter:
      </p>
      <table className="w-full border-collapse text-sm">
        <thead>
          <tr className="border-b-2 border-oat text-left">
            <th className="py-2 pr-3 font-semibold text-ink">Category</th>
            <th className="py-2 pr-3 font-semibold text-ink">Bots (user-agents)</th>
            <th className="py-2 font-semibold text-ink">What blocking costs you</th>
          </tr>
        </thead>
        <tbody className="text-ink/80">
          <tr className="border-b border-oat">
            <td className="py-2 pr-3 font-medium text-ink">Training</td>
            <td className="py-2 pr-3">GPTBot, ClaudeBot, Meta-ExternalAgent, Bytespider, CCBot, Google-Extended*</td>
            <td className="py-2">Nothing visible today; your content stays out of future model training</td>
          </tr>
          <tr className="border-b border-oat">
            <td className="py-2 pr-3 font-medium text-ink">AI search / retrieval</td>
            <td className="py-2 pr-3">OAI-SearchBot, Claude-SearchBot, PerplexityBot, Amazonbot, Applebot</td>
            <td className="py-2">Presence in AI search answers &amp; citations</td>
          </tr>
          <tr className="border-b border-oat">
            <td className="py-2 pr-3 font-medium text-ink">User-triggered fetch</td>
            <td className="py-2 pr-3">ChatGPT-User, Claude-User</td>
            <td className="py-2">The assistant can&rsquo;t open your page when a user asks it to</td>
          </tr>
        </tbody>
      </table>
      <p className="mt-4">
        *Google-Extended is a robots.txt control token rather than a crawler &mdash; it opts your content out
        of Gemini training without affecting Google Search. That&rsquo;s the model to keep in mind
        everywhere: <strong>training and visibility are separate switches.</strong> OpenAI&rsquo;s own
        documentation states that sites blocking OAI-SearchBot will not be shown in ChatGPT search results
        &mdash; while blocking GPTBot has no effect on ChatGPT search at all. (What these bots can{' '}
        <em>read</em> once you allow them is its own topic: most execute no JavaScript, which we cover in{' '}
        <Link href={'/blog/can-ai-crawlers-see-javascript' as Route}>Can AI Crawlers See Your JavaScript
        Site?</Link>)
      </p>

      <h2>Copy-paste robots.txt for the three sensible stances</h2>
      <p>
        <strong>Stance 1 &mdash; visible everywhere, out of training.</strong> The most popular deliberate
        setup: appear in ChatGPT, Claude, and Perplexity answers, contribute nothing to model training.
      </p>
      <pre>
        <code>{`# Allow AI search & user fetches
User-agent: OAI-SearchBot
Allow: /

User-agent: ChatGPT-User
Allow: /

User-agent: Claude-SearchBot
Allow: /

User-agent: Claude-User
Allow: /

User-agent: PerplexityBot
Allow: /

# Block AI training
User-agent: GPTBot
Disallow: /

User-agent: ClaudeBot
Disallow: /

User-agent: Meta-ExternalAgent
Disallow: /

User-agent: Bytespider
Disallow: /

User-agent: CCBot
Disallow: /

User-agent: Google-Extended
Disallow: /`}</code>
      </pre>
      <p>
        <strong>Stance 2 &mdash; open to everything.</strong> Maximum AI visibility and training inclusion:
        simply have no rules targeting these bots. If your robots.txt doesn&rsquo;t mention a bot, it&rsquo;s
        allowed. Nothing to add &mdash; just make sure nothing upstream (CDN, firewall) blocks silently.
      </p>
      <p>
        <strong>Stance 3 &mdash; closed to everything.</strong> Some publishers legitimately want out of the
        AI ecosystem entirely. Block every user-agent in the table above with <code>Disallow: /</code>.
        Understand the trade: you disappear from AI answers, which for a growing share of queries is where
        the audience is.
      </p>
      <p>
        One nuance worth naming on CCBot: Common Crawl is an open dataset used by many research and
        commercial models, but also by search-adjacent and archival projects &mdash; blocking it is the
        broadest single opt-out and the least targeted one.
      </p>

      <h2>What blocking can and cannot do</h2>
      <ul>
        <li>
          <strong>robots.txt is a request, not a wall.</strong> The major operators &mdash; OpenAI,
          Anthropic, Google, Microsoft, Meta, Apple &mdash; document compliance. Some crawlers don&rsquo;t
          play by the rules; ByteDance&rsquo;s Bytespider has repeatedly been reported ignoring robots.txt.
          If you need enforcement rather than requests, block at the CDN/WAF level, where the connection is
          actually refused.
        </li>
        <li>
          <strong>It&rsquo;s not retroactive.</strong> Blocking today keeps future crawls out; it
          doesn&rsquo;t remove what past crawls or existing Common Crawl snapshots already contain.
        </li>
        <li>
          <strong>Check what your CDN decided for you.</strong> Cloudflare has blocked AI crawlers by default
          on new domains since July 1, 2025; from September 15, 2026 it also default-blocks mixed-use AI
          crawlers on pages carrying ads, and has moved from per-crawl payments to a &ldquo;Pay Per
          Use&rdquo; compensation model. These defaults are reasonable for publishers who never chose a
          stance &mdash; and quietly wrong for anyone who <em>wants</em> AI search visibility. If
          you&rsquo;re behind Cloudflare or a similar WAF, audit its bot settings against the stance you
          actually chose.
        </li>
        <li>
          <strong>Verify with logs, not vibes.</strong> Grep your access logs for the user-agents above. The
          asymmetry is real &mdash; Cloudflare&rsquo;s 2026 Radar data measured AI crawlers fetching hundreds
          to thousands of pages per referral sent &mdash; so seeing heavy crawl traffic is normal; seeing{' '}
          <em>zero</em> visits from search bots you meant to allow means something upstream is blocking them.
        </li>
      </ul>

      <h2>Allowing a bot in is step one — being readable is step two</h2>
      <p>
        A robots.txt that welcomes OAI-SearchBot achieves nothing if what the bot receives is an empty
        JavaScript shell, or if it can&rsquo;t discover your pages because your internal links only exist
        after scripts run. Most AI crawlers read raw server HTML and follow the links they find there &mdash;
        no rendering, no patience.{' '}
        <Link href={{ pathname: '/' }}>Crawlmouse</Link> crawls your site exactly that way &mdash; raw HTML,
        no JavaScript execution &mdash; and grades whether your pages and internal links are actually
        reachable to a non-rendering bot, free and with nothing to install. Run it after you&rsquo;ve set
        your robots.txt stance: allowed-but-unreadable is the failure mode nobody&rsquo;s dashboard reports.
      </p>

      <p className="mt-10 text-sm text-ink/60">
        Crawlmouse is a free internal-linking grader built by{' '}
        <a href="https://nahltech.com" rel="noopener">Nahl Technologies</a>.
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
