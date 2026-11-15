#!/usr/bin/env node
/**
 * CC-36 D3, on a production build (`next start`): what each kept v1 public page serves, and a
 * comparison of two captures. Not part of the test suite; its output is evidence.
 *
 *   node scripts/kept-pages-proof.mjs capture <base-url> <out.json>
 *   node scripts/kept-pages-proof.mjs compare <a.json> <b.json> css|page
 *
 * `capture` fetches each page (the list below, and every /blog/<slug> and /authors/<slug> URL in the
 * server's /sitemap.xml) without following redirects and records: the status and Location; the
 * stylesheets linked (each href and the sha256 of the file it serves); the title, canonical, robots
 * meta, every og: and twitter: meta in order, the JSON-LD blocks parsed, the h1 texts; and the
 * `<main>` HTML. The whole document is read, not only <head>, because Next can stream metadata into
 * the body. On /ai-readiness-checker the form's container (the parent of the one <form>) is emptied
 * in `main` and its form's own attributes are recorded as `form`: that is the one part of a kept
 * page meant to differ under the flag (questions.md Q4).
 *
 * `compare … css` compares each page's stylesheets (hrefs and contents); `compare … page` compares
 * everything else. Each prints one line per page and exits 1 if any page differs, naming the field.
 */
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';

const PAGES = [
  '/ai-readiness-checker',
  '/blog',
  '/blog/research',
  '/bot',
  '/guides',
  '/login',
  '/status',
  '/takedown',
  '/privacy',
  '/terms',
  '/aup',
  '/subprocessors',
];
const FROM_SITEMAP = /^\/(blog\/(?!research$)[a-z0-9-]+|authors\/[a-z0-9-]+)$/;

const sha = (text) => createHash('sha256').update(text).digest('hex').slice(0, 16);

async function pathsOf(base) {
  const xml = await (await fetch(`${base}/sitemap.xml`)).text();
  const urls = [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => new URL(m[1]).pathname);
  return [...PAGES, ...urls.filter((p) => FROM_SITEMAP.test(p)).sort()];
}

async function capture(base, path, cssCache) {
  const res = await fetch(`${base}${path}`, { redirect: 'manual' });
  const html = await res.text();
  const { document } = new JSDOM(html).window;
  const attr = (sel, name) => [...document.querySelectorAll(sel)].map((e) => e.getAttribute(name));
  const stylesheets = [];
  for (const href of attr('link[rel="stylesheet"]', 'href')) {
    if (!cssCache.has(href)) cssCache.set(href, sha(await (await fetch(`${base}${href}`)).text()));
    stylesheets.push({ href, sha256: cssCache.get(href) });
  }
  const main = document.querySelector('main');
  let form = null;
  if (path === '/ai-readiness-checker' && main?.querySelector('form')) {
    const f = main.querySelector('form');
    form = Object.fromEntries([...f.attributes].map((a) => [a.name, a.value]));
    f.parentElement.innerHTML = '';
  }
  return {
    status: res.status,
    location: res.headers.get('location'),
    stylesheets,
    title: document.title,
    canonical: attr('link[rel="canonical"]', 'href'),
    robots: attr('meta[name="robots"]', 'content'),
    og: [...document.querySelectorAll('meta[property^="og:"]')].map((m) => [
      m.getAttribute('property'),
      m.getAttribute('content'),
    ]),
    twitter: [...document.querySelectorAll('meta[name^="twitter:"]')].map((m) => [
      m.getAttribute('name'),
      m.getAttribute('content'),
    ]),
    jsonLd: [...document.querySelectorAll('script[type="application/ld+json"]')].map((s) =>
      JSON.parse(s.textContent),
    ),
    h1: [...document.querySelectorAll('h1')].map((h) => h.textContent.trim()),
    mainCount: document.querySelectorAll('main').length,
    main: main?.outerHTML ?? null,
    form,
  };
}

const [mode, ...args] = process.argv.slice(2);
if (mode === 'capture') {
  const [base, out] = args;
  const cssCache = new Map();
  const pages = {};
  for (const path of await pathsOf(base)) pages[path] = await capture(base, path, cssCache);
  writeFileSync(
    out,
    JSON.stringify({ base, capturedAt: new Date().toISOString(), pages }, null, 1),
  );
  console.log(`captured ${Object.keys(pages).length} pages from ${base} into ${out}`);
} else if (mode === 'compare') {
  const [a, b, what] = args;
  const [A, B] = [a, b].map((f) => JSON.parse(readFileSync(f, 'utf8')).pages);
  const fields =
    what === 'css'
      ? ['stylesheets']
      : [
          'status',
          'location',
          'title',
          'canonical',
          'robots',
          'og',
          'twitter',
          'jsonLd',
          'h1',
          'mainCount',
          'main',
        ];
  let differ = 0;
  for (const path of [...new Set([...Object.keys(A), ...Object.keys(B)])]) {
    if (!A[path] || !B[path]) {
      differ += 1;
      console.log(`DIFFERS ${path}: captured in only one file`);
      continue;
    }
    const bad = fields.filter((f) => JSON.stringify(A[path][f]) !== JSON.stringify(B[path][f]));
    if (bad.length) differ += 1;
    const n = what === 'css' ? ` (${A[path].stylesheets.length} stylesheets)` : '';
    console.log(
      `${bad.length ? 'DIFFERS' : 'same   '} ${path}${n}${bad.length ? `: ${bad.join(', ')}` : ''}`,
    );
  }
  console.log(
    `${differ} of ${new Set([...Object.keys(A), ...Object.keys(B)]).size} pages differ (${what})`,
  );
  process.exit(differ ? 1 : 0);
} else {
  console.error('usage: capture <base-url> <out.json> | compare <a.json> <b.json> css|page');
  process.exit(2);
}
