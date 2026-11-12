/**
 * The packet for a template whose rendered pages hold far fewer words without JavaScript.
 *
 * Rendered from the record: the template key, how many of its graded pages the render step measured,
 * and each measured page's words in the HTML response against its words once rendered. The record
 * holds word counts and not what adds the words, so the packet states the counts and names no
 * mechanism. The finding is for the template by that sample, and the context says its size.
 *
 * Verify. The record holds no phrase of the page, so the command counts words: it requests the first
 * rendered page of the record at the address the crawl read it at (served-at.ts `readAt`) and counts the words of
 * the HTML response outside the elements in SKIPPED. It exits 0 when the count reaches `wordsNeeded`:
 * the count at which the page's share of its measured rendered words is READABLE_FROM
 * (render/state.ts). Text inside a script, an inline JSON state included, is not counted. curl is
 * given `-f`, so a response with an error status gives the count no input, and `--compressed`, so a
 * server that compresses whatever the request accepts is still read.
 *
 * What the count is not: the audit's count. The audit also drops `header` elements, link-dense menus
 * and elements by ARIA role (main-content.ts), which this command does not: a `header` inside an
 * article holds the page's own text, and one line of awk cannot tell it from the site's. A page whose
 * text outside SKIPPED already reaches `wordsNeeded` passes unfixed; `expect` says so, and gives the
 * audit's two counts so the printed number can be read against them. The audit closes the fix earlier
 * than the command passes (render/state.ts EMPTY_SHELL_LEAVES_ABOVE); `expect` says that too.
 *
 * The readable command above it strips the tags of the same response and counts what is left. It
 * keeps the text of scripts, styles and menus, so its number is not the audit's: `today` and `after`
 * give the audit's two counts and say which way the rough count differs.
 */
import type { RenderedDetection, RenderedPage } from '../../detectors/rendered.js';
import { EMPTY_SHELL_LEAVES_ABOVE, READABLE_FROM } from '../../render/state.js';
import { userAgentOf, verifyCrawler } from '../crawler.js';
import { readAt, servedAt } from '../served-at.js';
import { int, sh, url, word } from '../shell.js';
import { code, count, line, list, ours, type Line, type Safe } from '../text.js';
import type { Change, DocSource, PacketEntry, PacketFacts } from '../types.js';

/** The rendered pages a context shows, one line each, before it counts the rest. */
export const PAGES_SHOWN = 3;

const READ = '2026-11-12';

/** The words the verify command asks for: READABLE_FROM of the page's measured rendered words. */
export const wordsNeeded = (page: Pick<RenderedPage, 'rendered_words'>): number =>
  Math.ceil(READABLE_FROM * page.rendered_words);

/**
 * Elements whose text the verify command leaves out: the element names of the audit's structural
 * strip (AI_STRUCTURAL_STRIP, which main-content.ts reads) less `header`, and `title`. The head is
 * not skipped as a whole: its closing tag may be omitted, and `title` is its one element with text
 * that is not in this list already.
 */
export const SKIPPED = [
  'script',
  'style',
  'noscript',
  'template',
  'svg',
  'title',
  'nav',
  'footer',
  'aside',
] as const;

/**
 * The awk program of the verify command. Its input has one line per `<` of the response, so a line
 * starts with a tag's name. From an opening tag of SKIPPED (not self-closed) to that element's
 * closing tag, lines are dropped; of every other line the tag is removed and the words are counted.
 * It prints the count and exits 0 when the count is `need` or more. A closing tag ends its element
 * with or without a space before its `>`.
 */
const COUNT_WORDS = [
  '{ t = tolower($0) }',
  `skip == "" && t !~ "^[^>]*/>" && match(t, "^(${SKIPPED.join('|')})[ \\t>]") { skip = substr(t, 1, RLENGTH - 1) }`,
  'skip != "" { if (t !~ ("^/" skip "[ \\t/>]")) next; skip = "" }',
  '{ sub(/^[^>]*>/, ""); n += split($0, w) }',
  'END { print n + 0; exit !(n >= need + 0) }',
].join(' ');

const pagesOf = (n: number) => ours(n === 1 ? 'page' : 'pages');
const wordsOf = (n: number) => ours(n === 1 ? 'word' : 'words');

const byUrl = (a: RenderedPage, b: RenderedPage) => (a.url < b.url ? -1 : a.url > b.url ? 1 : 0);

/** The record's rendered pages, sorted: the order the context lists them in and verify takes the first of. */
const renderedPages = (record: RenderedDetection): RenderedPage[] =>
  [...record.evidence.pages].sort(byUrl);

/** How many of the template's graded pages were rendered, as a sentence. */
function sample({ pages, rendered }: RenderedDetection['extent']): Safe {
  if (pages === 1) return ours('The audit rendered its 1 graded page in a browser.');
  return ours(
    rendered === pages
      ? `The audit rendered each of its ${pages} graded pages in a browser.`
      : `The audit rendered ${rendered} of its ${pages} graded pages in a browser.`,
  );
}

