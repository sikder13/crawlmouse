/**
 * missing_author_date: a template whose articles do not name an author and a publication date in
 * markup (content/checks.ts `authorAndDate`, content/read.ts `byline`).
 *
 * The check's Article type list (`ARTICLE`) is not exported, so the pattern the command uses is
 * written here, and the test beside this file holds it to the check's own verdict, type by type.
 */
import type { ContentDetection } from '../../content/aggregate.js';
import {
  AWK_SCRIPTS,
  AWK_VISIBLE,
  CHROME_GAP,
  contentContext,
  DOCS_READ,
  firstFailing,
  firstFailingPage,
  KEEP_PAGE,
  ldType,
  mark,
  RECHECK,
  seeMarkup,
  SET_ASIDE,
  tagProbe,
  template,
} from '../content-rule.js';
import { line } from '../text.js';
import type { DocSource, PacketEntry, PacketFacts } from '../types.js';

/** The check's `ARTICLE`, as an alternation an awk regular expression can hold. */
const ARTICLE_NAMES =
  '[A-Za-z]*(Article|BlogPosting|SocialMediaPosting|DiscussionForumPosting|Report)';

/** awk: the end of an attribute value. */
const END = `["' \\t\\/>]`;
/** awk: a `content` attribute of a meta element with a character that is not a space. */
const HAS_CONTENT = `l~/^meta[ \\t][^>]*content=["']?[ \\t]*[^"' \\t>]/`;

/**
 * Exits 0 when the page names an author (`a`) and a date (`d`) in markup the check reads: on a
 * JSON-LD block that holds an Article type, `author` (text that is not blank, an object, or a list
 * that is not empty) and `datePublished` (text with four digits in a row); a meta element with
 * content; and, outside the set-aside elements, a link with rel author, and, in the body (`b`),
 * itemprop author, itemprop datePublished, or a time element with a datetime attribute. AWK_SCRIPTS
 * makes each script element one line first, so a `<` in a block's text does not cut the block in two.
 */
const PROGRAM =
  `${AWK_SCRIPTS}${AWK_VISIBLE}l~/^body[ \\t>]/{b=1}` +
  `l~/^script[^>]*application\\/ld\\+json/&&$0~/${ldType(ARTICLE_NAMES)}/` +
  `{if($0~/"author"[ \\t]*:[ \\t]*("[ \\t]*[^" \\t]|\\{|\\[[ \\t]*[^] \\t])/)a=1;if($0~/"datePublished"[ \\t]*:[ \\t]*"[^"]*[0-9][0-9][0-9][0-9]/)d=1}` +
  `l~/^meta[ \\t][^>]*name=["']?author${END}/&&${HAS_CONTENT}{a=1}` +
  `l~/^meta[ \\t][^>]*property=["']?article:published_time${END}/&&${HAS_CONTENT}{d=1}` +
  `!c&&l~/^(a|link)[ \\t][^>]*rel=["']?([^"'>]*[ \\t])?author${END}/{a=1}` +
  `!c&&b&&l~/^[a-z0-9]+[ \\t][^>]*itemprop=["']?author${END}/{a=1}` +
  `!c&&b&&l~/^[a-z0-9]+[ \\t][^>]*itemprop=["']?datepublished${END}/{d=1}` +
  `!c&&b&&l~/^time[ \\t][^>]*datetime/{d=1}` +
  `END{exit !(a&&d)}`;

/**
 * What the readable command prints: a JSON-LD `author` or `datePublished` key with the characters
 * after it, and a tag that carries a byline attribute. It is looser than the check: a tag that only
 * mentions an author in a URL is printed too.
 */
const SEE_PATTERN =
  '"(author|datePublished)" *:.{0,80}|<[a-z]+ [^>]*(author|datetime|datePublished|published_time)[^>]*>';

