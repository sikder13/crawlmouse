/**
 * `pnpm golive:check` (CC-35 D3): whether production is ready for a switch-on step. Read-only: every
 * request goes through `guardedFetch` (GET to fixed hosts, plus Supabase's read-only query), and the
 * git commands it runs read the local clone.
 *
 *   pnpm golive:check -- [--step N] [--ticked id,id] [--env-file path]
 *
 * Prints every precondition, grouped by the step it gates, as `pass`, `fail`, `unknown (reason)` or
 * `manual`; exits 1 when a row gating step N or an earlier one is not `pass` (a manual row passes only
 * when its id is in `--ticked`), 0 when none is, 2 when the arguments cannot be used. `--step`
 * defaults to 1: which steps are done cannot be read without reading the flags' values, which the
 * check never requests.
 *
 * Tokens come from `scripts/.env.local` of this checkout (or `--env-file`), and from the process
 * environment for the names in `TOKEN_ENV`. Every value of that file, every token, and every string a
 * response carried is redacted from everything the command writes (redact.ts).
 */
import { execFile } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { CATALOG } from '../../apps/web/lib/billing/catalog';
import { listMigrations } from '../db/files';
import {
  FORBIDDEN_ENV,
  OPTIONAL_ENV,
  PLATFORM_ENV,
  READ_BY_LIBRARIES,
  REQUIRED_ENV,
  SWITCH_FLAGS,
  TEST_ONLY_ENV,
  WORKER_FLY_ENV,
} from './env-classes';
import { REPO_ROOT } from './env-scan';
import { ALLOWED_HOSTS, guardedFetch } from './http';
import { PRECONDITIONS, type Precondition } from './preconditions';
import { PAID_PLAN_TICK } from './probes/inngest';
import { PROBES, type ProbeId } from './probes/index';
import type { GitResult, Probe, ProbeDeps, ProbeResult } from './probes/types';
import { Redactor, TOKEN_ENV } from './redact';
import { STEPS, STEP_TITLE, isStep, type Step } from './steps';

export const USAGE = 'usage: pnpm golive:check -- [--step 1-5] [--ticked id,id] [--env-file path]';
export const DEFAULT_ENV_FILE = join(REPO_ROOT, 'scripts/.env.local');

export interface Args {
  step: Step;
  ticked: Set<string>;
  envFile: string;
}

/** The arguments, or a message saying what is wrong with them. */
export function parseArgs(argv: readonly string[]): Args | string {
  const args: Args = { step: 1, ticked: new Set(), envFile: DEFAULT_ENV_FILE };
  for (let i = 0; i < argv.length; i += 1) {
    const flag = argv[i];
    const value = argv[i + 1];
    if (flag === '--') continue;
    if (flag !== '--step' && flag !== '--ticked' && flag !== '--env-file')
      return `unknown argument ${flag}`;
    if (value === undefined) return `${flag} needs a value`;
    i += 1;
    if (flag === '--step') {
      const n = Number(value);
      if (!isStep(n)) return '--step is a step from 1 to 5';
      args.step = n;
    } else if (flag === '--ticked') {
      for (const id of value
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean)) {
        if (!PRECONDITIONS.some((p) => p.id === id) && id !== PAID_PLAN_TICK)
          return `--ticked names no row: ${id}`;
        args.ticked.add(id);
      }
    } else {
      args.envFile = value;
    }
  }
  return args;
}

/**
 * The env file's path. pnpm runs the script with `scripts/` as its working directory and names the
 * caller's directory in `INIT_CWD`, so a relative `--env-file` is resolved against that.
 */
export function resolveEnvFile(path: string, initCwd: string | undefined): string {
  if (isAbsolute(path)) return path;
  return resolve(initCwd || process.cwd(), path);
}

/** `KEY=value` lines; blanks and `#` comments skipped, one pair of surrounding quotes removed. */
export function parseEnvFile(text: string): Record<string, string> {
  const env: Record<string, string> = {};
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const m = /^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/.exec(line);
    if (!m) continue;
    let v = m[2]!;
    if (v.length >= 2 && (v[0] === '"' || v[0] === "'") && v.endsWith(v[0]!)) v = v.slice(1, -1);
    env[m[1]!] = v;
  }
  return env;
}

/** The names the check itself prints: code constants, so a response repeating one is not redacted. */
export function vocabulary(): Set<string> {
  const envNames = [
    ...STEPS.flatMap((s) => Object.keys(REQUIRED_ENV[s])),
    ...[
      OPTIONAL_ENV,
      SWITCH_FLAGS,
      PLATFORM_ENV,
      TEST_ONLY_ENV,
      WORKER_FLY_ENV,
      READ_BY_LIBRARIES,
      FORBIDDEN_ENV,
    ].flatMap((c) => Object.keys(c)),
  ];
  let versions: string[] = [];
  try {
    versions = listMigrations().flatMap((m) => [m.version, m.name]);
  } catch {
    // Without the directory the migrations probe reports it; the vocabulary is only narrower.
  }
  return new Set([
    ...envNames,
    ...Object.keys(CATALOG),
    ...versions,
    ...ALLOWED_HOSTS,
    ...PRECONDITIONS.map((p) => p.id),
    'crawlmouse.com',
    'production',
  ]);
}

export interface CheckDeps {
  /** The values loaded from the env file, merged with the TOKEN_ENV names of the process environment. */
  env: Record<string, string | undefined>;
  /** The network, before the guard; the check wraps it. */
  fetch: typeof fetch;
  now: () => Date;
  git: (args: readonly string[]) => Promise<GitResult>;
  out: (line: string) => void;
  err: (line: string) => void;
  probes?: Readonly<Record<ProbeId, Probe>>;
}

