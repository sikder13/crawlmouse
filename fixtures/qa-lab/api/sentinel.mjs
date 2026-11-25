/**
 * sentinel.lab.crawlmouse.com: an ordinary small site whose robots.txt changes with the clock, for the
 * daily sentinel's journey step (J2.4i). A static file cannot change by itself, so `vercel.json` rewrites
 * this host here.
 *
 * During an odd UTC hour robots.txt disallows GPTBot; during an even one it allows every crawler. Every
 * other file of `sites/sentinel/` is served as it is, at once. The requested path is looked up in that
 * folder's list and never joined to a directory, so no path can reach another file.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, extname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', 'sites', 'sentinel');
const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.xml': 'application/xml; charset=utf-8',
};
const NOT_FOUND =
  '<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Not found</title></head>' +
  '<body><h1>Page not found</h1><p>There is no page at this address.</p></body></html>\n';

/** Whether robots.txt disallows GPTBot at `ms` (milliseconds since the epoch): during odd UTC hours. */
export const gptbotBlockedAt = (ms) => new Date(ms).getUTCHours() % 2 === 1;

/** robots.txt at `ms`. */
export function robotsAt(ms) {
  const lines = ['User-agent: *', 'Allow: /'];
  if (gptbotBlockedAt(ms)) lines.push('', 'User-agent: GPTBot', 'Disallow: /');
  lines.push('', 'Sitemap: https://sentinel.lab.crawlmouse.com/sitemap.xml');
  return `${lines.join('\n')}\n`;
}

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

/** What the site answers for a path at `now`. `read` is a parameter so the rule can be tested. */
export function answer(path, { files, read, now }) {
  if (path === '/robots.txt') return { status: 200, type: TYPES['.txt'], body: robotsAt(now) };
  const file = fileFor(path, files);
  if (file === null) return { status: 404, type: TYPES['.html'], body: NOT_FOUND };
  return {
    status: 200,
    type: TYPES[extname(file)] ?? 'application/octet-stream',
    body: read(file),
  };
}

let files;

export default function handler(req, res) {
  files ??= listed();
  const raw = new URL(req.url, 'https://sentinel.lab.crawlmouse.com').searchParams.get('path');
  const out = answer(raw, {
    files,
    read: (f) => readFileSync(join(ROOT, f), 'utf8'),
    now: Date.now(),
  });
  res.statusCode = out.status;
  res.setHeader('content-type', out.type);
  // robots.txt changes by the hour, so no cache may hold it across one.
  if (raw === '/robots.txt') res.setHeader('cache-control', 'no-store');
  res.end(out.body);
}