const AUTHOR = mark('author');
const DATE = mark('datePublished');
const BYLINE_LINK = mark('rel="author"');
const TIME = mark('<time datetime>');

/** The documentation the generic steps rest on. */
export const missingAuthorDateSources: readonly DocSource[] = [
  {
    title: 'Article (Article, NewsArticle, BlogPosting) structured data | Google Search Central',
    url: 'https://developers.google.com/search/docs/appearance/structured-data/article',
    read: DOCS_READ,
    supports:
      '`author` (with `author.name`) and `datePublished` in ISO 8601, with timezone information, are recommended properties of an Article node',
  },
  {
    title: 'schema.org: Article',
    url: 'https://schema.org/Article',
    read: DOCS_READ,
    supports:
      '`author` is an Organization or a Person; `datePublished` is the date of first publication',
  },
];

const NEXTJS_SOURCES: readonly DocSource[] = [
  {
    title: 'How to implement JSON-LD in your Next.js application',
    url: 'https://nextjs.org/docs/app/guides/json-ld',
    read: DOCS_READ,
    supports:
      'render JSON-LD as a native `<script>` in `page.js` or `layout.js`, from `JSON.stringify` with `<` replaced by `\\u003c`',
  },
  missingAuthorDateSources[0]!,
];

const WORDPRESS_SOURCES: readonly DocSource[] = [
  {
    title: 'get_the_author_posts_link() | WordPress Developer Resources',
    url: 'https://developer.wordpress.org/reference/functions/get_the_author_posts_link/',
    read: DOCS_READ,
    supports:
      'the link `the_author_posts_link()` prints is `<a href="…" rel="author">` with the author’s display name',
  },
  {
    title: 'the_author_posts_link() | WordPress Developer Resources',
    url: 'https://developer.wordpress.org/reference/functions/the_author_posts_link/',
    read: DOCS_READ,
    supports: 'the template tag displays that link for the current post’s author',
  },
  {
    title: 'get_the_time() | WordPress Developer Resources',
    url: 'https://developer.wordpress.org/reference/functions/get_the_time/',
    read: DOCS_READ,
    supports: '`get_the_time( $format )` returns the post’s time in a PHP date format',
  },
  {
    title: 'the_date() | WordPress Developer Resources',
    url: 'https://developer.wordpress.org/reference/functions/the_date/',
    read: DOCS_READ,
    supports:
      "`the_date()` prints a date once per day of posts; `the_time( 'F j, Y' )` prints it on every post",
  },
  {
    title: 'PHP: DateTimeInterface::format',
    url: 'https://www.php.net/manual/en/datetime.format.php',
    read: DOCS_READ,
    supports: 'the format character `c` is the ISO 8601 date, e.g. 2004-02-12T15:19:21+00:00',
  },
];

const context = (fix: ContentDetection, facts: PacketFacts) =>
  contentContext(fix, facts, [
    line`The check applies to a page whose JSON-LD has an Article node (${mark('Article')}, ${mark('NewsArticle')}, ${mark('BlogPosting')} and the like) and passes it when the page names both an author and a publication date in markup. The audit does not record which of the two a failing page lacks.`,
    line`As an author it reads: ${AUTHOR} on the Article node (not empty), ${mark('<meta name="author">')} with content, a link with ${BYLINE_LINK}, or an element with ${mark('itemprop="author"')}.`,
    line`As a date it reads: ${DATE} on the Article node with a four-digit year, ${mark('<meta property="article:published_time">')} with content, an element with ${mark('itemprop="datePublished"')}, or a ${TIME} element.`,
  ]);

const keep = [
  KEEP_PAGE,
  line`Use the real author and the real date of first publication of each post, from the post's own fields: no placeholder name, and not the build date or today's date.`,
  line`Keep the Article node's other properties, and ${mark('dateModified')} separate from ${DATE} if the template prints it.`,
];

