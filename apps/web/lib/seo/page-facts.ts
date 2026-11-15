/**
 * What a crawler reads on one rendered page, as data: the inputs to the SEO page audit
 * (`scripts/seo/audit.ts`, docs/seo/page-audit.md) and to the per-page rules (`page-rules.ts`).
 *
 * It takes a parsed `Document`, so the audit (HTML fetched from a production build) and the tests
 * (pages rendered in vitest) read pages the same way. Nothing here judges a page; the rules do.
 * Relative imports only: the audit script loads this file by path from outside apps/web.
 */

export interface Heading {
  level: number;
  text: string;
}

export interface JsonLdBlock {
  /** The block parsed, or null when its text is not JSON. */
  data: unknown;
  /** The text as served, kept for a block that does not parse. */
  raw: string;
}

export interface PageFacts {
  /** The page's path on the site, e.g. `/blog/orphan-pages`. */
  path: string;
  status: number;
  title: string | null;
  /** Every `<meta name="description">`, in document order. */
  descriptions: string[];
  h1: string[];
  /** Every h1–h6 in document order. */
  headings: Heading[];
  /** `<link rel="canonical">` hrefs, as written. */
  canonicals: string[];
  /** The Open Graph and Twitter tags a share card is built from, by property name. */
  social: Record<string, string[]>;
  /** `<meta name="robots">` contents, then the X-Robots-Tag header if one was given. */
  robots: string[];
  jsonLd: JsonLdBlock[];
  /** Internal link targets as paths (no query or fragment), in document order, repeats kept. */
  links: string[];
  /** Words in `<main>`, or in `<body>` when the page has no `<main>`. */
  wordCount: number;
  /** The `src` of each `<img>` with no `alt` attribute (`alt=""` is a decorative image, not a miss). */
  imagesWithoutAlt: string[];
  /** The page's visible text (scripts, styles and templates removed), whitespace collapsed. */
  visibleText: string;
  /** The same, for `<main>` (or `<body>` when there is no `<main>`). */
  mainText: string;
}

const clean = (s: string | null | undefined) => (s ?? '').replace(/\s+/g, ' ').trim();

/** Text of an element without the contents of script, style, noscript or template elements. */
function visibleTextOf(el: Element | null): string {
  if (!el) return '';
  const copy = el.cloneNode(true) as Element;
  copy.querySelectorAll('script, style, noscript, template').forEach((n) => n.remove());
  return clean(copy.textContent);
}

/**
 * `href` as a path on the site, or null when it points elsewhere. `origins` are the origins that
 * count as this site (the production origin and the build being audited).
 */
