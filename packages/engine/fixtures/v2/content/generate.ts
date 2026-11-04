/**
 * Writes labels.json: for each labelled page, its features as readPage reads them now, beside its
 * labels, with the criteria the labels follow and the digest of the reader the features came from.
 * Run after fetch.ts, from a directory that also holds the labels:
 *
 *   pnpm --filter @crawlmouse/engine exec tsx fixtures/v2/content/generate.ts <dir>
 *
 * <dir>/labels/labels.json holds the labels, reasons, corrections and excerpt hashes, and
 * <dir>/labels/criteria.md the criteria (the excerpts themselves stay in <dir>/labels/excerpts,
 * untracked). A page whose HTML is missing is refused, not skipped: the label set does not shrink
 * silently.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { format, resolveConfig } from 'prettier';
import { readPage } from '../../../src/v2/content/read.js';
import { readerDigest } from '../grade/guard.js';

interface Labelled {
  id: string;
  url: string;
  fetched_at: string;
  excerpt_sha256: string;
  labels: Record<string, { label: string; reason: string }>;
  corrections: {
    check: string;
    from: { label: string; reason: string };
    to: string;
    cause: string;
  }[];
}

/** Why a label was corrected after the first reading. */
const CAUSES = {
  view_cut_heading_list:
    'the labelling view listed only the first 12 h2/h3 headings of a page; the full list was read',
  view_unflattened_json_ld:
    'the labelling view did not flatten JSON-LD nested in arrays, so a page with markup read as having none',
  view_missed_byline:
    'the labelling view scanned for a byline and missed one marked up as schema.org Person microdata',
  labeller_misread: 'the heading was in the view and the first reading missed it',
};

const dir = process.argv[2];
if (!dir) throw new Error('usage: generate.ts <dir>');
const labelled = JSON.parse(readFileSync(`${dir}/labels/labels.json`, 'utf8')) as Labelled[];
for (const p of labelled) {
  for (const c of p.corrections) {
    if (!(c.cause in CAUSES)) throw new Error(`${p.id}: unknown correction cause ${c.cause}`);
    if (p.labels[c.check]?.label !== c.to) throw new Error(`${p.id}: ${c.check} is not ${c.to}`);
  }
}
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
const json = JSON.stringify({
  criteria: readFileSync(`${dir}/labels/criteria.md`, 'utf8').trim().split('\n'),
  causes: CAUSES,
  reader_sha256: readerDigest(),
  pages,
});
const options = await resolveConfig(out.pathname);
writeFileSync(out, await format(json, { ...options, filepath: out.pathname }));
