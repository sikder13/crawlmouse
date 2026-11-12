/**
 * The built-site fixture's synthetic shop: 60 URLs our crawler requests (59 reached by links from the
 * homepage, one only in the sitemap), each planted defect named where it is planted. Served by the worker's own test
 * server (worker/src/test-support/http.ts) in generate.ts; nothing here fetches.
 *
 * Every template key is one the web's recording synthesiser knows (apps/web/lib/v2/synthesise.ts
 * ROLES): `/`, `/collections/{slug}`, `/products/{slug}`, `/blog/{slug}`, `/journal/{slug}`,
 * `/guides/{slug}`. So every slug below has a hyphen, and the second page of a list is a query.
 * serve.ts answers HTTP requests from this; only generate.ts imports it, so the tests that read these
 * constants do not load the worker.
 *
 * PLANTED, one each (the build tests assert each from these constants, not from expected.json):
 *   ORPHAN            listed in the sitemap, linked from nowhere
 *   DEEP              four clicks from the homepage, the only path to it
 *   REDIRECT_FROM     a two-hop redirect chain to REDIRECT_TO, which nothing else links to
 *   CANONICAL_PAGE    declares CANONICAL_TARGET, which answers 404
 *   HREFLANG_PAGE     names HREFLANG_ALT as its French alternate; the alternate does not name it back
 *   PAGINATION_SECOND page 2 of a collection that repeats page 1
 *   CLIENT_RENDERED   every page of `/guides/{slug}` is an app shell filled in by JavaScript
 *   ROBOTS_BLOCKED    robots.txt disallows GPTBot from the whole site
 *   EDGE_REFUSED      the server refuses ClaudeBot with a 403 on every page, serving the others
 *   THIN              a page with a few words of main content
 *   STAGE2_CRAWLER    refused on `/blog/` pages only, so its stage-1 verdicts differ (stage 2 runs)
 */

export const ORPHAN = '/products/forgotten-lantern';
export const DEEP = '/journal/forged-steel-pegs';
export const REDIRECT_FROM = '/products/old-dome-tent';
export const REDIRECT_VIA = '/products/older-dome-tent';
export const REDIRECT_TO = '/products/dome-tent-classic';
export const CANONICAL_PAGE = '/products/camping-tents-item-2';
export const CANONICAL_TARGET = '/products/retired-tent';
export const HREFLANG_PAGE = '/blog/tent-care-guide';
export const HREFLANG_ALT = '/blog/tent-care-guide-fr';
export const PAGINATION_FIRST = '/collections/camping-tents';
export const PAGINATION_SECOND = '/collections/camping-tents?page=2';
export const CLIENT_RENDERED = [
  '/guides/getting-started-camping',
  '/guides/winter-camping-basics',
  '/guides/packing-checklist',
] as const;
export const ROBOTS_BLOCKED = 'GPTBot';
export const EDGE_REFUSED = 'ClaudeBot';
export const STAGE2_CRAWLER = 'PerplexityBot';
export const THIN = '/blog/coming-soon-note';

export const COLLECTIONS = [
  'camping-tents',
  'sleeping-bags',
  'camp-kitchen',
  'trail-backpacks',
  'rain-jackets',
  'camp-lighting',
] as const;
const productsOf = (c: string) =>
  Array.from({ length: 5 }, (_, i) => `/products/${c}-item-${i + 1}`);

/** The deep chain: each links to the next, and nothing else links to the last three. */
const CHAIN = [
  '/blog/how-to-pitch-a-tent',
  '/blog/choosing-tent-pegs',
  '/journal/peg-materials-compared',
  DEEP,
] as const;

const OTHER_POSTS = [
  '/blog/first-night-outdoors',
  '/blog/campfire-safety-basics',
  '/blog/layering-for-cold-nights',
  '/blog/water-on-the-trail',
  '/blog/leave-no-trace-rules',
  '/blog/reading-a-trail-map',
  '/blog/packing-light-tips',
  '/blog/rainy-day-camping',
  '/blog/camp-cooking-ideas',
] as const;

/** sitemap lastmod for the posts, so stage 2's "newest" has dates to read. */
export const LASTMOD: Readonly<Record<string, string>> = Object.fromEntries(
  [...CHAIN.slice(0, 2), ...OTHER_POSTS, HREFLANG_PAGE, HREFLANG_ALT].map((p, i) => [
    p,
    `2026-10-${String(10 + i).padStart(2, '0')}`,
  ]),
);

/**
 * Text of `n` words no other page uses: pages that shared their words would hash as near-duplicates
 * and leave the graded population (v1's classifier), which is not what any of them plants.
 */