const line = (p: Precondition, r: ProbeResult | 'manual' | 'ticked'): string => {
  if (r === 'manual') return `  ${p.id}: manual — tick in docs/ops/go-live.md`;
  if (r === 'ticked') return `  ${p.id}: pass (ticked)`;
  return `  ${p.id}: ${r.status} (${r.reason})`;
};

/** Runs every probe once and prints every row; returns the exit code. */
export async function runCheck(args: Args, deps: CheckDeps, redactor: Redactor): Promise<number> {
  const out = (s: string) => deps.out(redactor.redact(s));
  const probeDeps: ProbeDeps = {
    fetch: guardedFetch(deps.fetch, (v) => redactor.addReceived(v), deps.env),
    env: deps.env,
    now: deps.now,
    git: deps.git,
    ticked: args.ticked,
  };
  const probes = deps.probes ?? PROBES;
  const results = new Map<ProbeId, ProbeResult>();
  for (const p of PRECONDITIONS) {
    if (p.check.kind !== 'auto' || results.has(p.check.probe)) continue;
    let r: ProbeResult;
    try {
      r = await probes[p.check.probe](probeDeps);
    } catch (e) {
      // Not the message: an error from a fetch or a library can quote what it was sent or received.
      r = {
        status: 'unknown',
        reason: `the probe failed (${e instanceof Error ? e.name : 'error'})`,
      };
    }
    results.set(p.check.probe, r);
  }
  const blocking: string[] = [];
  out(`golive:check — gating step ${args.step} (${STEP_TITLE[args.step]})`);
  for (const step of STEPS) {
    out('');
    out(`step ${step}: ${STEP_TITLE[step]}`);
    for (const p of PRECONDITIONS.filter((x) => x.gates === step)) {
      let passed: boolean;
      if (p.check.kind === 'manual') {
        passed = args.ticked.has(p.id);
        out(line(p, passed ? 'ticked' : 'manual'));
      } else {
        const r = results.get(p.check.probe)!;
        passed = r.status === 'pass';
        out(line(p, r));
      }
      if (step <= args.step && !passed) blocking.push(p.id);
    }
  }
  out('');
  const through = args.step === 1 ? 'step 1' : `steps 1–${args.step}`;
  if (blocking.length === 0) {
    out(`ready for step ${args.step}: every row gating ${through} passes`);
    return 0;
  }
  out(
    `not ready for step ${args.step}: ${blocking.length} rows gating ${through} do not pass: ${blocking.join(', ')}`,
  );
  return 1;
}

/** Parses the arguments, loads the env file and runs the check. Never throws: a failure is one line on err. */
export async function main(
  argv: readonly string[],
  deps: Omit<CheckDeps, 'env'> & {
    processEnv: Record<string, string | undefined>;
    readFile?: (path: string) => string | null;
  },
): Promise<number> {
  const redactor = new Redactor(vocabulary());
  const err = (s: string) => deps.err(redactor.redact(s));
  try {
    const args = parseArgs(argv);
    if (typeof args === 'string') {
      err(args);
      err(USAGE);
      return 2;
    }
    const read = deps.readFile ?? ((p: string) => (existsSync(p) ? readFileSync(p, 'utf8') : null));
    args.envFile = resolveEnvFile(args.envFile, deps.processEnv.INIT_CWD);
    const text = read(args.envFile);
    const fileEnv = text === null ? {} : parseEnvFile(text);
    const env: Record<string, string | undefined> = {};
    for (const name of TOKEN_ENV) env[name] = deps.processEnv[name];
    Object.assign(env, fileEnv);
    for (const v of Object.values(fileEnv)) redactor.addSecret(v);
    for (const name of TOKEN_ENV) redactor.addSecret(env[name]);
    if (text === null) err(`no env file at ${args.envFile}: every token row answers unknown`);
    return await runCheck(args, { ...deps, env }, redactor);
  } catch (e) {
    err(
      `golive:check failed: ${redactor.redact(e instanceof Error ? `${e.name}: ${e.message}` : 'error')}`,
    );
    return 2;
  }
}

function gitRunner(args: readonly string[]): Promise<GitResult> {
  return new Promise((resolve) => {
    execFile('git', [...args], { cwd: REPO_ROOT }, (error, stdout) => {
      const code = error ? (typeof error.code === 'number' ? error.code : 128) : 0;
      resolve({ code, stdout: String(stdout) });
    });
  });
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  // Anything written outside main (a library's warning, an unhandled rejection) passes the same
  // redaction: the token values are registered before any probe runs.
  const early = new Redactor();
  for (const name of TOKEN_ENV) early.addSecret(process.env[name]);
  try {
    const text = existsSync(DEFAULT_ENV_FILE) ? readFileSync(DEFAULT_ENV_FILE, 'utf8') : '';
    for (const v of Object.values(parseEnvFile(text))) early.addSecret(v);
  } catch {
    // main reports an unreadable file.
  }
  for (const stream of [process.stdout, process.stderr]) {
    const write = stream.write.bind(stream) as (chunk: unknown, ...rest: unknown[]) => boolean;
    stream.write = ((chunk: unknown, ...rest: unknown[]) =>
      write(
        typeof chunk === 'string' || Buffer.isBuffer(chunk) ? early.redact(String(chunk)) : chunk,
        ...rest,
      )) as typeof stream.write;
  }
  const fatal = () => {
    process.stderr.write('golive:check failed outside a probe\n');
    process.exit(2);
  };
  process.on('uncaughtException', fatal);
  process.on('unhandledRejection', fatal);
  const code = await main(process.argv.slice(2), {
    processEnv: process.env,
    fetch,
    now: () => new Date(),
    git: gitRunner,
    out: (s) => console.log(s),
    err: (s) => console.error(s),
  });
  process.exit(code);
}
