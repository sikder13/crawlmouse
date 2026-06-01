import * as cheerio from 'cheerio';
import { canonicalizeUrl } from './url-canonical.js';

const GENERIC_ANCHOR_PATTERNS = [
  /^(click here|read more|learn more|more info|here|this|link|go|continue)\.?$/i,
  /^(see more|find out more|get started|view more)$/i,
];

export interface ExtractedLink {
  toUrl: string;
  anchorText: string;
  isGenericAnchor: boolean;
}

export interface ExtractedPage {
  title?: string;
  links: ExtractedLink[];
}

// Host-equality after stripping a leading `www.` — NOT eTLD+1 / registrable-domain
// matching. This intentionally treats subdomains (blog./shop.) as different sites,
// matching the crawler's same-origin enqueue scope; spanning subdomains is a
// deliberate v1.0 non-goal (it would broaden crawl cost and the SSRF surface).
function sameHostIgnoringWww(a: URL, b: URL): boolean {
  const norm = (h: string) => h.replace(/^www\./, '').toLowerCase();
  return norm(a.hostname) === norm(b.hostname);
}

function isGeneric(anchor: string): boolean {
  const trimmed = anchor.trim();
  return GENERIC_ANCHOR_PATTERNS.some((p) => p.test(trimmed));
}

export function extractPage(html: string, baseUrl: string): ExtractedPage {
  const $ = cheerio.load(html);
  const title = $('title').first().text().trim() || undefined;

  const baseUrlObj = new URL(baseUrl);
  const links: ExtractedLink[] = [];

  $('a[href]').each((_, el) => {
    const href = ($(el).attr('href') ?? '').trim();
    if (!href || href.startsWith('#') || href.startsWith('javascript:') || href.startsWith('mailto:') || href.startsWith('tel:')) {
      return;
    }
    let resolved: URL;
    try {
      resolved = new URL(href, baseUrl);
    } catch {
      return;
    }
    if (resolved.protocol !== 'http:' && resolved.protocol !== 'https:') return;
    if (!sameHostIgnoringWww(resolved, baseUrlObj)) return;

    const anchorText = $(el).text().trim().replace(/\s+/g, ' ');
    links.push({
      toUrl: canonicalizeUrl(resolved.toString()),
      anchorText,
      isGenericAnchor: isGeneric(anchorText),
    });
  });

  return { title, links };
}