export function internalPath(
  href: string,
  pageUrl: string,
  origins: readonly string[],
): string | null {
  let url: URL;
  try {
    url = new URL(href, pageUrl);
  } catch {
    return null;
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
  if (!origins.includes(url.origin)) return null;
  const path = url.pathname.length > 1 ? url.pathname.replace(/\/+$/, '') : url.pathname;
  return path || '/';
}

export function pageFacts(
  doc: Document,
  args: {
    /** Absolute URL the page was read from (resolves relative links). */
    url: string;
    status: number;
    /** Origins whose links are internal. */
    origins: readonly string[];
    xRobotsTag?: string | null;
  },
): PageFacts {
  const all = (sel: string) => [...doc.querySelectorAll(sel)];
  const headings = all('h1, h2, h3, h4, h5, h6').map((h) => ({
    level: Number(h.tagName.slice(1)),
    text: clean(h.textContent),
  }));
  const links = all('a[href]')
    .map((a) => internalPath(a.getAttribute('href')!, args.url, args.origins))
    .filter((p): p is string => p !== null);
  const main = doc.querySelector('main') ?? doc.body;
  const mainText = visibleTextOf(main);
  return {
    path: new URL(args.url).pathname,
    status: args.status,
    title: doc.querySelector('head title')
      ? clean(doc.querySelector('head title')!.textContent)
      : null,
    descriptions: all('meta[name="description"]').map((m) => clean(m.getAttribute('content'))),
    h1: headings.filter((h) => h.level === 1).map((h) => h.text),
    headings,
    canonicals: all('link[rel="canonical"]').map((l) => l.getAttribute('href') ?? ''),
    social: social(all('meta[property^="og:"], meta[name^="twitter:"]')),
    robots: [
      ...all('meta[name="robots"]').map((m) => clean(m.getAttribute('content'))),
      ...(args.xRobotsTag ? [clean(args.xRobotsTag)] : []),
    ],
    jsonLd: all('script[type="application/ld+json"]').map((s) => {
      const raw = s.textContent ?? '';
      try {
        return { data: JSON.parse(raw) as unknown, raw };
      } catch {
        return { data: null, raw };
      }
    }),
    links,
    wordCount: mainText ? mainText.split(' ').length : 0,
    imagesWithoutAlt: all('img:not([alt])').map((i) => i.getAttribute('src') ?? ''),
    visibleText: visibleTextOf(doc.body),
    mainText,
  };
}

function social(metas: Element[]): Record<string, string[]> {
  const out = Object.create(null) as Record<string, string[]>;
  for (const m of metas) {
    const key = m.getAttribute('property') ?? m.getAttribute('name')!;
    (out[key] ??= []).push(clean(m.getAttribute('content')));
  }
  return out;
}

/** Heading levels that skip one or more levels after the heading before them (h2 → h4). */
export function skippedHeadings(headings: readonly Heading[]): { from: Heading; to: Heading }[] {
  const out: { from: Heading; to: Heading }[] = [];
  for (let i = 1; i < headings.length; i += 1) {
    if (headings[i]!.level > headings[i - 1]!.level + 1)
      out.push({ from: headings[i - 1]!, to: headings[i]! });
  }
  return out;
}

/** Each object with an `@type` in a JSON-LD value, depth first, `@graph` included. */
export function typedNodes(value: unknown): Record<string, unknown>[] {
  const out: Record<string, unknown>[] = [];
  const walk = (v: unknown) => {
    if (Array.isArray(v)) return v.forEach(walk);
    if (v === null || typeof v !== 'object') return;
    const obj = v as Record<string, unknown>;
    if (Object.hasOwn(obj, '@type')) out.push(obj);
    for (const [k, child] of Object.entries(obj)) if (k !== '@context') walk(child);
  };
  walk(value);
  return out;
}

/** A node's `@type` as a list (schema.org allows an array). */
export function typesOf(node: Record<string, unknown>): string[] {
  const t = node['@type'];
  return (Array.isArray(t) ? t : [t]).filter((x): x is string => typeof x === 'string');
}

/** The questions of every FAQPage node that the page's visible text does not contain. */
export function hiddenFaqQuestions(facts: Pick<PageFacts, 'jsonLd' | 'visibleText'>): string[] {
  const text = facts.visibleText;
  return facts.jsonLd
    .flatMap((b) => typedNodes(b.data))
    .filter((n) => typesOf(n).includes('Question'))
    .map((n) => (typeof n.name === 'string' ? clean(n.name) : ''))
    .filter((q) => !q || !text.includes(q));
}

/** Word 5-grams of a text, for near-duplicate comparison. */
export function shingles(text: string, n = 5): Set<string> {
  const w = text
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
  const out = new Set<string>();
  for (let i = 0; i + n <= w.length; i += 1) out.add(w.slice(i, i + n).join(' '));
  return out;
}

/** Jaccard similarity of two shingle sets, 0–1. */
export function jaccard(a: ReadonlySet<string>, b: ReadonlySet<string>): number {
  if (a.size === 0 && b.size === 0) return 0;
  let inter = 0;
  for (const x of a) if (b.has(x)) inter += 1;
  return inter / (a.size + b.size - inter);
}
