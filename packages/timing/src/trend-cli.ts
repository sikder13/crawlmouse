/**
 * Prints the nightly trend: `trend-cli.ts <tonight-dir> <history-dir>`. Each directory holds a
 * samples.jsonl; the history directory holds one subdirectory per earlier nightly, named by its run
 * id, and a larger id is a later run.
 */
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { SAMPLES_FILE, parseSamples, type Sample } from './samples.js';
import { trendLines } from './trend.js';

const [tonight, historyDir] = process.argv.slice(2);
if (!tonight || !historyDir) {
  console.error('usage: trend-cli.ts <tonight-dir> <history-dir>');
  process.exit(2);
}

const read = (dir: string): Sample[] => {
  const file = join(dir, SAMPLES_FILE);
  return existsSync(file) ? parseSamples(readFileSync(file, 'utf8')) : [];
};

const current = read(tonight);
if (current.length === 0) {
  console.log(`- no samples tonight: ${join(tonight, SAMPLES_FILE)} is missing or empty`);
  process.exit(0);
}
const runs = existsSync(historyDir)
  ? readdirSync(historyDir)
      .filter((name) => /^\d+$/.test(name))
      .sort((a, b) => Number(b) - Number(a))
  : [];
for (const line of trendLines(
  current,
  runs.map((id) => read(join(historyDir, id))),
))
  console.log(line);
