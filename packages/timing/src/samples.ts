import { appendFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

/** One budgeted metric's reading: what the nightly uploads and the trend compares. */
export interface Sample {
  metric: string;
  unit: string;
  median: number;
  /** The limit the median was held to on this run. */
  limit: number;
  /** Whether the median met the limit, by the recorder's own rule. */
  pass: boolean;
  samples: number[];
}

/** The file, inside PERF_SAMPLES_DIR, that every recorder appends to. */
export const SAMPLES_FILE = 'samples.jsonl';

/** Appends the sample as one JSON line when `dir` is set; does nothing otherwise. */
export function recordSample(dir: string | undefined, sample: Sample): void {
  if (!dir) return;
  mkdirSync(dir, { recursive: true });
  appendFileSync(join(dir, SAMPLES_FILE), `${JSON.stringify(sample)}\n`);
}

/** The samples in a JSON-lines file's text. */
export function parseSamples(text: string): Sample[] {
  return text
    .split('\n')
    .filter((line) => line.trim() !== '')
    .map((line) => JSON.parse(line) as Sample);
}
