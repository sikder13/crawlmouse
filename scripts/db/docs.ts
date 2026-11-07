import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { renderChecksDoc } from './check';
import { REPO_ROOT } from './files';

/**
 * docs/ops/db-migrations.md holds the list of checks between `<!-- checks:start -->` and
 * `<!-- checks:end -->`, rendered from the check files. `tsx scripts/db/docs.ts` rewrites it;
 * docs.test.ts fails when the file differs from what this renders.
 */
export const DOC_PATH = join(REPO_ROOT, 'docs/ops/db-migrations.md');

const START = '<!-- checks:start -->';
const END = '<!-- checks:end -->';

export function renderDoc(doc: string, checks = renderChecksDoc()): string {
  const start = doc.indexOf(START);
  const end = doc.indexOf(END);
  if (start < 0 || end < start) throw new Error(`${DOC_PATH} has no ${START} ... ${END} block`);
  return `${doc.slice(0, start + START.length)}\n\n${checks}\n\n${doc.slice(end)}`;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  writeFileSync(DOC_PATH, renderDoc(readFileSync(DOC_PATH, 'utf8')));
  console.log(`wrote ${DOC_PATH}`);
}
