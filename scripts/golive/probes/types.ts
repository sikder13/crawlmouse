/**
 * What a go-live probe takes and answers. A probe's `reason` is built from fixed text, counts, names
 * the code itself holds (environment names, lookup keys, migration versions) and booleans; it never
 * quotes a response body, a header or a value.
 */

export type ProbeStatus = 'pass' | 'fail' | 'unknown';

export interface ProbeResult {
  status: ProbeStatus;
  reason: string;
}

/** The outcome of a git command: its exit code and its stdout. */
export interface GitResult {
  code: number;
  stdout: string;
}

export interface ProbeDeps {
  /** Already wrapped by `guardedFetch`: GET (or the one Supabase read-only POST) to fixed hosts only. */
  fetch: typeof fetch;
  /** The `TOKEN_ENV` names (redact.ts) and their values; no other env-file value. */
  env: Readonly<Record<string, string | undefined>>;
  now: () => Date;
  /** Runs `git` in the repository; read-only commands only. */
  git: (args: readonly string[]) => Promise<GitResult>;
  /** Ids the owner passed with `--ticked`. */
  ticked: ReadonlySet<string>;
}

export type Probe = (deps: ProbeDeps) => Promise<ProbeResult>;

export const pass = (reason: string): ProbeResult => ({ status: 'pass', reason });
export const fail = (reason: string): ProbeResult => ({ status: 'fail', reason });
export const unknown = (reason: string): ProbeResult => ({ status: 'unknown', reason });

/** The answer when a probe's token is missing. */
export const noToken = (name: string): ProbeResult => unknown(`set ${name} in scripts/.env.local`);

/** The status line of a failed HTTP call: the method's host and status, nothing from the body. */
export const httpFailed = (what: string, status: number): ProbeResult =>
  unknown(`${what} answered HTTP ${status}`);
