/**
 * slow.lab.crawlmouse.com: the one lab site that is not plain static files, because a static file cannot
 * answer late. `vercel.json` rewrites that host here. Each HTML page answers after DELAY_MS; robots.txt, the
 * sitemap and the stylesheet answer at once, so the delay is on the pages a crawl counts (journey J0.8g).
 *
 * It serves only the files listed under `sites/slow/`. The requested path is looked up in that list and never
 * joined to a directory, so no path can reach another file.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, extname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

export const DELAY_MS = 3000;

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', 'sites', 'slow');
const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.xml': 'application/xml; charset=utf-8',
};
const NOT_FOUND =
  '<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Not found</title></head>' +
  '<body><h1>Page not found</h1><p>There is no page at this address.</p></body></html>\n';

function listed(dir = ROOT) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? listed(join(dir, e.name)) : [relative(ROOT, join(dir, e.name))],
  );
}

/** The file a request path names, from the site's own list; null when it names none. */
export function fileFor(path, files) {
  if (typeof path !== 'string' || !path.startsWith('/')) return null;
  const wanted = path.endsWith('/') ? `${path.slice(1)}index.html` : path.slice(1);
  return files.includes(wanted) ? wanted : null;
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** What the site answers for a path. `read` and `wait` are parameters so the rule can be tested. */
export async function answer(path, { files, read, wait = sleep }) {
  const file = fileFor(path, files);
  if (file === null) return { status: 404, type: TYPES['.html'], body: NOT_FOUND };
  const ext = extname(file);
  if (ext === '.html') await wait(DELAY_MS);
  return { status: 200, type: TYPES[ext] ?? 'application/octet-stream', body: read(file) };
}

let files;

export default async function handler(req, res) {
  files ??= listed();
  const raw = new URL(req.url, 'https://slow.lab.crawlmouse.com').searchParams.get('path');
  const out = await answer(raw, { files, read: (f) => readFileSync(join(ROOT, f), 'utf8') });
  res.statusCode = out.status;
  res.setHeader('content-type', out.type);
  res.end(out.body);
}
