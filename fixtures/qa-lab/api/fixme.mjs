/**
 * The fixme lab site: a small blog whose article template loses and regains its byline with the
 * UTC day, so one fix can be raised by a check and proven fixed by the next (row 22, "Fixed, and
 * proven"; c/043). `vercel.json` rewrites `fixme.lab.crawlmouse.com` here.
 *
 *   an even UTC day (days since 1970-01-01): the six articles carry an Article JSON-LD node with no
 *     author and no datePublished, and no byline markup (no meta author, no rel/itemprop author, no
 *     time element, no article:published_time). The engine's author_and_date check fails each, so a
 *     check opens `missing_author_date` on the article template.
 *   an odd UTC day: the same pages name an author and a publication date, in the JSON-LD and in a
 *     visible byline, so a check finds the template passing and the fix verified.
 *
 * Everything else is the same on both days: the prose, the links, the Article node's description
 * (so `missing_schema_description` is not raised either way), the sitemap and robots.txt.
 * scripts/qa/fixme-lab.test.ts reads both days through the engine's own reader and aggregator.
 * Pages are built from fixed tables; this module imports no file-system API.
 */
export const HOSTS = { fixme: 'fixme.lab.crawlmouse.com' };
const HOST = HOSTS.fixme;
const DAY_MS = 24 * 60 * 60 * 1000;

/** Whether the article template carries its byline at `ms`: on an odd UTC day. */
export const bylineAt = (ms) => Math.floor(ms / DAY_MS) % 2 === 1;

const NAME = 'Tallowford Bindery Journal';
const FOOTER = `${NAME} · A fictional publication: a Crawlmouse QA test site. Nothing here is real.`;
const AUTHOR = 'Ines Marrowby';

const ARTICLES = [
  {
    slug: 'sewing-signatures',
    title: 'Sewing signatures by hand',
    date: '2026-10-02',
    words: ['kettle stitch', 'linen thread', 'awl', 'signature', 'sewing frame', 'tension'],
  },
  {
    slug: 'choosing-book-cloth',
    title: 'Choosing book cloth',
    date: '2026-10-09',
    words: ['buckram', 'paper-backed cloth', 'grain', 'wear', 'colour', 'turn-in'],
  },
  {
    slug: 'rounding-and-backing',
    title: 'Rounding and backing a spine',
    date: '2026-10-16',
    words: ['backing hammer', 'shoulder', 'joint', 'press', 'glue', 'spine lining'],
  },
  {
    slug: 'marbled-endpapers',
    title: 'Marbled endpapers',
    date: '2026-10-23',
    words: ['size bath', 'carrageen', 'comb', 'pigment', 'gall', 'alum'],
  },
  {
    slug: 'repairing-a-broken-joint',
    title: 'Repairing a broken joint',
    date: '2026-10-30',
    words: ['japanese tissue', 'wheat starch', 'hinge', 'board', 'reattach', 'mull'],
  },
  {
    slug: 'gold-tooling',
    title: 'Gold tooling on leather',
    date: '2026-11-06',
    words: ['gold leaf', 'glaire', 'finishing tool', 'heat', 'blind tooling', 'morocco'],
  },
];

const prose = (a) => [
  `This note on ${a.title.toLowerCase()} gathers what the bindery has learned from repairs and new work: where ${a.words[0]} matters, and where ${a.words[1]} saves an afternoon.`,
  `Start with the ${a.words[2]} and the ${a.words[3]}. Most problems we see come from rushing this stage, and most of them show only months later, when the book has been read and opened flat a hundred times.`,
  `Finish by checking the ${a.words[4]} against the ${a.words[5]}. If they disagree, go back a step rather than forcing it; a binding that fights itself does not last.`,
];

/** The pages: home, the articles index, the six articles and an about page. */
function pageOf(path) {
  if (path === '/') {
    return {
      title: NAME,
      kind: 'home',
      paragraphs: [
        `${NAME} writes up the bench work of a small bindery: sewing, covering, repair and finishing, as the work comes in.`,
        'Each article follows one job from the first cut to the press, with the tools and the mistakes named.',
      ],
      links: [
        { href: '/articles/', text: 'All articles' },
        { href: '/about/', text: 'About the bindery' },
        ...ARTICLES.slice(0, 3).map((a) => ({ href: `/articles/${a.slug}/`, text: a.title })),
      ],
    };
  }
  if (path === '/articles/') {
    return {
      title: 'Articles',
      kind: 'index',
      paragraphs: [
        'Every article in the journal, newest last. Each one is a single job written up at the bench.',
      ],
      links: [
        { href: '/', text: 'Journal home' },
        ...ARTICLES.map((a) => ({ href: `/articles/${a.slug}/`, text: a.title })),
      ],
    };
  }
  if (path === '/about/') {
    return {
      title: 'About the bindery',
      kind: 'about',
      paragraphs: [
        'A two-bench bindery that takes in repairs from libraries and private collections, and makes a few new books each season.',
        'The journal is where the work is written down, so the next repair goes faster than the last.',
      ],
      links: [
        { href: '/', text: 'Journal home' },
        { href: '/articles/', text: 'Read the articles' },
      ],
    };
  }
  const i = ARTICLES.findIndex((a) => path === `/articles/${a.slug}/`);
  if (i === -1) return null;
  const a = ARTICLES[i];
  const next = ARTICLES[(i + 1) % ARTICLES.length];
  return {
    title: a.title,
    kind: 'article',
    article: a,
    paragraphs: prose(a),
    links: [
      { href: '/articles/', text: 'More articles' },
      { href: `/articles/${next.slug}/`, text: next.title },
    ],
  };
}

