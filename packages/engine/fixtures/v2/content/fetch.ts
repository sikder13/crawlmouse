/**
 * Fetches the label set's pages once, through the engine's safeFetch, into a directory outside the
 * repository: the pages are other people's work, so only their URLs and features are tracked here.
 *
 *   pnpm --filter @crawlmouse/engine exec tsx fixtures/v2/content/fetch.ts <dir>
 *
 * Writes <dir>/raw/<id>.html and <dir>/index.json (URL → id, status, fetched_at). The ids are the
 * first 16 hex digits of the URL's sha256, as labels.json names them.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { safeFetch } from '../../../src/safe-fetch.js';
import labels from './labels.json' with { type: 'json' };

const dir = process.argv[2];
if (!dir) throw new Error('usage: fetch.ts <dir>');
mkdirSync(`${dir}/raw`, { recursive: true });
const index: Record<string, { id: string; status: number | null; fetched_at: string }> = {};
const last = new Map<string, number>();
for (const { url } of labels.pages) {
  const id = createHash('sha256').update(url).digest('hex').slice(0, 16);
  const host = new URL(url).host;
  const wait = 1500 - (Date.now() - (last.get(host) ?? 0));
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  last.set(host, Date.now());
  const fetched_at = new Date().toISOString();
  try {
    const res = await safeFetch(url, { userAgent: 'Crawlmouse/2.0 (+https://crawlmouse.com/bot)' });
    writeFileSync(`${dir}/raw/${id}.html`, res.body);
    index[url] = { id, status: res.status, fetched_at };
  } catch {
    index[url] = { id, status: null, fetched_at };
  }
}
writeFileSync(`${dir}/index.json`, JSON.stringify(index, null, 1));
