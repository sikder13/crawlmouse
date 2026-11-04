/**
 * Writes labels.json: for each labelled page, its features as readPage reads them now, beside the
 * person's labels. Run after fetch.ts, from a directory that also holds the labels:
 *
 *   pnpm --filter @crawlmouse/engine exec tsx fixtures/v2/content/generate.ts <dir>
 *
 * <dir>/labels/labels.json holds the labels, reasons, corrections and excerpt hashes (the excerpts
 * themselves stay in <dir>/labels/excerpts, untracked). A page whose HTML is missing is refused, not
 * skipped: the label set does not shrink silently.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { format, resolveConfig } from 'prettier';
import { readPage } from '../../../src/v2/content/read.js';

interface Labelled {
  id: string;
  url: string;
  fetched_at: string;
  excerpt_sha256: string;
  labels: Record<string, { label: string; reason: string }>;
  corrections: string[];
}

const dir = process.argv[2];
if (!dir) throw new Error('usage: generate.ts <dir>');
const labelled = JSON.parse(readFileSync(`${dir}/labels/labels.json`, 'utf8')) as Labelled[];
const pages = labelled
  .map((p) => ({
    url: p.url,
    fetched_at: p.fetched_at,
    excerpt_sha256: p.excerpt_sha256,
    features: readPage(readFileSync(`${dir}/raw/${p.id}.html`, 'utf8')),
    labels: p.labels,
    corrections: p.corrections,
  }))
  .sort((a, b) => (a.url < b.url ? -1 : 1));
const out = new URL('./labels.json', import.meta.url);
const json = JSON.stringify({ criteria: 'docs/specs/v2/17-content-and-grade.md', pages });
const options = await resolveConfig(out.pathname);
writeFileSync(out, await format(json, { ...options, filepath: out.pathname }));
