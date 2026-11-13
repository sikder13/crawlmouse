/**
 * Renders the manual preconditions (preconditions.ts rows with `check.kind === 'manual'`) as the box
 * list in docs/ops/go-live.md, between `<!-- golive:manual:start -->` and `<!-- golive:manual:end -->`.
 * Everything outside the markers is the document's own and is left as it is. checklist.test.ts fails
 * when the block in the file differs from the render.
 *
 *   pnpm --filter @crawlmouse/scripts exec tsx golive/checklist.ts --write
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { format, resolveConfig } from 'prettier';
import { MANUAL, PRECONDITIONS, type Precondition } from './preconditions';
import { GATED_PROBES } from './probes/index';
import { STEPS, STEP_TITLE } from './steps';

export const GO_LIVE_PATH = join(
  fileURLToPath(new URL('.', import.meta.url)),
  '../../docs/ops/go-live.md',
);
export const START = '<!-- golive:manual:start -->';
export const END = '<!-- golive:manual:end -->';

const box = (p: Precondition): string =>
  `- [ ] \`${p.id}\` (${p.owner}): ${p.mustBeTrue}. Why: ${p.why}. Source: \`${p.source}\`.`;

/** The ids of the automatic rows whose probe runs only on a checkout matching production. */
const gatedRows = (): string =>
  PRECONDITIONS.filter((p) => p.check.kind === 'auto' && GATED_PROBES.includes(p.check.probe))
    .map((p) => p.id)
    .join(', ');

/** The block, markers included, before formatting. */
export function renderBlock(rows: readonly Precondition[] = MANUAL): string {
  const lines = [
    START,
    '',
    '<!-- Rendered by scripts/golive/checklist.ts from scripts/golive/preconditions.ts. Do not edit by hand:',
    '     change the registry and run `pnpm --filter @crawlmouse/scripts exec tsx golive/checklist.ts --write`. -->',
    '',
    '### Manual preconditions',
    '',
    'The boxes are not ticked in this file. When one is true, pass its id to the check:',
    '`pnpm golive:check -- --step N --ticked id,id`. A manual row counts as not passing until it is passed.',
    '',
    "Run the check from a checkout of the live production commit. Its second line says whether this checkout's",
    "inputs (`CHECK_INPUTS` in `scripts/golive/probes/live.ts`) equal that commit's; until they do, the rows that read",
    `a table from this checkout (${gatedRows()}) answer unknown, and the`,
    "function counts printed in the boxes below are this checkout's.",
  ];
  for (const step of STEPS) {
    const rows_ = rows.filter((p) => p.gates === step);
    if (rows_.length === 0) continue;
    lines.push('', `#### Before step ${step}: ${STEP_TITLE[step]}`, '');
    if (step === 2)
      lines.push(
        "Step 1's exit check is part of this list: the rows that only the worker deploy makes true gate step 2.",
        '',
      );
    lines.push(...rows_.map(box));
  }
  lines.push('', END);
  return lines.join('\n');
}

/** The text between the markers, markers included, or null when the file has no block. */
export function blockOf(text: string): string | null {
  const start = text.indexOf(START);
  const end = text.indexOf(END);
  if (start < 0 || end < start) return null;
  return text.slice(start, end + END.length);
}

/** The file with its block replaced by the render (the whole file is the block when it has none), formatted. */
export async function renderFile(current: string | null, path = GO_LIVE_PATH): Promise<string> {
  const block = renderBlock();
  const existing = current === null ? null : blockOf(current);
  const text =
    current === null
      ? `${block}\n`
      : existing === null
        ? `${current.trimEnd()}\n\n${block}\n`
        : current.replace(existing, block);
  return format(text, { ...(await resolveConfig(path)), filepath: path });
}

if (
  process.argv[1] &&
  fileURLToPath(import.meta.url) === process.argv[1] &&
  process.argv.includes('--write')
) {
  // One read that may find no file, rather than a check then a read (CodeQL js/file-system-race).
  let current: string | null = null;
  try {
    current = readFileSync(GO_LIVE_PATH, 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }
  writeFileSync(GO_LIVE_PATH, await renderFile(current));
}
