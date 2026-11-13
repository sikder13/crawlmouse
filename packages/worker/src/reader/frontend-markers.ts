/**
 * The front-end markers of a batch's first page (CC-30 Q2), read from the parsed page and the response
 * headers the worker already holds; no request is made for them.
 *
 * Each marker is one fixed test over where its framework writes it: an asset URL in a `src` or `href`
 * attribute, a script's id, an inline script's code, an element's class, the root element's attribute,
 * a response header. Text nodes outside a script are not read, so a marker's literal in an article
 * or a code sample does not match. What is returned is a list of FrontendMarker names, in that enum's
 * order: the tests answer yes or no, and nothing the page held is copied into it.
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

const SHOPIFY_THEME = /\bShopify\.theme\b/;

/** The element tests, one per marker the page's markup carries. */
const ELEMENT_TESTS: Readonly<
  Record<Exclude<FrontendMarker, 'hydrogen_powered_by_header'>, (el: Element) => boolean>
> = {
  // Next.js serves its build assets under /_next/static/ (behind an assetPrefix too).
  next_static_path: (el) => urlAttrIncludes(el, '/_next/static/'),
  // The pages router writes its props into <script id="__NEXT_DATA__">.
  next_data_script: (el) => isScript(el) && attr(el, 'id') === '__NEXT_DATA__',
  // A Liquid theme's layout sets the Shopify.theme object in an inline script; `Shopify.themes` or
  // `Shopify.theme_x` is another name.
  shopify_theme_object: (el) =>
    isScript(el) && attr(el, 'src') === undefined && SHOPIFY_THEME.test(inlineCode(el)),
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
    // One push per child: a spread of a page's many top-level nodes could pass the argument limit.
    if ('children' in node) for (const child of node.children) stack.push(child);
  }
  return FrontendMarkerSchema.options.filter((m) => found.has(m));
}