/** Every page's path, the home page first. */
export const paths = () => [
  '/',
  '/articles/',
  ...ARTICLES.map((a) => `/articles/${a.slug}/`),
  '/about/',
];

const esc = (s) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

function jsonLd(page, path, withByline) {
  const url = `https://${HOST}${path}`;
  if (page.kind !== 'article') {
    return { '@context': 'https://schema.org', '@type': 'WebPage', name: page.title, url };
  }
  const node = {
    '@context': 'https://schema.org',
    '@type': 'Article',
    headline: page.title,
    description: page.paragraphs[0],
    url,
  };
  if (withByline) {
    node.author = { '@type': 'Person', name: AUTHOR };
    node.datePublished = page.article.date;
  }
  return node;
}

function render(path, now) {
  const page = pageOf(path);
  const withByline = bylineAt(now);
  const byline =
    page.kind === 'article' && withByline
      ? `<p class="byline">By <span itemprop="author">${esc(AUTHOR)}</span>, <time datetime="${page.article.date}">${page.article.date}</time></p>\n`
      : '';
  const links = page.links.map((l) => `<li><a href="${l.href}">${esc(l.text)}</a></li>`).join('');
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(page.title)} | ${esc(NAME)}</title>
<meta name="description" content="${esc(page.paragraphs[0])}">
<link rel="canonical" href="https://${HOST}${path}">
<script type="application/ld+json">${JSON.stringify(jsonLd(page, path, withByline))}</script>
</head>
<body>
<header><a href="/">${esc(NAME)}</a></header>
<main>
<h1>${esc(page.title)}</h1>
${byline}${page.paragraphs.map((p) => `<p>${esc(p)}</p>`).join('\n')}
<nav aria-label="More from the journal"><ul>${links}</ul></nav>
</main>
<footer>${esc(FOOTER)}</footer>
</body>
</html>
`;
}

const HTML = 'text/html; charset=utf-8';
const NOT_FOUND =
  '<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Not found</title></head>' +
  '<body><h1>Page not found</h1><p>There is no page at this address.</p></body></html>\n';

/** What the site answers for a path on a host at `now`. Anything but the fixme host is a 404. */
export function answer({ host, path, now }) {
  if (host !== HOST || typeof path !== 'string')
    return { status: 404, type: HTML, body: NOT_FOUND };
  if (path === '/robots.txt') {
    return {
      status: 200,
      type: 'text/plain; charset=utf-8',
      body: `User-agent: *\nAllow: /\n\nSitemap: https://${HOST}/sitemap.xml\n`,
    };
  }
  if (path === '/sitemap.xml') {
    const urls = paths().map((p) => `  <url><loc>https://${HOST}${p}</loc></url>`);
    return {
      status: 200,
      type: 'application/xml; charset=utf-8',
      body: `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.join('\n')}\n</urlset>\n`,
    };
  }
  if (!paths().includes(path)) return { status: 404, type: HTML, body: NOT_FOUND };
  return { status: 200, type: HTML, body: render(path, now) };
}

/** The host the request was made to: `host` when it is this site's, else `x-forwarded-host`. */
export function hostOf(headers) {
  const clean = (h) =>
    String(h ?? '')
      .toLowerCase()
      .split(':')[0];
  const host = clean(headers?.host);
  return host === HOST ? host : clean(headers?.['x-forwarded-host']);
}

export default function handler(req, res) {
  const path = new URL(req.url, `https://${HOST}`).searchParams.get('path');
  const out = answer({ host: hostOf(req.headers), path, now: Date.now() });
  res.statusCode = out.status;
  res.setHeader('content-type', out.type);
  // The articles change with the UTC day, so no cache may hold a page across one.
  res.setHeader('cache-control', 'no-store');
  res.end(out.body);
}
