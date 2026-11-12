/**
 * The packet for a template whose rendered pages are empty shells without JavaScript.
 *
 * Rendered from the record: the template key, how many of its graded pages the render step measured,
 * and each measured page's words without JavaScript against its words once rendered. The finding is
 * for the template by that sample, and the context says its size.
 *
 * Verify. The record holds word counts and no phrase of the page, so the command counts words: it
 * requests the first rendered page of the record and counts the words of the HTML response outside
 * the elements in SKIPPED (the element names of the audit's own structural strip,
 * analysis/ai-readiness/constants.ts AI_STRUCTURAL_STRIP, and `head`). It exits 0 when the count
 * reaches `wordsNeeded`: the count at which the page's share of its measured rendered words is
 * READABLE_FROM (render/state.ts). Text inside a script, an inline JSON state included, is not counted.
 *
 * What the count is not: the audit's count. The audit also drops link-dense menus and elements by
 * ARIA role (main-content.ts), which one line of awk does not. A page whose static text outside
 * SKIPPED already reaches `wordsNeeded` would pass unfixed; `expect` gives the audit's two counts so
 * the printed number can be read against them.
 */
import type { RenderedDetection, RenderedPage } from '../../detectors/rendered.js';
import { READABLE_FROM } from '../../render/state.js';
import { userAgentOf, verifyCrawler } from '../crawler.js';
import { int, sh, url, word } from '../shell.js';
import { code, count, line, ours, type Line } from '../text.js';
import type { Change, DocSource, PacketEntry, PacketFacts } from '../types.js';

/** The rendered pages a context shows, one line each, before it counts the rest. */
export const PAGES_SHOWN = 3;

const READ = '2026-11-12';

/** The words the verify command asks for: READABLE_FROM of the page's measured rendered words. */
export const wordsNeeded = (page: Pick<RenderedPage, 'rendered_words'>): number =>
  Math.ceil(READABLE_FROM * page.rendered_words);

/** Elements whose text the verify command leaves out. */
export const SKIPPED = [
  'script',
  'style',
  'noscript',
  'template',
  'svg',
  'head',
  'nav',
  'header',
  'footer',
  'aside',
] as const;

/**
 * The awk program of the verify command. Its input has one line per `<` of the response, so a line
 * starts with a tag's name. From an opening tag of SKIPPED (not self-closed) to that element's
 * closing tag, lines are dropped; of every other line the tag is removed and the words are counted.
 * It prints the count and exits 0 when the count is `need` or more.
 */
const COUNT_WORDS = [
  '{ t = tolower($0) }',
  `skip == "" && t !~ "^[^>]*/>" && match(t, "^(${SKIPPED.join('|')})[ >]") { skip = substr(t, 1, RLENGTH - 1) }`,
  'skip != "" { if (index(t, "/" skip ">") != 1) next; skip = "" }',
  '{ sub(/^[^>]*>/, ""); n += split($0, w) }',
  'END { print n + 0; exit !(n >= need + 0) }',
].join(' ');

const pagesOf = (n: number) => ours(n === 1 ? 'page' : 'pages');

function context(record: RenderedDetection, facts: PacketFacts): Line[] {
  const { pages, rendered } = record.extent;
  const shown = record.evidence.pages.slice(0, PAGES_SHOWN);
  const rest = record.evidence.pages.length - shown.length;
  const unrendered = pages - rendered;
  const lines: Line[] = [
    line`The template ${code(record.template_key)} serves its main content by JavaScript. The audit rendered ${count(rendered)} of its ${count(pages)} graded ${pagesOf(pages)} in a browser, and without JavaScript each of them is an empty shell.`,
    ...shown.map(
      (p) =>
        line`${code(p.url)}: ${count(p.raw_words)} words in the HTML response, ${count(p.rendered_words)} once rendered.`,
    ),
  ];
  if (rest > 0) {
    lines.push(line`${count(rest)} more rendered ${pagesOf(rest)} are not shown.`);
  }
  if (record.measured !== null) {
    lines.push(
      line`Across the rendered pages, a median of ${count(Math.round(record.measured * 100))}% of the rendered words is in the HTML response. A crawler that does not run JavaScript reads the smaller number.`,
    );
  }
  lines.push(
    unrendered > 0
      ? line`Measured by rendering ${count(rendered)} ${pagesOf(rendered)}. The other ${count(unrendered)} graded ${pagesOf(unrendered)} of the template were not rendered: the finding is for the template by this sample.`
      : line`Measured by rendering ${count(rendered)} ${pagesOf(rendered)}: every graded page of the template.`,
  );
  if (verifyCrawler(facts) === null) {
    lines.push(
      line`No tested AI crawler is served by the site today, so the check below requests the page with no crawler’s user agent.`,
    );
  }
  return lines;
}

const KEEP: Line[] = [
  line`Keep every URL of the template as it is.`,
  line`Keep the content: the same headings and text a browser shows today.`,
  line`Keep the page interactive: the browser can still hydrate the server-rendered markup and update it.`,
  line`Serve crawlers and visitors the same HTML.`,
];

const DEPLOY = line`Deploy, then run the check below.`;

