/**
 * missing_schema_description: a template whose pages have no JSON-LD node about the page itself with
 * a description (content/checks.ts `schemaWithDescription`).
 *
 * The check's type list (`PAGE_SUBJECT`) is not exported, so the types this packet names and the
 * pattern its command uses are written here, and the test beside this file holds both to the check's
 * own verdict, type by type.
 */
import type { ContentDetection } from '../../content/aggregate.js';
import {
  AWK_SCRIPTS,
  contentContext,
  DOCS_READ,
  firstFailing,
  firstFailingPage,
  KEEP_PAGE,
  LD_BLOCK,
  ldType,
  mark,
  RECHECK,
  seeMarkup,
  tagProbe,
  template,
} from '../content-rule.js';
import { line, list } from '../text.js';
import type { DocSource, PacketEntry, PacketFacts } from '../types.js';

/** The types the packet names as examples of a node about the page itself. */
export const PAGE_TYPES_NAMED = [
  'WebPage',
  'Article',
  'BlogPosting',
  'Product',
  'Service',
  'Event',
] as const;

/** The check's `PAGE_SUBJECT`, as an alternation an awk regular expression can hold. */
const PAGE_SUBJECT_NAMES =
  '[A-Za-z]*(Page|Article|BlogPosting|SocialMediaPosting)|Product|ProductModel|IndividualProduct|Service|Event|Recipe|HowTo|Course|TouristTrip|Car|Vehicle';

/**
 * Exits 0 when one JSON-LD block of the page holds both a type about the page itself and a
 * `description` whose value is a string with a character that is not a space. AWK_SCRIPTS makes each
 * script element one line first, so a `<` in a block's text does not cut the block in two.
 */
const PROGRAM = `${AWK_SCRIPTS}${LD_BLOCK}&&$0~/${ldType(PAGE_SUBJECT_NAMES)}/&&$0~/"description"[ \\t]*:[ \\t]*"[ \\t]*[^" \\t]/{f=1}END{exit !f}`;

const SCRIPT = mark('<script type="application/ld+json">');
const DESCRIPTION = mark('description');

/** The documentation the generic steps rest on. */
export const missingSchemaDescriptionSources: readonly DocSource[] = [
  {
    title: 'schema.org: description',
    url: 'https://schema.org/description',
    read: DOCS_READ,
    supports: '`description` is a property of Thing, so of every type; its value is text',
  },
  {
    title: 'Intro to How Structured Data Markup Works | Google Search Central',
    url: 'https://developers.google.com/search/docs/appearance/structured-data/intro-structured-data',
    read: DOCS_READ,
    supports: 'JSON-LD goes in a `<script>` element in the `<head>` or the `<body>` of the page',
  },
];

const NEXTJS_SOURCES: readonly DocSource[] = [
  {
    title: 'How to implement JSON-LD in your Next.js application',
    url: 'https://nextjs.org/docs/app/guides/json-ld',
    read: DOCS_READ,
    supports:
      'render JSON-LD as a native `<script>` in `page.js` or `layout.js`, from `JSON.stringify` with `<` replaced by `\\u003c`; `description` is in its example',
  },
];

const context = (fix: ContentDetection, facts: PacketFacts) =>
  contentContext(fix, facts, [
    line`The check passes a page when a JSON-LD node about the page itself has a ${DESCRIPTION} that is not empty. Such a node has an ${mark('@type')} like ${list(
      PAGE_TYPES_NAMED.map(mark),
      PAGE_TYPES_NAMED.length,
      'type',
    )}, or another type whose name ends in ${mark('Page')} or ${mark('Article')}.`,
    line`A page with no JSON-LD fails. A description on a node about the site or the business (${mark('WebSite')}, ${mark('Organization')}) does not count, and neither does the meta description.`,
  ]);

const keep = [
  KEEP_PAGE,
  line`Keep the node's other properties and the page's other JSON-LD nodes as they are.`,
  line`Keep the visible content unchanged: the description summarises what the page already says and adds no claim of its own.`,
];

export const missingSchemaDescription: PacketEntry<'missing_schema_description'> = {
  kind: 'builder',
  context,
  generic: (fix) => ({
    change: [
      line`In the template ${template(fix)}, find the ${SCRIPT} block the server sends. If it has a node whose ${mark('@type')} describes the page itself (${mark('Product')} on a product page, ${mark('Article')} or ${mark('BlogPosting')} on an article, ${mark('WebPage')} otherwise), add a ${DESCRIPTION} property to that node.`,
      line`If the template sends no such node, add one in a ${SCRIPT} element, with ${mark('@context')}, ${mark('@type')}, ${mark('name')} and ${DESCRIPTION}.`,
      line`Fill ${DESCRIPTION} from the page's own summary field (the one its meta description or excerpt comes from), as plain text. An empty string or one of only spaces does not pass.`,
      line`Write the value with the platform's JSON encoder, so a quote or a line break in the text cannot break the block; a block that does not parse declares nothing.`,
      line`Send the block in the HTML response. The check does not run scripts, so markup a script adds in the browser is not read.`,
    ],
    keep,
  }),
  stacks: {
    nextjs: {
      write: (fix) => ({
        change: [
          line`In the ${mark('page.js')} (or ${mark('layout.js')}) that renders ${template(fix)}, build the object for the page's own node: ${mark("{ '@context': 'https://schema.org', '@type': …, name: …, description: … }")}, with ${DESCRIPTION} from the same data the page renders its summary from.`,
          line`Render it in the component's output as a native script element: ${mark('<script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd).replace(/</g, \'\\\\u003c\') }} />')}. Do not use ${mark('next/script')} for it.`,
          line`If the page already renders such an object without ${DESCRIPTION}, add the property there instead of a second node.`,
          line`Confirm the block is in the HTML response, which is what the check and the verify command read. An empty ${DESCRIPTION} does not pass.`,
        ],
        keep,
      }),
      sources: NEXTJS_SOURCES,
    },
  },
  verify: (fix, facts) => {
    const page = firstFailingPage(fix);
    const probe = tagProbe(facts, page, PROGRAM);
    const pair = mark('"description": "…"');
    return {
      command: probe.command,
      ua: probe.ua,
      see: {
        command: seeMarkup(facts, page, '"description" *: *"[^"]*"'),
        today: line`Each ${pair} pair in the page’s source, one per line. The audit found no JSON-LD node about the page itself with a description that is not empty, so what it prints today, if anything, is not one: a description on another node (${mark('WebSite')}, ${mark('Organization')}), an empty one, or one outside JSON-LD. ${firstFailing(fix)}`,
        after: line`A ${pair} line with the page’s own summary, from the node about the page itself.`,
      },
      expect: line`Exit status 0 when one JSON-LD block of the first failing page holds a type about the page itself and a ${DESCRIPTION} that is not empty; the audit's check failed that page. ${probe.sender} The command does not tell which node of the block the description is on. ${RECHECK}`,
    };
  },
};
