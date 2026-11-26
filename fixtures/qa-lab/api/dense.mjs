/**
 * The dense lab site: 2,000 pages, each linking to about 100 others, so a full check stores about
 * 200,000 link edges (c/038, for the persist work). `vercel.json` rewrites `dense.lab.crawlmouse.com`
 * here; every page is built from its path and fixed tables, with a seeded generator for its prose and
 * its links, so the site is the same on every request and between checks. This module imports no
 * file-system API, so no path can reach a file.
 *
 * The shape: the home page, 20 section pages and 1,979 note pages.
 * - The home page links to the 20 sections and to the first 80 notes: 100 links.
 * - A section links to the home page and to each of its notes (a note `n` is in section
 *   `((n - 1) mod 20) + 1`): 99 or 100 links.
 * - A note links to the home page, its section, the notes before and after it in its section, and to
 *   seeded other notes and sections, until it holds NOTE_LINKS distinct links.
 * So every note is two clicks from the home page, and the numbers above are what
 * scripts/qa/dense-lab.test.ts holds.
 */
import { createHash } from 'node:crypto';

export const HOSTS = { dense: 'dense.lab.crawlmouse.com' };
const HOST = HOSTS.dense;

export const SECTIONS = 20;
export const NOTES = 1979;
/** The distinct links a note holds. */
export const NOTE_LINKS = 100;
/** The notes the home page links to directly, beside its sections. */
const HOME_NOTES = 80;

const NAME = 'Corrowmere Field Notes';
const FOOTER = `${NAME} · A fictional publication: a Crawlmouse QA test site. Nothing here is real.`;

const pad = (n, w) => String(n).padStart(w, '0');
const sectionPath = (k) => `/s/${pad(k, 2)}/`;
const notePath = (n) => `/p/${pad(n, 4)}/`;
const sectionOf = (n) => ((n - 1) % SECTIONS) + 1;

/** mulberry32, as in generate.mjs: the same seed gives the same sequence on every run. */
function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const seedOf = (s) => createHash('sha256').update(s).digest().readUInt32LE(0);

const TOPICS = [
  'hedgerows',
  'drystone walls',
  'pond margins',
  'orchard grass',
  'coppice rows',
  'reed beds',
  'chalk downs',
  'river shingle',
  'heath edges',
  'meadow banks',
  'old quarries',
  'field ponds',
  'beech hangers',
  'salt marsh',
  'sunken lanes',
  'water meadows',
  'moss gardens',
  'cliff tops',
  'peat cuttings',
  'lime kilns',
];
const WORDS = (
  'sedge bramble lichen thistle bracken fern willow alder hazel ash rowan elder gorse heather ' +
  'sorrel clover yarrow vetch tansy burdock nettle teasel campion foxglove primrose violet orchid ' +
  'sparrow wren finch linnet thrush blackbird robin kestrel buzzard heron moorhen coot dipper ' +
  'beetle moth weevil bee hoverfly dragonfly damselfly spider snail slug newt toad frog vole ' +
  'shrew badger fox hare stoat weasel otter mole hedgehog bat owl swift swallow martin wagtail ' +
  'pipit lark chat warbler flint chalk clay loam peat sand gravel shale granite slate marl ' +
  'spring autumn frost thaw drought flood dew mist gale drizzle dusk dawn noon tide current ' +
  'bank ditch hedge gate stile path track ford bridge weir sluice culvert spinney copse ' +
  'measured counted mapped noted sampled recorded surveyed photographed sketched compared'
).split(' ');

function prose(seed, topic) {
  const r = rng(seed);
  const pick = () => WORDS[Math.floor(r() * WORDS.length)];
  const sentence = (n) => {
    const w = Array.from({ length: n }, pick);
    return `${w[0][0].toUpperCase()}${w[0].slice(1)} ${w.slice(1).join(' ')}.`;
  };
  return [0, 1, 2].map(
    (i) =>
      `${i === 0 ? `On the ${topic}: ` : ''}${Array.from({ length: 5 }, () => sentence(7 + Math.floor(r() * 6))).join(' ')}`,
  );
}

/** Every page: its path, title, topic and the paths it links to, in order. Built once. */
function build() {
  const pages = new Map();
  const home = { path: '/', title: NAME, topic: 'the whole district', links: [] };
  for (let k = 1; k <= SECTIONS; k++) home.links.push(sectionPath(k));
  for (let n = 1; n <= HOME_NOTES; n++) home.links.push(notePath(n));
  pages.set('/', home);
  for (let k = 1; k <= SECTIONS; k++) {
    const links = ['/'];
    for (let n = k; n <= NOTES; n += SECTIONS) links.push(notePath(n));
    pages.set(sectionPath(k), {
      path: sectionPath(k),
      title: `${TOPICS[k - 1][0].toUpperCase()}${TOPICS[k - 1].slice(1)}`,
      topic: TOPICS[k - 1],
      links,
    });
  }
  for (let n = 1; n <= NOTES; n++) {
    const k = sectionOf(n);
    const links = new Set(['/', sectionPath(k)]);
    if (n - SECTIONS >= 1) links.add(notePath(n - SECTIONS));
    if (n + SECTIONS <= NOTES) links.add(notePath(n + SECTIONS));
    const r = rng(seedOf(`dense-links:${n}`));
    while (links.size < NOTE_LINKS) {
      // Mostly other notes, now and then another section.
      const to =
        r() < 0.05
          ? sectionPath(1 + Math.floor(r() * SECTIONS))
          : notePath(1 + Math.floor(r() * NOTES));
      if (to !== notePath(n)) links.add(to);
    }
    pages.set(notePath(n), {
      path: notePath(n),
      title: `Note ${n}: ${TOPICS[k - 1]}`,
      topic: TOPICS[k - 1],
      links: [...links],
    });
  }
  return pages;
}

let site;
const siteOf = () => (site ??= build());

/** Every page's path, the home page first. */
export function paths() {
  return [...siteOf().keys()];
}

/** A page's links, by path; null for a path the site does not have. */
export function linksOf(path) {
  return siteOf().get(path)?.links ?? null;
}

const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

function renderPage(page) {
  const pages = siteOf();
  const [a, b, c] = prose(seedOf(`dense-prose:${page.path}`), page.topic);
  const items = page.links
    .map((to) => `<li><a href="${to}">${esc(pages.get(to).title)}</a></li>`)
    .join('');
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(page.title)} | ${NAME}</title>
<meta name="description" content="${esc(`${page.title}: notes from the field.`)}">
<link rel="canonical" href="https://${HOST}${page.path}">
</head>
<body>
<header><a href="/">${NAME}</a></header>
<main>
<h1>${esc(page.title)}</h1>
<p>${esc(a)}</p>
<p>${esc(b)}</p>
<p>${esc(c)}</p>
<nav aria-label="Related notes"><ul>${items}</ul></nav>
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

/** What the site answers for a path on a host. Anything but the dense host is a 404. */
export function answer({ host, path }) {
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
  const page = siteOf().get(path);
  if (!page) return { status: 404, type: HTML, body: NOT_FOUND };
  return { status: 200, type: HTML, body: renderPage(page) };
}

/** The host the request was made to: `host`, or `x-forwarded-host` when `host` is not this site's. */
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
  const out = answer({ host: hostOf(req.headers), path });
  res.statusCode = out.status;
  res.setHeader('content-type', out.type);
  res.setHeader('cache-control', 'no-store');
  res.end(out.body);
}