const words = (n: number, seed: string) => {
  const stem = seed.toLowerCase().replace(/[^a-z0-9]/g, '');
  return Array.from({ length: n }, (_, i) => `${stem}${i}${i % 9 === 8 ? '.' : ''}`).join(' ');
};

const page = (opts: {
  title: string;
  body: string;
  head?: string;
  links?: readonly string[];
}): string =>
  `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${opts.title}</title>` +
  `<meta name="description" content="${opts.title} at the Built Site outdoor shop.">${opts.head ?? ''}</head>` +
  `<body><nav><a href="/">Home</a></nav><main>${opts.body}` +
  `${(opts.links ?? []).map((l) => `<p><a href="${l}">${anchorFor(l)}</a></p>`).join('')}</main>` +
  '<footer>Built Site outdoor shop</footer></body></html>';

const anchorFor = (path: string): string =>
  path === '/'
    ? 'Home'
    : path
        .replace(/^\/[a-z]+\//, '')
        .replace(/\?page=(\d+)/, ' page $1')
        .replace(/-/g, ' ');

const article = (title: string) =>
  `<h1>${title}</h1><p>${title} is something every camper asks about before a first trip. ` +
  `This guide explains what to look for, what to avoid, and how long it takes to learn.</p>` +
  `<h2>What should you pack first?</h2><p>${words(60, `${title}pack`)}</p>` +
  `<h2>How do you keep it dry?</h2><p>${words(60, `${title}dry`)}</p>`;

const product = (name: string) =>
  `<h1>${name}</h1><p>The ${name} is a reliable piece of kit for weekend trips and longer journeys.</p>` +
  `<table><tr><td>Weight: 1.2 kg</td></tr><tr><td>Packed size: 40 cm</td></tr></table>` +
  `<p>${words(140, name)}</p>`;

const productLd = (name: string) =>
  `<script type="application/ld+json">${JSON.stringify({
    '@context': 'https://schema.org',
    '@type': 'Product',
    name,
    description: `The ${name}.`,
  })}</script>`;

const APP_SHELL =
  '<!doctype html><html><head><title>Guide</title><script src="/static/app.js" defer></script></head>' +
  '<body><div id="root"></div><noscript>You need to enable JavaScript to run this app.</noscript></body></html>';

const html = (body: string): Response => ({ status: 200, type: 'text/html; charset=utf-8', body });

interface Response {
  status: number;
  type?: string;
  body: string;
  location?: string;
}

/** What the server answers at each path, as our crawler sees it. */
export function pages(): Map<string, Response> {
  const out = new Map<string, Response>();
  const home = [
    ...COLLECTIONS.map((c) => `/collections/${c}`),
    CHAIN[0],
    ...OTHER_POSTS,
    HREFLANG_PAGE,
    THIN,
    ...CLIENT_RENDERED,
  ];
  out.set(
    '/',
    html(
      page({
        title: 'Built Site outdoor shop',
        body: article('Outdoor gear for every trip'),
        links: home,
      }),
    ),
  );
  for (const c of COLLECTIONS) {
    const extra = c === 'camping-tents' ? [PAGINATION_SECOND, REDIRECT_FROM] : [];
    const title = c.replace(/-/g, ' ');
    out.set(
      `/collections/${c}`,
      html(page({ title, body: article(title), links: [...productsOf(c), ...extra] })),
    );
    for (const p of productsOf(c)) {
      const name = anchorFor(p);
      const head =
        p === CANONICAL_PAGE
          ? `<link rel="canonical" href="${CANONICAL_TARGET}">${productLd(name)}`
          : productLd(name);
      out.set(
        p,
        html(page({ title: name, head, body: product(name), links: [`/collections/${c}`] })),
      );
    }
  }
  // Page 2 repeats page 1: the same body, so the same main-content hash.
  out.set(PAGINATION_SECOND, out.get(PAGINATION_FIRST)!);
  out.set(REDIRECT_FROM, { status: 301, body: '', location: REDIRECT_VIA });
  out.set(REDIRECT_VIA, { status: 301, body: '', location: REDIRECT_TO });
  out.set(
    REDIRECT_TO,
    html(
      page({
        title: 'dome tent classic',
        head: productLd('dome tent classic'),
        body: product('dome tent classic'),
      }),
    ),
  );
  out.set(CANONICAL_TARGET, {
    status: 404,
    type: 'text/html',
    body: '<html><body>Not found</body></html>',
  });
  out.set(
    ORPHAN,
    html(
      page({
        title: 'forgotten lantern',
        head: productLd('forgotten lantern'),
        body: product('forgotten lantern'),
      }),
    ),
  );
  CHAIN.forEach((p, i) => {
    const next = CHAIN[i + 1];
    out.set(
      p,
      html(page({ title: anchorFor(p), body: article(anchorFor(p)), links: next ? [next] : [] })),
    );
  });
  for (const p of OTHER_POSTS) {
    const links = p === OTHER_POSTS[0] ? [CANONICAL_TARGET] : [];
    out.set(p, html(page({ title: anchorFor(p), body: article(anchorFor(p)), links })));
  }
  const alternates = (self: string, other: string, both: boolean) =>
    `<link rel="alternate" hreflang="${self === HREFLANG_PAGE ? 'en' : 'fr'}" href="${self}">` +
    (both
      ? `<link rel="alternate" hreflang="fr" href="${other}"><link rel="alternate" hreflang="x-default" href="${self}">`
      : '');
  out.set(
    HREFLANG_PAGE,
    html(
      page({
        title: 'tent care guide',
        head: alternates(HREFLANG_PAGE, HREFLANG_ALT, true),
        body: article('Tent care guide'),
        links: [HREFLANG_ALT],
      }),
    ),
  );
  out.set(
    HREFLANG_ALT,
    html(
      page({
        title: 'guide entretien tente',
        head: alternates(HREFLANG_ALT, HREFLANG_PAGE, false),
        body: article('Guide entretien tente'),
        links: [HREFLANG_PAGE],
      }),
    ),
  );
  out.set(THIN, html(page({ title: 'coming soon', body: '<h1>Soon</h1><p>More soon.</p>' })));
  for (const g of CLIENT_RENDERED) out.set(g, html(APP_SHELL));
  return out;
}

/** What a browser shows once the app shell's script has run: the guide's text. */
export function renderedGuide(path: string): string {
  return page({ title: anchorFor(path), body: article(anchorFor(path)) });
}

/**
 * The guides as the live proof serves them (serve.ts `guidesWithIntro`; the recorded fixture does
 * not): the heading and a line of intro are in the HTML response, which makes the page a content page
 * to the classifier, and the sections arrive by JavaScript. The state the script reads is inline in
 * the response, so a word count that keeps script text would count the sections too.
 */
const guideIntro = (title: string) =>
  `<h1>${title}</h1><p>${title} takes some preparation before a first trip, and this guide walks ` +
  'through what to pack first and how to keep your kit dry on the trail.</p>';

const guideSections = (title: string) =>
  `<h2>What should you pack first?</h2><p>${words(60, `${title}pack`)}</p>` +
  `<h2>How do you keep it dry?</h2><p>${words(60, `${title}dry`)}</p>`;

function guideDocument(path: string, root: string): string {
  const title = anchorFor(path);
  const state = JSON.stringify({ sections: guideSections(title) }).replace(/</g, '\\u003c');
  return (
    `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${title}</title>` +
    '<script src="/static/app.js" defer></script></head>' +
    `<body><nav><a href="/">Home</a></nav><main>${guideIntro(title)}<div id="root">${root}</div></main>` +
    `<script id="__STATE__" type="application/json">${state}</script>` +
    '<noscript>You need to enable JavaScript to read this guide.</noscript>' +
    '<footer>Built Site outdoor shop</footer></body></html>'
  );
}

/** A guide's HTML response with its intro served and its sections left to the script. */
export const guideWithIntro = (path: string): string => guideDocument(path, '');

/** What a browser shows of `guideWithIntro` once the script has filled the root in. */
export const renderedGuideWithIntro = (path: string): string =>
  guideDocument(path, guideSections(anchorFor(path)));

export const ROBOTS_TXT =
  'User-agent: *\nAllow: /\n\n' +
  `User-agent: ${ROBOTS_BLOCKED}\nDisallow: /\n\n` +
  '# Content-Signal: search=yes, ai-input=yes, ai-train=no\n' +
  'Sitemap: /sitemap.xml\n';

/**
 * The sitemap's URLs: every page answering 200 at its own URL, the orphan among them, less page 2 of
 * a list and the redirect chain's final URL. A sitemap listing that URL would have the crawl request
 * it as a page of its own, which the `variant` below does by a link (generate.ts says why).
 */
export function sitemapPaths(): string[] {
  return [...pages().entries()]
    .filter(([p, r]) => r.status === 200 && p !== PAGINATION_SECOND && p !== REDIRECT_TO)
    .map(([p]) => p)
    .sort();
}
