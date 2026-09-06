import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { REPORTS_DIR, SNAPSHOTS_DIR, argNumber, argValue, ensureDir } from './paths.js';
import { buildReport, renderTable } from './diff.js';
import { AI_TOKENS, SEARCH_TOKENS } from './tokens.js';
import type { DomainSnapshot } from './types.js';

function loadRun(date: string): DomainSnapshot[] {
  const dir = join(SNAPSHOTS_DIR, date);
  if (!existsSync(dir)) throw new Error(`No snapshot run at ${dir}`);
  return readdirSync(dir)
    .filter((f) => f.endsWith('.json'))
    .map((f) => JSON.parse(readFileSync(join(dir, f), 'utf8')) as DomainSnapshot);
}

function main(): void {
  const argv = process.argv.slice(2);
  const from = argValue(argv, 'from');
  const to = argValue(argv, 'to');
  if (!from || !to) {
    throw new Error('Usage: pnpm research:diff -- --from <YYYY-MM-DD> --to <YYYY-MM-DD> [--examples N]');
  }

  const fromSnaps = loadRun(from);
  const toSnaps = loadRun(to);
  const exampleLimit = argNumber(argv, 'examples') ?? 0;

  const report = buildReport({ from, to, fromSnaps, toSnaps, aiTokens: AI_TOKENS, searchTokens: SEARCH_TOKENS, exampleLimit });

  ensureDir(REPORTS_DIR);
  const out = join(REPORTS_DIR, `${from}_to_${to}.json`);
  writeFileSync(out, `${JSON.stringify(report, null, 2)}\n`, 'utf8');

  console.log(renderTable(report));
  console.log(`\nReport written: ${out}`);
  if (exampleLimit > 0) {
    console.log(`\n--examples ${exampleLimit} was passed, so ${report.examples.length} domain name(s) are in the report.`);
    console.log('Remove it before publishing: the study publishes aggregates.');
  }
}

try {
  main();
} catch (e: unknown) {
  console.error(`\n${e instanceof Error ? e.message : String(e)}`);
  process.exitCode = 1;
}