function context(record: RenderedDetection, facts: PacketFacts): Line[] {
  const { pages, rendered } = record.extent;
  const all = renderedPages(record);
  const shown = all.slice(0, PAGES_SHOWN);
  const rest = all.length - shown.length;
  const unrendered = pages - rendered;
  const lines: Line[] = [
    line`The HTML response of the template ${code(record.template_key)} holds far fewer words than its pages show once rendered in a browser: the difference is content added in the browser. ${sample(record.extent)}`,
    ...shown.map(
      (p) =>
        line`${code(servedAt(facts, p.url))}: ${count(p.raw_words)} ${wordsOf(p.raw_words)} in the HTML response, ${count(p.rendered_words)} once rendered in a browser.`,
    ),
  ];
  if (rest > 0) {
    lines.push(
      line`${count(rest)} more rendered ${pagesOf(rest)} ${ours(rest === 1 ? 'is' : 'are')} not shown.`,
    );
  }
  if (record.measured !== null) {
    lines.push(
      line`Across the rendered pages, a median of ${count(Math.round(record.measured * 100))}% of the rendered words is in the HTML response. A crawler that does not run JavaScript reads the smaller number.`,
    );
  }
  lines.push(
    unrendered > 0
      ? line`Measured by rendering ${count(rendered)} ${pagesOf(rendered)}. The other ${count(unrendered)} graded ${pagesOf(unrendered)} of the template ${ours(unrendered === 1 ? 'was' : 'were')} not rendered: the finding is for the template by this sample.`
      : line`Measured by rendering ${count(rendered)} ${pagesOf(rendered)}: every graded page of the template.`,
    SCOPE,
  );
  if (verifyCrawler(facts) === null) {
    lines.push(
      line`No tested AI crawler is served by the site today, so the check below requests the page with no crawler’s user agent.`,
    );
  }
  return lines;
}

/**
 * The finding's scope, from how the audit works (render/sample.ts, detectors/rendered.ts): it is the
 * same for every record, and says what no record of this type can hold.
 */
const SCOPE = line`The audit renders only pages it grades. A route whose HTML response holds too little text to be graded is not rendered, so another template of the site can have the same fault unmeasured.`;

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
      line`Find what adds the content of the pages of ${template} in the browser. The audit measured the words, not what adds them.`,
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
      'App Router: pages are Server Components by default, fetch data on the server and pass it to Client Components as props; Client Components are for browser-only APIs such as window',
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
    supports:
      'next/dynamic with ssr: false disables prerendering for a Client Component; the option works in Client Components only',
  },
];

function nextjs(record: RenderedDetection): Change {
  const template = code(record.template_key);
  return {
    change: [
      line`Find what adds the content of the pages of ${template} in the browser. The audit measured the words, not what adds them. One place to look: a Client Component that fetches its data in the browser, with a library such as SWR or React Query.`,
      line`App Router (the route is under app/): fetch the data in the page's Server Component, an async function that awaits it, and render the content there. Pass it as props to any Client Component that needs it.`,
      line`Pages Router (the route is under pages/): export getStaticProps from the page to prerender it at build time, or getServerSideProps to render it at request time, and render the content from the props.`,
      line`If the component that renders the content is imported with next/dynamic and ssr: false, that option disables prerendering for it. Remove the option if the component can render on the server. If it cannot, because it uses a browser-only API such as window, leave it as it is and render the content's text in a Server Component placed beside it, not inside it.`,
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
      line`Find what adds the content of the pages of ${template} in the browser. The audit measured the words, not what adds them.`,
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
    const page = renderedPages(record)[0];
    if (page === undefined) {
      throw new Error('packets: a client-rendered fix holds no rendered page');
    }
    const need = wordsNeeded(page);
    const entry = verifyCrawler(facts);
    const address = url(readAt(facts, page.url));
    const skipped = list(
      SKIPPED.map((tag) => ours(`\`${tag}\``)),
      SKIPPED.length,
      'element',
    );
    const percent = (share: number) => count(Math.round(share * 100));
    const strip = word('s/<[^>]*>/ /g');
    const gained = page.rendered_words - page.raw_words;
    return {
      see: {
        command:
          entry === null
            ? sh`curl -sS --compressed ${address} | sed ${strip} | wc -w`
            : sh`curl -sS --compressed -A ${word(userAgentOf(entry))} ${address} | sed ${strip} | wc -w`,
        today: line`The audit counted ${count(page.raw_words)} ${wordsOf(page.raw_words)} in this page’s HTML response. This rough count also takes the text of scripts, styles and menus, which the audit and the exact check leave out, so it is usually higher.`,
        after: line`A number higher by about the words the page gains: the audit counted ${count(page.rendered_words)} once rendered in a browser, ${count(gained)} more.`,
      },
      command:
        entry === null
          ? sh`curl -sSf --compressed ${address} | tr ${word('\\r\\n')} ${word('  ')} | tr ${word('<')} ${word('\\n')} | awk -v need=${int(need)} ${word(COUNT_WORDS)}`
          : sh`curl -sSf --compressed -A ${word(userAgentOf(entry))} ${address} | tr ${word('\\r\\n')} ${word('  ')} | tr ${word('<')} ${word('\\n')} | awk -v need=${int(need)} ${word(COUNT_WORDS)}`,
      expect: line`Prints its count of the words in the HTML response and exits 0 at ${count(need)} or more: ${percent(READABLE_FROM)}% of the ${count(page.rendered_words)} the audit counted once rendered (it counted ${count(page.raw_words)} without JavaScript). An error status does not pass. The command counts all text outside ${skipped} elements: its count differs a little from the audit’s, and a page with that much text outside its main content passes unfixed. The audit’s next check closes the fix sooner: once every rendered page of the template has more than ${percent(EMPTY_SHELL_LEAVES_ABOVE)}% of its rendered words in the HTML response.`,
      ua: entry?.token ?? null,
    };
  },
};
