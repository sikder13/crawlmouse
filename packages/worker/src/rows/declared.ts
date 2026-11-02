import { MAX_HREFLANG_LINKS, type DeclaredCanonical, type Hreflang } from '@crawlmouse/types/v2';
import type { Element } from 'cheerio';
import { bounded, CAPS, MAX_URL_LENGTH } from './bounded.js';
import { isWebUrl } from './evidence.js';

/**
 * What a page declares about itself in its head, as written: its rel=canonical, whatever host it
 * names (the page itself included), and its hreflang alternates. The canonical the engine's extractor
 * adopts (`canonical_url`, same host and not the page) is read separately, in links.ts; this is the
 * declaration a detector judges.
 *
 * Every string kept is made by the bounding helper. An href is resolved against the page's final URL,
 * as its links are.
 */

/** A declared canonical, or null when the page declares one that is not kept, and why. */
export interface CanonicalRead {
  canonical: DeclaredCanonical | null;
  note: string | null;
}

/** An href resolved against the page, when it names an http(s) URL within the URL cap. */
function resolve(href: string, base: string): string | null {
  let url: string;
  try {
    url = new URL(href, base).toString();
  } catch {
    return null;
  }
  return isWebUrl(url) ? bounded(url, CAPS.url) : null;
}

export const CANONICAL_NOT_KEPT = `The page's rel=canonical href is over ${MAX_URL_LENGTH} characters, or holds characters that cannot be stored as written, so it was not recorded.`;

/** The page's first rel=canonical (`el`), or none (`el` null, or a link without an href). */
export function declaredCanonical(el: Element | null, base: string): CanonicalRead {
  const raw = el?.attribs.href;
  if (raw === undefined) return { canonical: { href: null, url: null }, note: null };
  const href = bounded(raw, CAPS.declaredHref);
  if (href === null) return { canonical: null, note: CANONICAL_NOT_KEPT };
  return { canonical: { href, url: resolve(raw, base) }, note: null };
}

/** `link[rel~=alternate][hreflang]`: rel is a token list, compared without case. */
export function isAlternate(node: Element): boolean {
  if (node.name !== 'link' || node.attribs.hreflang === undefined) return false;
  const rel = node.attribs.rel;
  return (
    rel !== undefined &&
    rel
      .toLowerCase()
      .split(/[\t\n\f\r ]+/)
      .includes('alternate')
  );
}

/**
 * The alternates read from `elements` (at most MAX_HREFLANG_LINKS, in page order), `more` of them
 * found and not read. The list is incomplete when any was left out: one not read, a value or href not
 * kept, or an href that does not name an http(s) URL.
 */
export function hreflangOf(elements: readonly Element[], more: number, base: string): Hreflang {
  let complete = more === 0;
  const links: Hreflang['links'] = [];
  for (const el of elements.slice(0, MAX_HREFLANG_LINKS)) {
    const value = el.attribs.hreflang!;
    const hreflang = value === '' ? null : bounded(value, CAPS.hreflang);
    const href = el.attribs.href === undefined ? null : resolve(el.attribs.href, base);
    if (hreflang === null || href === null) complete = false;
    else links.push({ hreflang, href });
  }
  return { links, complete };
}

/** A `Link` response header that also declares hreflang alternates, which the worker does not read. */
export function headerDeclaresHreflang(link: string | string[] | undefined): boolean {
  if (link === undefined) return false;
  return (Array.isArray(link) ? link : [link]).some((v) => /hreflang\s*=/i.test(v));
}
