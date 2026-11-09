/**
 * Send one signed batch to the crawl worker, for operators (docs/ops/worker-runbook.md, "Send one
 * signed batch (operators)"). It signs and mints with the same functions the pipeline uses.
 *
 *   pnpm --filter @crawlmouse/scripts exec tsx worker-batch.ts --kind crawl \
 *     --url https://example.com/ [--url https://example.com/a …] --out /abs/path/result.json \
 *     [--budget-seconds 120]
 *
 * The three values come from scripts/.env.local (gitignored, mode 600): CRAWL_WORKER_URL,
 * WORKER_SIGNING_SECRET and WORKER_JWT_PRIVATE_KEY_PKCS8_B64. It prints counts, and a refusal's
 * kind, status and worker code; worker-batch.test.ts fails if one of the three values appears in its
 * output or its errors. One batch names one host, taken from the first URL; an access batch tests
 * each URL with its path as its template key.
 */
import { randomBytes, randomUUID } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import {
  workerClientFromEnv,
  SIGNING_SECRET_ENV,
  WORKER_URL_ENV,
} from '../apps/web/lib/worker-client/client';
import { isSiteHost, PRIVATE_KEY_ENV } from '../apps/web/lib/worker-client/jwt';
import { batchIdOf, type BatchPost, type PollResult } from '../apps/web/lib/worker-client/types';

export const POLL_INTERVAL_MS = 5_000;
/** How long past the batch's own time budget the script keeps polling. */
export const POLL_GRACE_S = 60;
export const DEFAULT_BUDGET_SECONDS = 120;
/** The worker's ceiling on max_seconds (packages/worker/src/batch/request.ts BUDGET_CEILINGS). */
export const MAX_BUDGET_SECONDS = 1800;
/** The worker's limit on URLs in one batch (MAX_URLS_PER_BATCH). */
const MAX_URLS = 50;
export const MAX_REQUESTS = 1000;
export const MAX_BYTES = 64 * 1024 * 1024;

const USAGE = `usage: worker-batch.ts --kind crawl|access --url <url> [--url <url> …] --out <file> [--budget-seconds <1-${MAX_BUDGET_SECONDS}>]`;

export interface ScriptIo {
  out(line: string): void;
  err(line: string): void;
  now(): number;
  sleep(ms: number): Promise<void>;
}

interface Args {
  kind: 'crawl' | 'access';
  urls: URL[];
  out: string;
  budgetSeconds: number;
}

/** KEY=value lines; the value is everything after the first `=`, trimmed. */
export function parseEnv(text: string): Record<string, string> {
  const env: Record<string, string> = {};
  for (const line of text.split('\n')) {
    const at = line.indexOf('=');
    if (line.trim().startsWith('#') || at < 1) continue;
    env[line.slice(0, at).trim()] = line.slice(at + 1).trim();
  }
  return env;
}

/** The arguments, or why they cannot be used. */
function parseArgs(argv: readonly string[]): Args | string {
  let kind: string | undefined;
  let out: string | undefined;
  let budget: string | undefined;
  const urls: string[] = [];
  const rest = argv[0] === '--' ? argv.slice(1) : argv;
  for (let i = 0; i < rest.length; i += 2) {
    const [flag, value] = [rest[i], rest[i + 1]];
    if (value === undefined) return `${flag} needs a value`;
    if (flag === '--kind') kind = value;
    else if (flag === '--url') urls.push(value);
    else if (flag === '--out') out = value;
    else if (flag === '--budget-seconds') budget = value;
    else return `unknown flag ${flag}`;
  }
  if (kind !== 'crawl' && kind !== 'access') return '--kind must be crawl or access';
  if (!out) return '--out is required';
  if (urls.length < 1 || urls.length > MAX_URLS) return `give 1 to ${MAX_URLS} --url`;
  const budgetSeconds = budget === undefined ? DEFAULT_BUDGET_SECONDS : Number(budget);
  if (!Number.isInteger(budgetSeconds) || budgetSeconds < 1 || budgetSeconds > MAX_BUDGET_SECONDS) {
    return `--budget-seconds must be a whole number from 1 to ${MAX_BUDGET_SECONDS}`;
  }
  const parsed: URL[] = [];
  for (const u of urls) {
    if (!URL.canParse(u)) return `not a URL: ${u}`;
    const url = new URL(u);
    if (url.protocol !== 'https:' && url.protocol !== 'http:') return `not an http(s) URL: ${u}`;
    if (url.port !== '') return `the worker fetches default ports only: ${u}`;
    parsed.push(url);
  }
  const host = parsed[0]!.hostname;
  if (!isSiteHost(host)) return `the first URL's host must be a DNS name: ${host}`;
  if (parsed.some((u) => u.hostname !== host)) {
    return `every URL must be on ${host}: one batch's JWT names one host`;
  }
  if (new Set(parsed.map((u) => u.href)).size !== parsed.length) return 'a URL is listed twice';
  return { kind, urls: parsed, out, budgetSeconds };
}