export const missingAuthorDate: PacketEntry<'missing_author_date'> = {
  kind: 'builder',
  context,
  generic: (fix) => ({
    change: [
      line`In the template ${template(fix)}, add to the Article node of the JSON-LD whichever of the two is missing: ${AUTHOR} as ${mark('{ "@type": "Person", "name": … }')} with the post's author, and ${DATE} with the post's publication date in ISO 8601 with its time zone (the form ${mark('2004-02-12T15:19:21+00:00')}).`,
      line`Fill both from the post's own fields, through the platform's JSON encoder, in the HTML the server sends. An empty ${AUTHOR} does not pass, and neither does a ${DATE} with no four-digit year.`,
      line`A visible byline passes too, if you would rather show one: the author's name in a link with ${BYLINE_LINK} and the date in a ${mark('<time datetime="…">')} element, in the page's own content. One inside ${SET_ASIDE} is not read.`,
    ],
    keep,
  }),
  stacks: {
    nextjs: {
      write: (fix) => ({
        change: [
          line`In the ${mark('page.js')} (or ${mark('layout.js')}) that renders ${template(fix)}, find the object the Article JSON-LD is built from and add whichever is missing: ${mark("author: { '@type': 'Person', name: … }")} and ${mark('datePublished: …')}, from the post's own fields, the date as an ISO 8601 string with its time zone.`,
          line`Render the object as the page already does, or as a native script element: ${mark('<script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd).replace(/</g, \'\\\\u003c\') }} />')}. Do not use ${mark('next/script')} for it.`,
          line`Confirm the block is in the HTML response, which is what the check and the verify command read. An empty ${AUTHOR} does not pass, and neither does a ${DATE} with no four-digit year.`,
        ],
        keep,
      }),
      sources: NEXTJS_SOURCES,
    },
    wordpress: {
      write: (fix) => ({
        change: [
          line`These steps assume a WordPress theme with PHP templates renders the page. If the front end is a separate application that reads WordPress as its data source, make the change there, as the generic steps describe.`,
          line`They add a visible byline, which the check reads, and leave the Article JSON-LD to the plugin or theme that prints it. In the theme template that renders ${template(fix)}, where the post is printed, print the author with ${mark('<?php the_author_posts_link(); ?>')}: it prints a link to the author's page with ${BYLINE_LINK}.`,
          line`Next to it, print the date in a time element: ${mark("<time datetime=\"<?php echo get_the_time( 'c' ); ?>\"><?php the_time( 'F j, Y' ); ?></time>")}. ${mark('c')} is PHP's ISO 8601 format; use ${mark('the_time()')} for the visible date, since ${mark('the_date()')} prints a date once per day of posts.`,
          line`Print both in the post's own content area: a byline inside ${SET_ASIDE} is not read.`,
        ],
        keep,
      }),
      sources: WORDPRESS_SOURCES,
    },
  },
  verify: (fix, facts) => {
    const page = firstFailingPage(fix);
    const probe = tagProbe(facts, page, PROGRAM);
    return {
      command: probe.command,
      ua: probe.ua,
      see: {
        command: seeMarkup(facts, page, SEE_PATTERN),
        today: line`The author and date markup in the page’s source, one match per line: each ${AUTHOR} and ${DATE} key of its JSON-LD with the 80 characters after it, and each tag that carries a byline attribute. The audit found that the page does not name both an author and a publication date in markup its check reads, and does not record which is missing. ${firstFailing(fix)}`,
        after: line`Both an author and a date: ${AUTHOR} and ${DATE} on the Article node, or a link with ${BYLINE_LINK} and a ${TIME} element.`,
      },
      expect: line`Exit status 0 when the first failing page names an author and a publication date in markup the check reads (the JSON-LD block of its Article node, a meta element, ${BYLINE_LINK}, ${mark('itemprop')}, ${TIME}); the audit's check failed that page. ${probe.sender} ${CHROME_GAP} ${RECHECK}`,
    };
  },
};
