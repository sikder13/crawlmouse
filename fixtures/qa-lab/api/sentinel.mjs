/**
 * The sentinel lab sites: ordinary small sites whose robots.txt changes with the clock, for the daily
 * sentinel. A static file cannot change by itself, so `vercel.json` rewrites both hosts here, and this
 * function tells them apart by the `Host` header:
 *
 *   sentinel.lab.crawlmouse.com    disallows GPTBot during an odd UTC hour (journey J2.4i)
 *   sentinel-b.lab.crawlmouse.com  disallows GPTBot on an even UTC day (days since 1970-01-01)
 *
 * A site's daily look falls in the same hour every day, set by its id (`sentinelHour`,
 * apps/web/lib/v2/monitor/sentinel.ts), so on the hourly host a site whose look falls in an even hour
 * never sees GPTBot blocked. On the daily host the hour does not matter: a full check on an odd day
 * records GPTBot allowed, and a look on the next day, an even one, finds it blocked. (A look and its
 * second look, minutes apart, that straddle midnight read two different days.)
 *
 * Each host serves the files of its own folder (`sites/sentinel/`, `sites/sentinel-b/`) as they are,
 * at once. The requested path is looked up in that folder's list and never joined to a directory, so
 * no path can reach another file.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, extname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const SITES_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'sites');
const DAY_MS = 24 * 60 * 60 * 1000;
const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.xml': 'application/xml; charset=utf-8',
};
const NOT_FOUND =
  '<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Not found</title></head>' +
  '<body><h1>Page not found</h1><p>There is no page at this address.</p></body></html>\n';

/** Whether the hourly host disallows GPTBot at `ms` (milliseconds since the epoch): during odd UTC hours. */
export const gptbotBlockedAt = (ms) => new Date(ms).getUTCHours() % 2 === 1;

/** Whether the daily host disallows GPTBot at `ms`: on an even UTC day, counted from 1970-01-01 (day 0). */
export const gptbotBlockedOnDayAt = (ms) => Math.floor(ms / DAY_MS) % 2 === 0;

/** The two hosts, each with its folder under `sites/` and its rule. */
export const HOSTS = {
  hourly: 'sentinel.lab.crawlmouse.com',
  daily: 'sentinel-b.lab.crawlmouse.com',
};
const SITES = {
  [HOSTS.hourly]: { folder: 'sentinel', blockedAt: gptbotBlockedAt },
  [HOSTS.daily]: { folder: 'sentinel-b', blockedAt: gptbotBlockedOnDayAt },
};

/** robots.txt at `ms` on `host` (the hourly host when not given). */
export function robotsAt(ms, host = HOSTS.hourly) {
  const lines = ['User-agent: *', 'Allow: /'];
  if (SITES[host].blockedAt(ms)) lines.push('', 'User-agent: GPTBot', 'Disallow: /');
  lines.push('', `Sitemap: https://${host}/sitemap.xml`);
  return `${lines.join('\n')}\n`;
}

function listed(root, dir = root) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? listed(root, join(dir, e.name)) : [relative(root, join(dir, e.name))],
  );
}

/** The file a request path names, from the site's own list; null when it names none. */
export function fileFor(path, files) {
  if (typeof path !== 'string' || !path.startsWith('/')) return null;
  const wanted = path.endsWith('/') ? `${path.slice(1)}index.html` : path.slice(1);
  return files.includes(wanted) ? wanted : null;
}

/**
 * What a site answers for a path at `now`: `files` and `read` are that host's folder, and parameters so
 * the rule can be tested. `host` picks the robots.txt rule (the hourly host when not given).
 */
export function answer(path, { files, read, now, host = HOSTS.hourly }) {
  if (path === '/robots.txt')
    return { status: 200, type: TYPES['.txt'], body: robotsAt(now, host) };
  const file = fileFor(path, files);
  if (file === null) return { status: 404, type: TYPES['.html'], body: NOT_FOUND };
  return {
    status: 200,
    type: TYPES[extname(file)] ?? 'application/octet-stream',
    body: read(file),
  };
}

/** The host the request was made to: `host`, or `x-forwarded-host` when `host` is not one of ours. */
export function hostOf(headers) {
  const clean = (h) =>
    String(h ?? '')
      .toLowerCase()
      .split(':')[0];
  const host = clean(headers.host);
  if (SITES[host]) return host;
  const forwarded = clean(headers['x-forwarded-host']);
  return SITES[forwarded] ? forwarded : null;
}

/** Each host's file list, read once per instance. */
const filesOf = {};

export default function handler(req, res) {
  const host = hostOf(req.headers);
  const raw = new URL(req.url, 'https://sentinel.lab.crawlmouse.com').searchParams.get('path');
  if (host === null) {
    res.statusCode = 404;
    res.setHeader('content-type', TYPES['.html']);
    res.end(NOT_FOUND);
    return;
  }
  const root = join(SITES_DIR, SITES[host].folder);
  filesOf[host] ??= listed(root);
  const out = answer(raw, {
    files: filesOf[host],
    read: (f) => readFileSync(join(root, f), 'utf8'),
    now: Date.now(),
    host,
  });
  res.statusCode = out.status;
  res.setHeader('content-type', out.type);
  // robots.txt changes with the clock, so no cache may hold it across a turn.
  if (raw === '/robots.txt') res.setHeader('cache-control', 'no-store');
  res.end(out.body);
}
