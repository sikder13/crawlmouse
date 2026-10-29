import { DataNotes, FileName, N, Ref, Round, SOURCE_DIR } from '../cite';

// Body for /blog/ai-crawler-access-test-2026. Every number is an <N> resolved against its source
// file by __tests__/research-article-data.test.tsx; see lib/blog/cite.tsx. Write no bare number here.

const TH = 'py-2 pr-3 text-left font-semibold text-ink align-top';
const TD = 'py-2 pr-3 align-top';
const CAPTION = 'caption-bottom pt-2 text-left text-sm text-ink/60';

/** Body for /blog/ai-crawler-access-test-2026. Rendered inside ArticleLayout's `.article-prose`. */
export function AiCrawlerAccessTest2026Body() {
  return (
    <>
      <p>
        In October we ran{' '}
        <N s="readme" q="Three rounds of live tests">
          three
        </N>{' '}
        rounds of live tests. Each fetched real websites with the published user-agent strings of AI
        crawlers, such as GPTBot, ClaudeBot and PerplexityBot, and compared the answer with a plain
        browser fetch of the same page.
        <Ref s="readme" /> Across the rounds we fetched{' '}
        <N s="readme" q="Homepages of 96 sites" derived="distinct-sites">
          96
        </N>{' '}
        distinct websites; the later rounds went back to sites from the first.
        <Ref s="readme" />
      </p>
      <p>
        The headline: the answer a site gave depended on more than the crawler name in the request.
        The same crawler names, sent to the same{' '}
        <N s="readme" q="the same 5 discriminating sites">
          five
        </N>{' '}
        sites from{' '}
        <N s="readme" derived="egress-networks">
          two
        </N>{' '}
        cloud networks a day apart, got different answers.
        <Ref s="readme" />
      </p>

      <div className="rounded-2xl border border-oat bg-white p-6">
        <p>
          <strong>Read this first: what this data is, and is not.</strong>
        </p>
        <ul>
          <li>
            Our requests carried crawler names; they did not come from the crawlers. The real GPTBot
            comes from OpenAI’s published IP ranges and, on Cloudflare, is a verified bot. Ours sent
            GPTBot’s user-agent string from an ordinary cloud IP.
            <Ref s="r1" />
          </li>
          <li>
            So the results below are simulated requests: they show how a site treated our
            infrastructure, and they are labelled as simulated.
            <Ref s="readme" />
          </li>
          <li>
            Homepages are not whole sites, and the numbers here are dated observations of the sites
            as they were on those days.
            <Ref s="readme" />
          </li>
        </ul>
      </div>

      <h2>What we tested, and how</h2>
      <p>
        A web request carries a user-agent string, a line of text naming the software that sent it.
        We sent requests carrying the strings AI crawlers publish, and recorded what came back. The
        tests paired those requests with a control: the same page fetched with a plain Chrome
        browser string. The control is what makes a result readable. When the browser fetch is
        challenged too, a refused “GPTBot” request says nothing about GPTBot; it says the site
        challenges traffic from data centres.
        <Ref s="r1" />
      </p>

      <div className="overflow-x-auto">
        <table className="w-full border-collapse text-sm">
          <caption className={CAPTION}>
            The{' '}
            <N s="readme" q="Three rounds of live tests">
              three
            </N>{' '}
            rounds. Sources: <Ref s="readme" />
            <Ref s="r1" />
            <Ref s="r2" />
            <Ref s="r3" />
          </caption>
          <thead>
            <tr className="border-b-2 border-oat">
              <th className={TH} scope="col"></th>
              <th className={TH} scope="col">
                <Round n={1} cap />
              </th>
              <th className={TH} scope="col">
                <Round n={2} cap />
              </th>
              <th className={TH} scope="col">
                <Round n={3} cap />
              </th>
            </tr>
          </thead>
          <tbody className="text-ink/80">
            <tr className="border-b border-oat">
              <th className={TH} scope="row">
                Date
              </th>
              <td className={TD}>
                <N s="readme" q="25 Oct 2026">
                  25 October 2026
                </N>
              </td>
              <td className={TD}>
                <N s="readme" q="26 Oct 2026">
                  26 October 2026
                </N>
              </td>
              <td className={TD}>
                <N s="readme" q="27 Oct 2026">
                  27 October 2026
                </N>
              </td>
            </tr>
            <tr className="border-b border-oat">
              <th className={TH} scope="row">
                Sites
              </th>
              <td className={TD}>
                Homepages of{' '}
                <N s="readme" q="Homepages of 96 sites">
                  96
                </N>{' '}
                sites:{' '}
                <N s="readme" q="(48 large, 48 small-business and local)">
                  48
                </N>{' '}
                large,{' '}
                <N s="readme" q="(48 large, 48 small-business and local)">
                  48
                </N>{' '}
                small-business and local
              </td>
              <td className={TD}>
                Sampled pages of{' '}
                <N s="readme" q="Sampled pages of 10 non-discriminating sites">
                  10
                </N>{' '}
                sites that did not treat crawler names differently, then{' '}
                <N s="readme" q="5 discriminating sites (POC-2b)">
                  5
                </N>{' '}
                that did
              </td>
              <td className={TD}>
                The same{' '}
                <N s="readme" q="the same 5 discriminating sites">
                  5
                </N>{' '}
                sites
              </td>
            </tr>
            <tr className="border-b border-oat">
              <th className={TH} scope="row">
                Identities
              </th>
              <td className={TD}>
                <N s="readme" q="fetched as 8 identities">
                  8
                </N>
                : Chrome (control), Googlebot, Bingbot, GPTBot, OAI-SearchBot, ClaudeBot,
                PerplexityBot and our own{' '}
                <N s="r1" q="an identified `Crawlmouse/2.0`">
                  Crawlmouse/2.0
                </N>
              </td>
              <td className={TD}>
                <N s="r2" q="six AI user agents plus a browser control">
                  6
                </N>{' '}
                AI crawler names (OAI-SearchBot, ChatGPT-User, PerplexityBot, Claude-SearchBot,
                GPTBot, ClaudeBot) plus a Chrome control
              </td>
              <td className={TD}>
                The same{' '}
                <N s="r3" derived="round3-crawler-names">
                  6
                </N>{' '}
                AI crawler names
              </td>
            </tr>
            <tr className="border-b border-oat">
              <th className={TH} scope="row">
                Network
              </th>
              <td className={TD}>Supabase Edge Function (cloud IP)</td>
              <td className={TD}>Supabase Edge Function (cloud IP)</td>
              <td className={TD}>Fly.io worker (dedicated cloud IP)</td>
            </tr>
            <tr>
              <th className={TH} scope="row">
                Recorded
              </th>
              <td className={TD}>Status, headers and word count per identity, plus robots.txt</td>
              <td className={TD}>A verdict per sampled page and crawler name</td>
              <td className={TD}>
                Verdict counts per site and crawler name, not each page’s response
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      <p>
        <Round n={1} cap /> sent{' '}
        <N s="r1" q="768 live fetches">
          768
        </N>{' '}
        requests. It fetched each homepage whatever robots.txt said, and recorded robots.txt
        alongside.
        <Ref s="r1" />
        <Ref s="r2" /> A re-run on{' '}
        <N s="r1" q="16 sites × 15 UAs">
          16
        </N>{' '}
        of the sites sent each AI crawler string{' '}
        <N s="r1" q="sending each crawler string twice">
          twice
        </N>
        , exactly as published and tagged with a Crawlmouse suffix, and added ChatGPT-User and
        Claude-SearchBot. Tagging changed no answer on the{' '}
        <N s="readme" q="changed no answer on the 16 sites tested">
          16
        </N>{' '}
        sites tested.
        <Ref s="r1" />
        <Ref s="readme" />
      </p>
      <p>
        <Round n={2} cap /> went deeper on fewer sites: it crawled up to{' '}
        <N s="r2" q="crawl up to 150 pages">
          150
        </N>{' '}
        pages of each of the first{' '}
        <N s="readme" q="Sampled pages of 10 non-discriminating sites">
          10
        </N>
        , and up to{' '}
        <N s="r2" q="crawl up to 100 pages">
          100
        </N>{' '}
        of each of the other{' '}
        <N s="readme" q="5 discriminating sites (POC-2b)">
          5
        </N>
        , then fetched a sample of pages (the homepage, a page per template, the biggest hubs, the
        deepest and newest pages) under each crawler name. It sent at most{' '}
        <N s="r2" q="2 requests/s per host">
          2
        </N>{' '}
        requests per second to any host. Its second part honoured robots.txt per crawler name; its
        first part, because of a bug, never read robots.txt at all.
        <Ref s="readme" />
        <Ref s="r2" />
      </p>
      <p>
        The large set included our own sites, crawlmouse.com and nahltech.com.
        <Ref s="r1" />
      </p>

      <h2>What the labels mean</h2>
      <p>
        The results are recorded as verdict labels. We show them as written, with what our notes say
        they mean.
      </p>
      <ul>
        <li>
          <code>allowed</code>: the crawler-named request got the page. In <Round n={2} />, that
          meant a word count of at least{' '}
          <N
            s="r2"
            q="A UA gets `allowed` when its raw word count is at least 80% of the control's"
          >
            80%
          </N>{' '}
          of the control’s.
          <Ref s="r2" />
        </li>
        <li>
          <code>blocked_by_ua_rule</code>: the control got a{' '}
          <N s="r1" q="`blocked_by_ua_rule` (control 200, this UA 4xx/451/999)">
            200
          </N>
          , and the crawler-named request got a{' '}
          <N s="r1" q="`blocked_by_ua_rule` (control 200, this UA 4xx/451/999)">
            4xx
          </N>
          ,{' '}
          <N s="r1" q="`blocked_by_ua_rule` (control 200, this UA 4xx/451/999)">
            451
          </N>{' '}
          or{' '}
          <N s="r1" q="`blocked_by_ua_rule` (control 200, this UA 4xx/451/999)">
            999
          </N>{' '}
          status.
          <Ref s="r1" />
        </li>
        <li>
          <code>challenged_ua</code>: the crawler-named request got a challenge instead of the page;
          on neilpatel.com, a{' '}
          <N s="r2" q="all six `challenged_ua` (403, `cf-mitigated: challenge`)">
            403
          </N>{' '}
          carrying Cloudflare’s <code>cf-mitigated: challenge</code> header.
          <Ref s="r2" />
        </li>
        <li>
          <code>disallowed_by_robots</code>: robots.txt closed the page to that crawler name, so no
          request was sent under it.
          <Ref s="r2" />
        </li>
        <li>
          <code>edge_blocks_automation</code>: the browser control itself was challenged, so the
          result is reported for the site and not attributed to any crawler.
          <Ref s="r1" />
        </li>
        <li>
          <code>refused_unverified</code> and <code>redirected_away</code> appear only in{' '}
          <Round n={3} />, and the files do not define them. Read from their names: the site refused
          the request, which did not come from a verified crawler; and the site answered with a
          redirect away from the page requested.
          <Ref s="r3" />
        </li>
      </ul>

      <h2>The main finding: same names, different networks, different answers</h2>
      <p>
        The{' '}
        <N s="readme" q="the same 5 discriminating sites">
          five
        </N>{' '}
        sites in the later rounds are the ones that had treated crawler names differently in{' '}
        <Round n={1} />. <Round n={2} cap /> fetched them from a Supabase Edge Function on{' '}
        <N s="readme" q="26 Oct 2026">
          26
        </N>{' '}
        October, sampling{' '}
        <N s="r2" q="sample 20 pages">
          20
        </N>{' '}
        pages per site. <Round n={3} cap /> fetched them from a Fly.io worker on{' '}
        <N s="readme" q="27 Oct 2026">
          27
        </N>{' '}
        October with the same{' '}
        <N s="r3" derived="round3-crawler-names">
          six
        </N>{' '}
        crawler names; its counts are out of{' '}
        <N s="r3" field="of" row={{ site: 'nike.com', verdict: 'refused_unverified' }}>
          20
        </N>{' '}
        pages per site, except on neilpatel.com, where it measured{' '}
        <N s="r3" field="of" row={{ site: 'neilpatel.com', verdict: 'edge_blocks_automation' }}>
          1
        </N>
        .
        <Ref s="readme" />
        <Ref s="r2" />
        <Ref s="r3" />
      </p>

      <div className="overflow-x-auto">
        <table className="w-full border-collapse text-sm" data-table="networks">
          <caption className={CAPTION}>
            What our requests received, by network. Verdict labels as recorded. Sources:{' '}
            <Ref s="readme" />
            <Ref s="r2" />
            <Ref s="r3" />
          </caption>
          <thead>
            <tr className="border-b-2 border-oat">
              <th className={TH} scope="col">
                Site
              </th>
              <th className={TH} scope="col">
                <N s="readme" q="26 Oct 2026">
                  26
                </N>{' '}
                October, Supabase network
              </th>
              <th className={TH} scope="col">
                <N s="readme" q="27 Oct 2026">
                  27
                </N>{' '}
                October, Fly.io network
              </th>
            </tr>
          </thead>
          <tbody className="text-ink/80">
            <tr className="border-b border-oat">
              <th className={TH} scope="row">
                nike.com
              </th>
              <td className={TD}>
                OAI-SearchBot, ChatGPT-User, PerplexityBot and GPTBot:{' '}
                <code>blocked_by_ua_rule</code> (
                <N
                  s="r2"
                  q="OAI-SearchBot, ChatGPT-User, PerplexityBot, GPTBot `blocked_by_ua_rule` (403)"
                >
                  403
                </N>
                ). Claude-SearchBot and ClaudeBot: <code>allowed</code>. The same split on{' '}
                <N s="r2" q="the same split on 20 of 20 pages">
                  20 of 20
                </N>{' '}
                pages.
              </td>
              <td className={TD}>
                Each crawler name: <code>refused_unverified</code> on{' '}
                <N s="r3" field="count" row={{ site: 'nike.com', verdict: 'refused_unverified' }}>
                  19
                </N>{' '}
                of{' '}
                <N s="r3" field="of" row={{ site: 'nike.com', verdict: 'refused_unverified' }}>
                  20
                </N>{' '}
                pages, <code>redirected_away</code> on{' '}
                <N s="r3" field="count" row={{ site: 'nike.com', verdict: 'redirected_away' }}>
                  1
                </N>{' '}
                of{' '}
                <N s="r3" field="of" row={{ site: 'nike.com', verdict: 'redirected_away' }}>
                  20
                </N>
                .
              </td>
            </tr>
            <tr className="border-b border-oat">
              <th className={TH} scope="row">
                en.wikipedia.org
              </th>
              <td className={TD}>
                ClaudeBot: <code>blocked_by_ua_rule</code> (
                <N s="r2" q="ClaudeBot 403 on 20 of 20">
                  403
                </N>
                ) on{' '}
                <N s="r2" q="ClaudeBot 403 on 20 of 20">
                  20 of 20
                </N>{' '}
                pages. The other{' '}
                <N s="r2" q="the other five 200 on 20 of 20">
                  five
                </N>
                :{' '}
                <N s="r2" q="the other five 200 on 20 of 20">
                  200
                </N>{' '}
                on{' '}
                <N s="r2" q="the other five 200 on 20 of 20">
                  20 of 20
                </N>
                .
              </td>
              <td className={TD}>
                Each crawler name, ClaudeBot included: <code>allowed</code> on{' '}
                <N s="r3" field="count" row={{ site: 'en.wikipedia.org', verdict: 'allowed' }}>
                  17
                </N>{' '}
                of{' '}
                <N s="r3" field="of" row={{ site: 'en.wikipedia.org', verdict: 'allowed' }}>
                  20
                </N>{' '}
                pages, <code>disallowed_by_robots</code> on{' '}
                <N
                  s="r3"
                  field="count"
                  row={{ site: 'en.wikipedia.org', verdict: 'disallowed_by_robots' }}
                >
                  3
                </N>{' '}
                of{' '}
                <N
                  s="r3"
                  field="of"
                  row={{ site: 'en.wikipedia.org', verdict: 'disallowed_by_robots' }}
                >
                  20
                </N>
                .
              </td>
            </tr>
            <tr className="border-b border-oat">
              <th className={TH} scope="row">
                css-tricks.com
              </th>
              <td className={TD}>
                Each crawler name: <code>blocked_by_ua_rule</code> (
                <N s="r2" q="all six `blocked_by_ua_rule` (403)">
                  403
                </N>
                ) on{' '}
                <N s="r2" q="20 of 20 pages blocked for all six, Crawlmouse and Chrome get 200">
                  20 of 20
                </N>{' '}
                pages, while Chrome and our own crawler got{' '}
                <N s="r2" q="20 of 20 pages blocked for all six, Crawlmouse and Chrome get 200">
                  200
                </N>
                .
              </td>
              <td className={TD}>
                Each crawler name: <code>blocked_by_ua_rule</code> on{' '}
                <N
                  s="r3"
                  field="count"
                  row={{ site: 'css-tricks.com', verdict: 'blocked_by_ua_rule' }}
                >
                  16
                </N>{' '}
                of{' '}
                <N
                  s="r3"
                  field="of"
                  row={{ site: 'css-tricks.com', verdict: 'blocked_by_ua_rule' }}
                >
                  20
                </N>{' '}
                pages, <code>allowed</code> on{' '}
                <N s="r3" field="count" row={{ site: 'css-tricks.com', verdict: 'allowed' }}>
                  4
                </N>{' '}
                of{' '}
                <N s="r3" field="of" row={{ site: 'css-tricks.com', verdict: 'allowed' }}>
                  20
                </N>
                .
              </td>
            </tr>
            <tr className="border-b border-oat">
              <th className={TH} scope="row">
                neilpatel.com
              </th>
              <td className={TD}>
                Each crawler name: <code>challenged_ua</code> on{' '}
                <N s="r2" q="The other 17 pages are `challenged_ua`.">
                  17
                </N>{' '}
                of{' '}
                <N s="r2" q="3 of 20 pages are in fact served">
                  20
                </N>{' '}
                pages; <code>allowed</code> on{' '}
                <N s="r2" q="3 of 20 pages are in fact served">
                  3 of 20
                </N>
                , where the word count equalled the browser control’s.
              </td>
              <td className={TD}>
                Each crawler name: <code>edge_blocks_automation</code> on{' '}
                <N
                  s="r3"
                  field="count"
                  row={{ site: 'neilpatel.com', verdict: 'edge_blocks_automation' }}
                >
                  1
                </N>{' '}
                of{' '}
                <N
                  s="r3"
                  field="of"
                  row={{ site: 'neilpatel.com', verdict: 'edge_blocks_automation' }}
                >
                  1
                </N>{' '}
                page measured.
              </td>
            </tr>
            <tr>
              <th className={TH} scope="row">
                cnn.com
              </th>
              <td className={TD}>
                robots.txt disallowed each crawler name on{' '}
                <N
                  s="r2"
                  q="20 of 20 pages disallowed by cnn.com robots.txt for all six tokens, so no bot request was made"
                >
                  20 of 20
                </N>{' '}
                sampled pages, so no crawler-named request was sent.
              </td>
              <td className={TD}>
                <code>disallowed_by_robots</code> for each crawler name on{' '}
                <N s="r3" field="count" row={{ site: 'cnn.com', verdict: 'disallowed_by_robots' }}>
                  7
                </N>{' '}
                of{' '}
                <N s="r3" field="of" row={{ site: 'cnn.com', verdict: 'disallowed_by_robots' }}>
                  20
                </N>{' '}
                pages; <code>edge_blocks_automation</code> on{' '}
                <N
                  s="r3"
                  field="count"
                  row={{ site: 'cnn.com', verdict: 'edge_blocks_automation' }}
                >
                  2
                </N>
                . On the other{' '}
                <N
                  s="r3"
                  field="count"
                  row={{
                    site: 'cnn.com',
                    verdict: 'allowed',
                    tokens: ['OAI-SearchBot', 'Claude-SearchBot'],
                  }}
                >
                  11
                </N>
                , OAI-SearchBot and Claude-SearchBot: <code>allowed</code>; ChatGPT-User,
                PerplexityBot, GPTBot and ClaudeBot: <code>blocked_by_ua_rule</code> (on{' '}
                <N
                  s="r3"
                  field="count"
                  row={{
                    site: 'cnn.com',
                    verdict: 'blocked_by_ua_rule',
                    tokens: ['ChatGPT-User', 'PerplexityBot', 'GPTBot', 'ClaudeBot'],
                  }}
                >
                  11
                </N>
                ).
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      <p>
        Our research notes single out nike.com, en.wikipedia.org and neilpatel.com as the sites that
        answered differently from the Supabase network and the Fly.io network.
        <Ref s="readme" /> On those sites, the most common answer for some crawler names changed. On
        nike.com, Claude-SearchBot and ClaudeBot went from <code>allowed</code> to{' '}
        <code>refused_unverified</code>. On en.wikipedia.org, ClaudeBot went from{' '}
        <code>blocked_by_ua_rule</code> to <code>allowed</code>. On neilpatel.com, the answer went
        from a challenge to the crawler names to <code>edge_blocks_automation</code>, the label for
        a challenge to the browser control itself.
        <Ref s="r1" />
        <Ref s="r2" />
        <Ref s="r3" />
      </p>
      <p>
        On css-tricks.com, <code>blocked_by_ua_rule</code> stayed the most common answer for each
        crawler name in both rounds. On cnn.com, <Round n={2} /> sent no crawler-named requests, so
        it has no live answer to compare.
        <Ref s="r2" />
        <Ref s="r3" />
      </p>
      <p>
        What this shows, in the words of our notes: a simulated request measures how a site treats
        the infrastructure the request comes from, and conclusions drawn from it have to be labelled
        as simulated. The networks differ in more than their addresses; our notes list egress IPs,
        TLS fingerprints and DNS.
        <Ref s="readme" />
        <Ref s="r2" />
      </p>

      <div className="rounded-2xl border border-oat bg-white p-6">
        <p>
          <strong>What these files do not show.</strong> <Round n={2} cap /> and <Round n={3} /> ran
          a day apart, from different software on different networks. <Round n={3} cap /> saved
          counts per site, not each page’s response, so the files do not show whether the same pages
          were fetched in both rounds, or what each page returned. They do not show why a site
          answered as it did.
          <Ref s="readme" />
          <Ref s="r3" />
        </p>
      </div>

      <h2>
        Small-business sites mostly let crawlers in; large sites more often refused automation
        outright
      </h2>
      <p>
        <Round n={1} cap /> split its sites into{' '}
        <N s="r1" q="Two sets of 48 sites">
          two
        </N>{' '}
        sets of{' '}
        <N s="r1" q="Two sets of 48 sites">
          48
        </N>
        : large consumer, media and platform sites with enterprise bot management, and sites like
        the ones our customers run, from Shopify stores, agencies and SEO vendors to WordPress,
        Webflow and Squarespace sites, SaaS marketing sites and local Indiana organisations.
        <Ref s="r1" />
      </p>

      <div className="overflow-x-auto">
        <table className="w-full border-collapse text-sm">
          <caption className={CAPTION}>
            Homepage results, <Round n={1} />. Source: <Ref s="r1" />
          </caption>
          <thead>
            <tr className="border-b-2 border-oat">
              <th className={TH} scope="col">
                On the homepage
              </th>
              <th className={TH} scope="col">
                Large sites (
                <N s="r1" q="Set A: large sites (48)">
                  48
                </N>
                )
              </th>
              <th className={TH} scope="col">
                Small-business and local (
                <N s="r1" q="Set B: our market (48)">
                  48
                </N>
                )
              </th>
            </tr>
          </thead>
          <tbody className="text-ink/80">
            <tr className="border-b border-oat">
              <td className={TD}>The browser control itself was challenged or blocked</td>
              <td className={TD}>
                <N s="r1" q="**21 (44%)**">
                  21 (44%)
                </N>
              </td>
              <td className={TD}>
                <N s="r1" q="**4 (8%)**">
                  4 (8%)
                </N>
              </td>
            </tr>
            <tr className="border-b border-oat">
              <td className={TD}>
                The control got the page;{' '}
                <N s="r1" q="one or more AI crawler UAs refused">
                  one
                </N>{' '}
                or more AI crawler names were refused
              </td>
              <td className={TD}>
                <N s="r1" q="| 8 — cnn (HTTP 451 to AI bots)">
                  8
                </N>
              </td>
              <td className={TD}>
                <N s="r1" q="| 2 — neilpatel.com (403 to all four AI UAs)">
                  2
                </N>
              </td>
            </tr>
            <tr className="border-b border-oat">
              <td className={TD}>
                Every identity got the page, but robots.txt disallowed AI crawlers
              </td>
              <td className={TD}>
                <N s="r1" q="| 4 — bbc, amazon, techcrunch, wired | 0 |">
                  4
                </N>
              </td>
              <td className={TD}>
                <N s="r1" q="| 4 — bbc, amazon, techcrunch, wired | 0 |">
                  0
                </N>
              </td>
            </tr>
            <tr>
              <td className={TD}>Everything allowed</td>
              <td className={TD}>
                <N s="r1" q="| Everything allowed | 15 | 42 (88%) |">
                  15
                </N>
              </td>
              <td className={TD}>
                <N s="r1" q="| Everything allowed | 15 | 42 (88%) |">
                  42 (88%)
                </N>
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      <p>
        The gap is in the first row. Nearly{' '}
        <N s="r1" q="Set A shows this is nearly half of large sites.">
          half
        </N>{' '}
        of the large sites challenged a plain browser request from a cloud network. On those sites a
        test from outside says nothing about any particular crawler, and our notes record them as
        not testable from outside rather than as blocked.
        <Ref s="r1" /> In the small-business set,{' '}
        <N s="r1" q="| Everything allowed | 15 | 42 (88%) |">
          42
        </N>{' '}
        of the{' '}
        <N s="r1" q="Set B: our market (48)">
          48
        </N>{' '}
        homepages came back the same to every identity.
        <Ref s="r1" />
      </p>
      <p>
        Rules cut both ways. bluehost.com challenged the Chrome control but served all{' '}
        <N s="r1" q="bluehost challenged Chrome but served all four AI UAs">
          four
        </N>{' '}
        AI crawler names. bombas.com, hosted on Vercel, returned{' '}
        <N s="r1" q="returned 429 to Chrome and Googlebot but 200 to GPTBot and OAI-SearchBot">
          429
        </N>{' '}
        to Chrome and Googlebot but{' '}
        <N s="r1" q="returned 429 to Chrome and Googlebot but 200 to GPTBot and OAI-SearchBot">
          200
        </N>{' '}
        to GPTBot and OAI-SearchBot.
        <Ref s="r1" />
      </p>

      <h2>Why a robots.txt check alone is not enough</h2>
      <p>
        robots.txt says what a site asks of crawlers. In our tests, it and the response our requests
        received disagreed in both directions.
      </p>
      <p>
        css-tricks.com’s robots.txt explicitly allows GPTBot, ChatGPT-User and ClaudeBot. In{' '}
        <Round n={2} />, each of the{' '}
        <N s="r2" q="all six `blocked_by_ua_rule` (403)">
          six
        </N>{' '}
        AI crawler names got a{' '}
        <N s="r2" q="all six `blocked_by_ua_rule` (403)">
          403
        </N>{' '}
        on{' '}
        <N s="r2" q="20 of 20 pages blocked for all six, Crawlmouse and Chrome get 200">
          20 of 20
        </N>{' '}
        sampled pages, while Chrome and our own crawler got{' '}
        <N s="r2" q="20 of 20 pages blocked for all six, Crawlmouse and Chrome get 200">
          200
        </N>
        .
        <Ref s="r2" />
      </p>
      <p>
        The reverse also happened. On{' '}
        <N s="r1" q="| 4 — bbc, amazon, techcrunch, wired | 0 |">
          4
        </N>{' '}
        of the{' '}
        <N s="r1" q="Set A: large sites (48)">
          48
        </N>{' '}
        large sites (bbc.com, amazon.com, techcrunch.com and wired.com), robots.txt disallowed AI
        crawlers, and the homepage still came back to every identity we sent, because{' '}
        <Round n={1} /> fetched regardless of robots.txt.
        <Ref s="r1" />
      </p>
      <p>
        On{' '}
        <N s="r1" q="**21 (44%)**">
          21
        </N>{' '}
        of the{' '}
        <N s="r1" q="Set A: large sites (48)">
          48
        </N>{' '}
        large sites, the edge challenged or blocked even the browser control.
        <Ref s="r1" />
      </p>
      <p>
        Sites also distinguish between crawler names, such as training crawlers and search agents.
        In the <Round n={1} /> re-run, cnn.com returned{' '}
        <N
          s="r1"
          q="cnn.com: 451 to GPTBot, ChatGPT-User, ClaudeBot, PerplexityBot; 200 to OAI-SearchBot and Claude-SearchBot."
        >
          451
        </N>{' '}
        to GPTBot, ChatGPT-User, ClaudeBot and PerplexityBot, and{' '}
        <N
          s="r1"
          q="cnn.com: 451 to GPTBot, ChatGPT-User, ClaudeBot, PerplexityBot; 200 to OAI-SearchBot and Claude-SearchBot."
        >
          200
        </N>{' '}
        to OAI-SearchBot and Claude-SearchBot; en.wikipedia.org returned{' '}
        <N s="r1" q="en.wikipedia.org: 403 to ClaudeBot, 200 to Claude-SearchBot.">
          403
        </N>{' '}
        to ClaudeBot and{' '}
        <N s="r1" q="en.wikipedia.org: 403 to ClaudeBot, 200 to Claude-SearchBot.">
          200
        </N>{' '}
        to Claude-SearchBot.
        <Ref s="r1" />
      </p>

      <h2>Why a simulated request is not the real crawler</h2>
      <p>
        The real GPTBot comes from OpenAI’s published IP ranges and, on Cloudflare, is a verified
        bot. Ours sent the same user-agent string from an ordinary cloud IP.
        <Ref s="r1" />
      </p>
      <p>
        In <Round n={1} />, a request carrying the Googlebot or Bingbot name was refused while the
        Chrome control got the page on{' '}
        <N s="r1" q="| 5 — wikipedia, cnn, notion, nike, walmart | 1 — neilpatel |">
          5
        </N>{' '}
        of the{' '}
        <N s="r1" q="Set A: large sites (48)">
          48
        </N>{' '}
        large sites and{' '}
        <N s="r1" q="| 5 — wikipedia, cnn, notion, nike, walmart | 1 — neilpatel |">
          1
        </N>{' '}
        of the{' '}
        <N s="r1" q="Set B: our market (48)">
          48
        </N>{' '}
        small-business sites. Sites that verify Googlebot by reverse DNS refuse an impersonation.
        That is the site working as intended, and it says nothing about how the real Googlebot is
        treated.
        <Ref s="r1" />
      </p>
      <p>
        The same holds for AI crawlers. A site that allows the real GPTBot and challenges ours shows
        up in our data as challenged; a site that blocks only verified bots shows up as allowed.
        <Ref s="r2" />
      </p>
      <p>
        The network-dependent answers above are the clearest case. Neither network is a crawler’s
        own, so neither round shows what GPTBot or ClaudeBot itself receives.
        <Ref s="readme" />
      </p>

      <h2>What to check on your own site</h2>
      <ol>
        <li>
          <strong>Read your robots.txt for each crawler name.</strong> Look for each name
          separately: GPTBot, OAI-SearchBot, ChatGPT-User, ClaudeBot, Claude-SearchBot and
          PerplexityBot. Sites in our tests answered these names differently.
          <Ref s="r1" />
        </li>
        <li>
          <strong>Check your CDN or firewall’s bot settings.</strong> In our tests the response did
          not always follow robots.txt: on css-tricks.com, the crawler names that robots.txt allows
          got a{' '}
          <N s="r2" q="all six `blocked_by_ua_rule` (403)">
            403
          </N>
          . Rules also vary by page: on neilpatel.com, a Cloudflare challenge covered{' '}
          <N s="r2" q="The Cloudflare challenge covers 17 of 20 pages and skips three blog pages">
            17 of 20
          </N>{' '}
          sampled pages and skipped{' '}
          <N s="r2" q="The Cloudflare challenge covers 17 of 20 pages and skips three blog pages">
            three
          </N>
          .
          <Ref s="r2" />
        </li>
        <li>
          <strong>Look for the real crawlers in your own logs.</strong> Find hits from the crawler
          names in your server or CDN logs, and confirm them against the operators’ published IP
          ranges, or reverse DNS for Googlebot. A user-agent string alone is what our tests sent
          too.
          <Ref s="r1" />
        </li>
      </ol>

      <h2>Methodology and limits</h2>
      <p>Each round recorded its own limits. They are repeated here.</p>

      <h3>
        <Round n={1} cap />,{' '}
        <N s="readme" q="25 Oct 2026">
          25 October 2026
        </N>
      </h3>
      <p>
        Homepages of{' '}
        <N s="readme" q="Homepages of 96 sites">
          96
        </N>{' '}
        sites, each fetched as{' '}
        <N s="readme" q="fetched as 8 identities">
          8
        </N>{' '}
        identities, plus robots.txt, from a Supabase Edge Function:{' '}
        <N s="r1" q="768 live fetches">
          768
        </N>{' '}
        requests.
        <Ref s="readme" />
        <Ref s="r1" />
      </p>
      <ul>
        <li>
          Homepages are not whole sites, and cloud IPs are not the crawlers’ own IPs.
          <Ref s="readme" />
        </li>
        <li>
          Where the browser control was itself challenged or blocked, per-crawler access was not
          testable from outside:{' '}
          <N s="r1" q="**21 (44%)**">
            21
          </N>{' '}
          large sites and{' '}
          <N s="r1" q="**4 (8%)** — godaddy, bluehost, convertkit, one DNS failure">
            4
          </N>{' '}
          small-business sites,{' '}
          <N s="r1" q="**4 (8%)** — godaddy, bluehost, convertkit, one DNS failure">
            one
          </N>{' '}
          of them a DNS failure.
          <Ref s="r1" />
        </li>
        <li>
          A refused Googlebot or Bingbot request is not evidence about the real Googlebot or
          Bingbot.
          <Ref s="r1" />
        </li>
        <li>
          It fetched each homepage regardless of robots.txt; a polite crawler would not have made
          some of these requests.
          <Ref s="r1" />
          <Ref s="r2" />
        </li>
        <li>
          iuhealth.org failed for{' '}
          <N s="r1" q="ERR ×7 (IPv6 egress failure)">
            7
          </N>{' '}
          identities through an{' '}
          <N s="r1" q="ERR ×7 (IPv6 egress failure)">
            IPv6
          </N>{' '}
          egress failure on our side.
          <Ref s="r1" />
        </li>
        <li>
          Detecting a challenge from page text alone produced a false positive (a “captcha” string
          on a normal page), so challenges were detected from headers first.
          <Ref s="r1" />
        </li>
      </ul>

      <h3>
        <Round n={2} cap />,{' '}
        <N s="readme" q="26 Oct 2026">
          26 October 2026
        </N>
      </h3>
      <p>
        First part:{' '}
        <N s="readme" q="Sampled pages of 10 non-discriminating sites">
          10
        </N>{' '}
        sites,{' '}
        <N s="r2" q="**308** | **3,250**">
          308
        </N>{' '}
        sampled pages,{' '}
        <N s="r2" q="**308** | **3,250**">
          3,250
        </N>{' '}
        requests. Second part:{' '}
        <N s="r2" q="- Five sites, four testable live.">
          five
        </N>{' '}
        sites, a{' '}
        <N s="r2" q="then fetch a 20-page stratified sample">
          20
        </N>
        -page sample each. Both from a Supabase Edge Function.
        <Ref s="readme" />
        <Ref s="r2" />
      </p>
      <ul>
        <li>
          It was not the Fly.io worker: it ran on Supabase’s egress IPs and runtime, with no
          persistent connections, and Fly egress IPs, TLS fingerprints and DNS differ.
          <Ref s="r2" />
        </li>
        <li>
          Nothing was rendered; no JavaScript ran.
          <Ref s="r2" />
        </li>
        <li>
          Not the real crawlers: verified-bot and signed-bot treatment is untestable from a cloud
          IP.
          <Ref s="r2" />
        </li>
        <li>
          The first part’s sites were a limited mix: none treated crawler names differently, and
          none was behind a challenge for all automation.
          <Ref s="r2" />
        </li>
        <li>
          A bug: the first part never read robots.txt, because robots.txt files served as plain text
          were discarded unread. Its statements about robots rules are unproven.
          <Ref s="r2" />
          <Ref s="readme" />
        </li>
        <li>
          A first run of the second part had the same bug. It was discarded and rerun, so
          neilpatel.com, css-tricks.com and nike.com took double the load.
          <Ref s="r2" />
        </li>
        <li>
          Pages that returned{' '}
          <N s="r2" q="404 controls were reported as `edge_blocks_automation`">
            404
          </N>{' '}
          to the control were first labelled <code>edge_blocks_automation</code>; the published
          counts correct this.
          <Ref s="r2" />
        </li>
        <li>
          On cnn.com, a stop rule (
          <N s="r2" q={'tripped the "4 consecutive challenged discovery pages" rule**, twice'}>
            4
          </N>{' '}
          consecutive challenged pages) tripped{' '}
          <N s="r2" q={'tripped the "4 consecutive challenged discovery pages" rule**, twice'}>
            twice
          </N>{' '}
          and was overridden, because the challenges were confined to the site’s /cnn-underscored
          section.
          <Ref s="r2" />
        </li>
        <li>
          In the second part,{' '}
          <N s="r2" q="- Five sites, four testable live.">
            four
          </N>{' '}
          of the{' '}
          <N s="r2" q="- Five sites, four testable live.">
            five
          </N>{' '}
          sites were testable live (cnn.com’s robots.txt disallowed every sampled page);{' '}
          <N s="r2" q="- 20 pages, not 50;">
            20
          </N>{' '}
          pages per site, not{' '}
          <N s="r2" q="- 20 pages, not 50;">
            50
          </N>
          ; and verdicts were compared by word count only.
          <Ref s="r2" />
        </li>
      </ul>

      <h3>
        <Round n={3} cap />,{' '}
        <N s="readme" q="27 Oct 2026">
          27 October 2026
        </N>
      </h3>
      <p>
        The same{' '}
        <N s="readme" q="the same 5 discriminating sites">
          five
        </N>{' '}
        sites from a Fly.io worker with a dedicated cloud IP; verdict counts per site and crawler
        name.
        <Ref s="readme" />
        <Ref s="r3" />
      </p>
      <ul>
        <li>
          It saved counts per site, not each page’s response.
          <Ref s="readme" />
        </li>
        <li>
          A dedicated cloud IP is still not a crawler’s own.
          <Ref s="readme" />
        </li>
        <li>
          On neilpatel.com it measured{' '}
          <N s="r3" field="of" row={{ site: 'neilpatel.com', verdict: 'edge_blocks_automation' }}>
            1
          </N>{' '}
          page.
          <Ref s="r3" />
        </li>
        <li>
          Its file records no page addresses or request headers, and does not define the labels{' '}
          <code>refused_unverified</code> and <code>redirected_away</code>.
          <Ref s="r3" />
        </li>
      </ul>
      <p>
        Across the rounds, the numbers are dated observations of the sites as they were on those
        days.
        <Ref s="readme" />
      </p>

      <DataNotes
        intro={
          <>
            The numbers in this article come from these files, in <FileName path={SOURCE_DIR} /> of
            the Crawlmouse repository. A test checks each of them against the file it cites.
          </>
        }
      />
    </>
  );
}
