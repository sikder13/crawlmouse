import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Results files are built from an allow-list of fields (spike spec 4 item 4): hostnames, timings,
 * verdicts and byte counts. Headers, bodies, URLs with paths or queries, tokens and environment values
 * have no field to travel in. A value that is not a short scalar is dropped, not truncated.
 */

const FIXED_FIELDS = new Set([
  'kind', 'scenario', 'case', 'host', 'urlHash', 'outcome', 'state', 'status', 'ms', 'bytes', 'words', 'hops',
  'error', 'expect', 'result', 'pass', 'verdict', 'row', 'K', 'G', 'controlWords', 'browserMs', 'crawlmouseMs',
  'crawlDelayS', 'gapMs', 'requests', 'seconds', 'reqPerSec', 'started', 'maxInFlight', 'slowRuleFiredAtMs',
  'slowRuleFiredAtCount', 'fetched', 'newUrls', 'blocked', 'partial', 'skippedTotal', 'wallMs', 'site',
  'token', 'count', 'of', 'client', 'differs', 'httpStatus', 'reason', 'rssMb', 'heapUsedMb',
  'eventLoopLagP99Ms', 'batchesRunning', 'sampled', 'known', 'secondsToDone',
]);
// Per-identity columns written by the access batch: u:<token>, v:<token>, row:<token>, words:<token>, ms:<token>.
const COLUMN_PATTERN = /^(u|v|row|words|ms):[A-Za-z-]{3,24}$/;
const MAX_STRING = 120;

export type Scalar = string | number | boolean | null;

export function isAllowedField(name: string): boolean {
  return FIXED_FIELDS.has(name) || COLUMN_PATTERN.test(name);
}

export function allowList(row: Record<string, unknown>): Record<string, Scalar> {
  const out: Record<string, Scalar> = {};
  for (const [k, v] of Object.entries(row)) {
    if (!isAllowedField(k)) continue;
    if (v === null || typeof v === 'boolean') out[k] = v;
    else if (typeof v === 'number') out[k] = Number.isFinite(v) ? v : null;
    else if (typeof v === 'string' && v.length <= MAX_STRING && !/[\r\n]/.test(v) && !/^https?:\/\//i.test(v)) out[k] = v;
  }
  return out;
}

export interface ResultsFile {
  schema: 1;
  scenario: string;
  startedAt: string;
  finishedAt: string;
  rows: Array<Record<string, Scalar>>;
}

export function buildResults(scenario: string, startedAt: Date, finishedAt: Date, rows: Array<Record<string, unknown>>): ResultsFile {
  return {
    schema: 1,
    scenario,
    startedAt: startedAt.toISOString(),
    finishedAt: finishedAt.toISOString(),
    rows: rows.map(allowList),
  };
}

/** One JSON file per run; returns the path. */
export function writeResults(dir: string, file: ResultsFile): string {
  mkdirSync(dir, { recursive: true });
  const name = `${file.scenario}-${file.startedAt.replace(/[:.]/g, '-')}.json`;
  const path = join(dir, name);
  writeFileSync(path, JSON.stringify(file, null, 2) + '\n', { flag: 'wx' });
  return path;
}
