/**
 * The front-end markers of a batch's first page (CC-30 Q2), read from the parsed page and the response
 * headers the worker already holds; no request is made for them.
 *
 * Each marker is one fixed test over where its framework writes it, and reads nothing else:
 *
 *   next_static_path            `/_next/static/` in a `script` element's `src` or a `link` element's `href`
 *   next_data_script            a `script` element whose `id` is `__NEXT_DATA__`
 *   shopify_theme_object        an assignment to `Shopify.theme` in the code of an inline `script` the
 *                               browser runs as JavaScript (no `type`, an empty one, `module`, or a
 *                               JavaScript MIME type), outside its comments, strings and
 *                               template literals
 *   shopify_section_class       an element with the class `shopify-section`
 *   wp_content_path             `/wp-content/` in any element's `src` or `href`
 *   webflow_site_attribute      a `data-wf-site` attribute on the `html` element
 *   hydrogen_powered_by_header  a `powered-by` response header naming both Shopify and Hydrogen
 *
 * Text outside scripts, other attributes, HTML comments, and everything inside a `textarea`, `template`
 * or `noscript` element are not read. What is returned is a list of FrontendMarker names, in that
 * enum's order: the tests answer yes or no, and nothing the page held is copied into it.
 *
 * Limits, stated: an element with the class `shopify-section` matches wherever the page puts it, user
 * content included; and the script reading does not recognise regular-expression literals, so a quote
 * inside one can hide an assignment after it, or expose the content of a string after it.
 *
 * The walk visits each node once without recursion: cheerio's selectors are slow on pages with many
 * top-level nodes (rows/links.ts), and this runs on every batch's first page.
 */
import { FrontendMarkerSchema, type FrontendMarker } from '@crawlmouse/types/v2';
import type { CheerioAPI } from 'cheerio';
import type { AnyNode, Element } from 'domhandler';

/** The headers as `StackHeaders` holds them: lower-cased names, a repeated header joined with ", ". */
type Headers = Readonly<Record<string, string>>;

const attr = (el: Element, name: string): string | undefined =>
  Object.hasOwn(el.attribs, name) ? el.attribs[name] : undefined;

const urlAttrIncludes = (el: Element, path: string): boolean =>
  [attr(el, 'src'), attr(el, 'href')].some((v) => v !== undefined && v.includes(path));

/** An inline script's code: its text children. */
const inlineCode = (el: Element): string =>
  el.children.map((c) => (c.type === 'text' ? c.data : '')).join('');

const isScript = (el: Element): boolean => el.name === 'script';

/**
 * The HTML standard's JavaScript MIME type essences (HTML Living Standard, "JavaScript MIME type"), and
 * `module`: a script whose trimmed `type` is one of these, case-insensitively, or empty or absent, is
 * run as JavaScript. Any other type (`application/ld+json`, `text/plain`, a template type) is data.
 */
const JS_TYPES: ReadonlySet<string> = new Set([
  '',
  'module',
  'application/ecmascript',
  'application/javascript',
  'application/x-ecmascript',
  'application/x-javascript',
  'text/ecmascript',
  'text/javascript',
  'text/javascript1.0',
  'text/javascript1.1',
  'text/javascript1.2',
  'text/javascript1.3',
  'text/javascript1.4',
  'text/javascript1.5',
  'text/jscript',
  'text/livescript',
  'text/x-ecmascript',
  'text/x-javascript',
]);
const runsAsJavaScript = (el: Element): boolean =>
  JS_TYPES.has((attr(el, 'type') ?? '').trim().toLowerCase());

/**
 * A script's code with its comments and the contents of its string and template literals blanked, so
 * only code is matched. A template literal is skipped to its closing backtick, `${…}` included.
 */
function codeOnly(src: string): string {
  let out = '';
  let i = 0;
  while (i < src.length) {
    const c = src[i]!;
    const next = src[i + 1];
    if (c === '/' && next === '/') {
      const end = src.indexOf('\n', i);
      i = end === -1 ? src.length : end;
      out += ' ';
    } else if (c === '/' && next === '*') {
      const end = src.indexOf('*/', i + 2);
      i = end === -1 ? src.length : end + 2;
      out += ' ';
    } else if (c === '"' || c === "'" || c === '`') {
      let j = i + 1;
      while (j < src.length && src[j] !== c) j += src[j] === '\\' ? 2 : 1;
      i = j + 1;
      out += ' ';
    } else {
      out += c;
      i += 1;
    }
  }
  return out;
}