function batchOf(args: Args): BatchPost {
  const common = {
    check_id: randomUUID(),
    site_id: randomUUID(),
    site_host: args.urls[0]!.hostname,
    batch: 0,
    nonce: randomBytes(24).toString('base64url'),
    budget: { max_requests: MAX_REQUESTS, max_bytes: MAX_BYTES, max_seconds: args.budgetSeconds },
  };
  return args.kind === 'crawl'
    ? { ...common, kind: 'crawl', urls: args.urls.map((u) => u.href) }
    : {
        ...common,
        kind: 'access',
        pages: args.urls.map((u) => ({ url: u.href, template_key: u.pathname })),
      };
}

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

/** Counts from the result, which is not parsed here: a field that is not the expected shape reads `?`. */
function summary(result: unknown): string {
  const r = isRecord(result) ? result : {};
  const count = (v: unknown) => (Array.isArray(v) ? String(v.length) : '?');
  const rows =
    r.kind === 'access' ? `access tests ${count(r.access_tests)}` : `pages ${count(r.pages)}`;
  const requests = Number.isInteger(r.requests) ? String(r.requests) : '?';
  const reasons =
    isRecord(r.partial) && Array.isArray(r.partial.reasons) ? r.partial.reasons : null;
  const partial =
    r.partial === null
      ? 'none'
      : reasons && reasons.every((x) => typeof x === 'string' && /^[a-z_]{1,64}$/.test(x))
        ? reasons.join(', ')
        : '?';
  return `done: ${rows}, requests ${requests}, partial ${partial}`;
}

async function run(argv: readonly string[], env: Record<string, string | undefined>, io: ScriptIo) {
  const args = parseArgs(argv);
  if (typeof args === 'string') {
    io.err(args);
    io.err(USAGE);
    return 2;
  }
  let client;
  try {
    client = workerClientFromEnv(env);
  } catch (e) {
    io.err(e instanceof Error ? e.message : 'the worker values cannot be used');
    return 2;
  }
  if (!client) {
    io.err(
      `scripts/.env.local must set ${WORKER_URL_ENV}, ${SIGNING_SECRET_ENV} and ${PRIVATE_KEY_ENV}`,
    );
    return 2;
  }
  const batch = batchOf(args);
  await client.postBatch(batch);
  const n = args.urls.length;
  io.out(`posted: ${batch.kind} batch, ${n} ${n === 1 ? 'URL' : 'URLs'}`);
  const id = batchIdOf(batch.check_id, batch.batch);
  const deadline = io.now() + (args.budgetSeconds + POLL_GRACE_S) * 1000;
  let polled: PollResult;
  for (;;) {
    await io.sleep(POLL_INTERVAL_MS);
    polled = await client.pollBatch(id);
    if (polled.status !== 'running') break;
    if (io.now() >= deadline) {
      io.err(`the batch did not finish within ${args.budgetSeconds + POLL_GRACE_S} s`);
      return 1;
    }
  }
  if (polled.status !== 'done') {
    io.err(
      polled.status === 'failed'
        ? 'the batch failed inside the worker'
        : 'the worker no longer holds the batch (restarted, or its result expired)',
    );
    return 1;
  }
  let metrics: unknown = null;
  try {
    metrics = await client.readMetrics();
  } catch (e) {
    io.err(`metrics not sampled: ${e instanceof Error ? e.message : 'failed'}`);
  }
  writeFileSync(args.out, `${JSON.stringify({ result: polled.result, metrics }, null, 2)}\n`);
  io.out(summary(polled.result));
  io.out(`wrote ${args.out}`);
  return 0;
}

/**
 * Exit code 0 when the batch finished and was written, 1 when it did not, 2 when the arguments or
 * values cannot be used. It does not throw: a failure is one line on `err`, holding a WorkerError's
 * message (kind, status, worker code) or this script's own.
 */
export async function main(
  argv: readonly string[],
  env: Record<string, string | undefined>,
  io: ScriptIo,
): Promise<number> {
  try {
    return await run(argv, env, io);
  } catch (e) {
    io.err(e instanceof Error ? e.message : 'failed');
    return 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  let env: Record<string, string> = {};
  try {
    env = parseEnv(readFileSync(new URL('./.env.local', import.meta.url), 'utf8'));
  } catch {
    // A missing file is reported by main as missing values.
  }
  const io: ScriptIo = {
    out: (line) => console.log(line),
    err: (line) => console.error(line),
    now: () => Date.now(),
    sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  };
  main(process.argv.slice(2), env, io).then((code) => process.exit(code));
}
