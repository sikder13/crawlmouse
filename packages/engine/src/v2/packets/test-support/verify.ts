/**
 * Runs a packet's verify command against a local site in two states, so a test can hold it to the
 * rule: the command exits 0 once the fix has landed, and not before.
 *
 * The site is the worker's loopback test server. A builder under test is given records whose URLs are
 * on `site.base`, so the command it writes is run as written, with `sh -c`. The command is run
 * without blocking the event loop: the server answering it lives in this process.
 */
import { execFile } from 'node:child_process';
import type { RequestListener } from 'node:http';
import { startServer } from '../../../../../worker/src/test-support/http.js';

export type SiteState = 'broken' | 'fixed';

export interface TwoStateSite {
  /** `http://127.0.0.1:<port>` */
  base: string;
  /** The user-agent header of each request received, in order. */
  userAgents(): string[];
  use(state: SiteState): void;
  close(): Promise<void>;
}

/** Serves `states.broken` until `use('fixed')`. Close it in `afterEach` or `afterAll`. */
export async function twoStateSite(
  states: Record<SiteState, RequestListener>,
): Promise<TwoStateSite> {
  let state: SiteState = 'broken';
  const server = await startServer((req, res) => states[state](req, res));
  return {
    base: server.base,
    userAgents: () => server.requests.map((r) => String(r.headers['user-agent'] ?? '')),
    use: (next) => {
      state = next;
    },
    close: () => server.close(),
  };
}

export interface CommandResult {
  status: number;
  stdout: string;
  stderr: string;
}

/** The command's exit status and output under `sh -c`. A command that does not end in ten seconds fails. */
export function runCommand(command: string): Promise<CommandResult> {
  return new Promise((resolve, reject) => {
    execFile('sh', ['-c', command], { timeout: 10_000 }, (error, stdout, stderr) => {
      if (error === null) return resolve({ status: 0, stdout, stderr });
      if (typeof error.code === 'number') return resolve({ status: error.code, stdout, stderr });
      reject(error);
    });
  });
}

/** The command's result on the broken site, then on the fixed one. */
export async function inBothStates(
  site: TwoStateSite,
  command: string,
): Promise<Record<SiteState, CommandResult>> {
  site.use('broken');
  const broken = await runCommand(command);
  site.use('fixed');
  const fixed = await runCommand(command);
  return { broken, fixed };
}