/** An assignment to Shopify.theme: `=`, not `==`, `===` or `=>`. */
const SHOPIFY_THEME_ASSIGNED = /\bShopify\.theme\s*=(?![=>])/;

/** Elements whose content is not the page's markup as it renders, so nothing inside is read. */
const NOT_READ_INSIDE: ReadonlySet<string> = new Set(['textarea', 'template', 'noscript']);

/** The element tests, one per marker the page's markup carries. */
const ELEMENT_TESTS: Readonly<
  Record<Exclude<FrontendMarker, 'hydrogen_powered_by_header'>, (el: Element) => boolean>
> = {
  // Next.js serves its build assets under /_next/static/ (behind an assetPrefix too), as script files
  // and as preloaded or linked assets.
  next_static_path: (el) =>
    (el.name === 'script' && (attr(el, 'src') ?? '').includes('/_next/static/')) ||
    (el.name === 'link' && (attr(el, 'href') ?? '').includes('/_next/static/')),
  // The pages router writes its props into <script id="__NEXT_DATA__">.
  next_data_script: (el) => isScript(el) && attr(el, 'id') === '__NEXT_DATA__',
  // A Liquid theme's layout assigns the Shopify.theme object in an inline script; `Shopify.themes`
  // or `Shopify.theme_x` is another name.
  shopify_theme_object: (el) =>
    isScript(el) &&
    attr(el, 'src') === undefined &&
    runsAsJavaScript(el) &&
    SHOPIFY_THEME_ASSIGNED.test(codeOnly(inlineCode(el))),
  // A Liquid theme renders a section inside an element of class `shopify-section`.
  shopify_section_class: (el) =>
    (attr(el, 'class') ?? '').split(/[\t\n\f\r ]+/).includes('shopify-section'),
  wp_content_path: (el) => urlAttrIncludes(el, '/wp-content/'),
  // Webflow writes data-wf-site on a published page's <html> element.
  webflow_site_attribute: (el) => el.name === 'html' && attr(el, 'data-wf-site') !== undefined,
};
const ELEMENT_ENTRIES = Object.entries(ELEMENT_TESTS) as Array<
  [FrontendMarker, (el: Element) => boolean]
>;

/**
 * Hydrogen sets `powered-by: Shopify, Hydrogen` on the responses it finishes:
 * `headers.set("powered-by", "Shopify, Hydrogen")` in Shopify/hydrogen
 * packages/hydrogen/src/core/request-context.ts `applyResponseHeaders` (commit 752bf4d0), and
 * `response.headers.append('powered-by', 'Shopify, Hydrogen')` in packages/remix-oxygen/src/server.ts
 * at @shopify/remix-oxygen@2.0.9. The header is read as comma-separated tokens, so a value another
 * layer appended to is still read; both tokens must be there.
 */
function poweredByHydrogen(headers: Headers): boolean {
  if (!Object.hasOwn(headers, 'powered-by')) return false;
  const tokens = headers['powered-by']!.split(',').map((t) => t.trim().toLowerCase());
  return tokens.includes('shopify') && tokens.includes('hydrogen');
}

export function frontendMarkers($: CheerioAPI, headers: Headers): FrontendMarker[] {
  const found = new Set<FrontendMarker>();
  if (poweredByHydrogen(headers)) found.add('hydrogen_powered_by_header');
  const stack: AnyNode[] = $.root().toArray();
  while (stack.length) {
    const node = stack.pop()!;
    if (node.type === 'tag' || node.type === 'script' || node.type === 'style') {
      for (const [marker, test] of ELEMENT_ENTRIES) {
        if (!found.has(marker) && test(node)) found.add(marker);
      }
    }
    if (node.type === 'tag' && NOT_READ_INSIDE.has(node.name)) continue;
    // One push per child: a spread of a page's many top-level nodes could pass the argument limit.
    if ('children' in node) for (const child of node.children) stack.push(child);
  }
  return FrontendMarkerSchema.options.filter((m) => found.has(m));
}