function generic(record: RenderedDetection): Change {
  const template = code(record.template_key);
  return {
    change: [
      line`Find where the pages of ${template} get their main content. The HTML response holds little of it, so a script fetches or builds it in the browser.`,
      line`Render that content on the server, or at build time, so the HTML response of each page of the template holds its headings and body text.`,
      DEPLOY,
    ],
    keep: KEEP,
  };
}

const NEXTJS_SOURCES: readonly DocSource[] = [
  {
    title: 'Server and Client Components',
    url: 'https://nextjs.org/docs/app/getting-started/server-and-client-components',
    read: READ,
    supports:
      'App Router: pages are Server Components by default, fetch data on the server and pass it to Client Components as props',
  },
  {
    title: 'Fetching Data',
    url: 'https://nextjs.org/docs/app/getting-started/fetching-data',
    read: READ,
    supports:
      'App Router: an async Server Component awaits its data; Client Components fetch with the use API or a library such as SWR or React Query',
  },
  {
    title: 'generateStaticParams',
    url: 'https://nextjs.org/docs/app/api-reference/functions/generate-static-params',
    read: READ,
    supports: 'App Router: statically generate the routes of a dynamic segment at build time',
  },
  {
    title: 'getStaticProps',
    url: 'https://nextjs.org/docs/pages/building-your-application/data-fetching/get-static-props',
    read: READ,
    supports: 'Pages Router: prerender the page at build time from the props it returns',
  },
  {
    title: 'getServerSideProps',
    url: 'https://nextjs.org/docs/pages/building-your-application/data-fetching/get-server-side-props',
    read: READ,
    supports: 'Pages Router: fetch data at request time and render the initial HTML from it',
  },
  {
    title: 'How to lazy load Client Components and libraries',
    url: 'https://nextjs.org/docs/app/guides/lazy-loading',
    read: READ,
    supports: 'next/dynamic with ssr: false disables prerendering for a Client Component',
  },
];

function nextjs(record: RenderedDetection): Change {
  const template = code(record.template_key);
  return {
    change: [
      line`Find where the pages of ${template} fetch their main content. Content fetched in the browser (in a useEffect, or with a client library such as SWR or React Query) is not in the HTML the server sends.`,
      line`App Router (the route is under app/): fetch the data in the page's Server Component, an async function that awaits it, and render the content there. Pass it as props to any Client Component that needs it.`,
      line`Pages Router (the route is under pages/): export getStaticProps from the page to prerender it at build time, or getServerSideProps to render it at request time, and render the content from the props.`,
      line`If the component that renders the content is imported with next/dynamic and ssr: false, remove ssr: false. That option disables prerendering for the component.`,
      line`App Router, optional: export generateStaticParams from the page to generate the template's pages at build time.`,
      DEPLOY,
    ],
    keep: [
      ...KEEP,
      line`Leave the interactive parts as Client Components. Only the data fetch and the first render move to the server.`,
    ],
  };
}

const HYDROGEN_SOURCES: readonly DocSource[] = [
  {
    title: 'Fetch Shopify API data in Hydrogen',
    url: 'https://shopify.dev/docs/storefronts/headless/hydrogen/data-fetching',
    read: READ,
    supports:
      'a route loader queries the Storefront API (context.storefront.query) on the server; the component reads it with useLoaderData',
  },
];

function hydrogen(record: RenderedDetection): Change {
  const template = code(record.template_key);
  return {
    change: [
      line`Find where the pages of ${template} fetch their main content. A query made from the browser is not in the HTML the server sends.`,
      line`Query the Storefront API for that content in the route's loader function (context.storefront.query) and return it.`,
      line`Render the content in the route's component from useLoaderData.`,
      DEPLOY,
    ],
    keep: KEEP,
  };
}

export const clientRenderedTemplate: PacketEntry<'client_rendered_template'> = {
  kind: 'builder',
  context,
  generic,
  stacks: {
    nextjs: { write: nextjs, sources: NEXTJS_SOURCES },
    shopify_hydrogen: { write: hydrogen, sources: HYDROGEN_SOURCES },
  },
  verify: (record, facts) => {
    const page = [...record.evidence.pages].sort((a, b) => (a.url < b.url ? -1 : 1))[0];
    if (page === undefined) {
      throw new Error('packets: a client-rendered fix holds no rendered page');
    }
    const need = wordsNeeded(page);
    const entry = verifyCrawler(facts);
    return {
      command:
        entry === null
          ? sh`curl -sS ${url(page.url)} | tr ${word('\\r\\n')} ${word('  ')} | tr ${word('<')} ${word('\\n')} | awk -v need=${int(need)} ${word(COUNT_WORDS)}`
          : sh`curl -sS -A ${word(userAgentOf(entry))} ${url(page.url)} | tr ${word('\\r\\n')} ${word('  ')} | tr ${word('<')} ${word('\\n')} | awk -v need=${int(need)} ${word(COUNT_WORDS)}`,
      expect: line`Prints its count of the words in the HTML response outside scripts, styles and navigation, and exits 0 when that is ${count(need)} or more: ${count(Math.round(READABLE_FROM * 100))}% of the ${count(page.rendered_words)} words the audit counted once rendered. The audit counted ${count(page.raw_words)} without JavaScript. The count is the command’s own and differs a little from the audit’s.`,
      ua: entry?.token ?? null,
    };
  },
};
