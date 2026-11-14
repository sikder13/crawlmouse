/** Fakes for the go-live tests: a scripted fetch that records each request, and probe deps. */
import type { GitResult, ProbeDeps } from './probes/types';

export interface Recorded {
  url: string;
  method: string;
  headers: Record<string, string>;
}

export type Route = (url: URL, init: RequestInit) => Response | Promise<Response>;

/** A fetch answering from `route`, recording every request it is given. */
export function scriptedFetch(route: Route): { fetch: typeof fetch; calls: Recorded[] } {
  const calls: Recorded[] = [];
  const f = (async (input: RequestInfo | URL, init: RequestInit = {}) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    calls.push({
      url,
      method: init.method ?? 'GET',
      headers: Object.fromEntries(new Headers(init.headers).entries()),
    });
    return route(new URL(url), init);
  }) as typeof fetch;
  return { fetch: f, calls };
}

export const json = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

/** A git that answers each command by its first argument. */
export function scriptedGit(answers: Record<string, GitResult>): ProbeDeps['git'] {
  return async (args) => answers[args[0]!] ?? { code: 128, stdout: '' };
}

export function deps(over: Partial<ProbeDeps> = {}): ProbeDeps {
  return {
    fetch: (async () => {
      throw new Error('no fetch expected');
    }) as typeof fetch,
    env: {},
    now: () => new Date(Date.UTC(2026, 10, 13)),
    git: scriptedGit({}),
    ticked: new Set(),
    ...over,
  };
}

/** A token-shaped value built from parts, so no whole token is written in a test file. */
export const fakeToken = (prefix: readonly string[], fill = 'q'): string =>
  [...prefix, fill.repeat(24)].join('_');
