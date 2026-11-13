/**
 * The go-live check's one way out. `guardedFetch` sends a request only when `refusal` returns null,
 * and `refusal` returns null only for a request that matches one entry of `ROUTES`: that host, that
 * method, a path matching that pattern in full, query parameters (names and values as
 * `URLSearchParams` decodes them) whose name the entry lists and whose every value passes the entry's
 * test for it, and header names from `HEADERS` or the entry's `headers`. Any other request is refused
 * before the inner fetch is called. Vercel's routes take `teamId` only, equal to `VERCEL_TEAM_ID`, so a
 * `decrypt` parameter, spelled or percent-encoded, is refused, and the single-variable path
 * (`/v1/projects/<id>/env/<envId>`, which answers a decrypted value) matches no route. Stripe's takes
 * `lookup_keys[]` from `CATALOG`'s keys and a `limit` from 1 to 100. http.test.ts sends each probe's
 * real URL and these refusals through `refusal`.
 *
 * A token is tied to its host (`TOKEN_HOST`). A request is refused when a token is found in its URL,
 * whatever host it goes to (a URL lands in server and proxy logs), or in any of its headers except the
 * `authorization` header of a request to that token's own host. Found means `tokenFound`: a run of
 * `TOKEN_RUN` characters of the token (the whole token when it is shorter), or of its base64 or
 * base64url form with the four characters at each end left out (they depend on the bytes around the
 * token), at each of the three byte alignments so a prefix such as `user:` does not hide it, appears
 * in the string as sent, in the string after each of up to three rounds of percent-decoding, or in
 * any of those with `+` read as a space. An `authorization` header is refused unless it carries the
 * token of the host it goes to.
 *
 * Every string value in a JSON response body (not its keys) is handed to `onValue` (the CLI
 * registers them with its redactor); a body that is not JSON is handed over whole.
 */
import { CATALOG } from '../../apps/web/lib/billing/catalog';
import { PRODUCTION_REF } from '../db/target';
import { VERCEL_PROJECT_ID, VERCEL_TEAM_ID } from './probes/vercel-env';
import { WORKER_APP } from './probes/worker';
import type { TOKEN_ENV } from './redact';

export interface Route {
  host: string;
  method: 'GET' | 'POST';
  path: RegExp;
  /** Each query parameter the route takes, and the test each of its values must pass. */
  params: Readonly<Record<string, (value: string) => boolean>>;
  /** Headers the route takes beyond `HEADERS`. */
  headers?: readonly string[];
}

/** The headers any route takes. */
export const HEADERS: readonly string[] = ['authorization', 'accept', 'user-agent'];

const team = { teamId: (v: string) => v === VERCEL_TEAM_ID };
const catalogKeys: readonly string[] = Object.keys(CATALOG);

/** The requests the probes send. */
export const ROUTES: readonly Route[] = [
  {
    host: 'api.vercel.com',
    method: 'GET',
    path: new RegExp(`^/v10/projects/${VERCEL_PROJECT_ID}/env$`),
    params: team,
  },
  {
    host: 'api.vercel.com',
    method: 'GET',
    path: new RegExp(`^/v9/projects/${VERCEL_PROJECT_ID}$`),
    params: team,
  },
  {
    host: 'api.supabase.com',
    method: 'POST',
    path: new RegExp(`^/v1/projects/${PRODUCTION_REF}/database/query/read-only$`),
    params: {},
    headers: ['content-type'],
  },
  { host: `${WORKER_APP}.fly.dev`, method: 'GET', path: /^\/healthz$/, params: {} },
  {
    host: 'api.machines.dev',
    method: 'GET',
    path: new RegExp(`^/v1/apps/${WORKER_APP}/machines$`),
    params: {},
  },
  {
    host: 'api.stripe.com',
    method: 'GET',
    path: /^\/v1\/prices$/,
    params: {
      'lookup_keys[]': (v) => catalogKeys.includes(v),
      limit: (v) => /^[1-9][0-9]?$|^100$/.test(v),
    },
  },
  { host: 'api.resend.com', method: 'GET', path: /^\/domains$/, params: {} },
];

/** The hosts `ROUTES` names. */
export const ALLOWED_HOSTS: readonly string[] = [...new Set(ROUTES.map((r) => r.host))];

export type TokenName = (typeof TOKEN_ENV)[number];

/** The one host each token may be sent to. */
export const TOKEN_HOST: Readonly<Record<TokenName, string>> = {
  VERCEL_TOKEN: 'api.vercel.com',
  SUPABASE_ACCESS_TOKEN: 'api.supabase.com',
  FLY_READ_TOKEN: 'api.machines.dev',
  STRIPE_LIVE_READ_KEY: 'api.stripe.com',
  RESEND_API_KEY: 'api.resend.com',
};

export type Tokens = Readonly<Partial<Record<TokenName, string | undefined>>>;

const tokenEntries = Object.entries(TOKEN_HOST) as [TokenName, string][];

export class RefusedRequest extends Error {
  constructor(reason: string) {
    super(`refused: ${reason}`);
    this.name = 'RefusedRequest';
  }
}

/** The shortest run of a token's characters that counts as the token being present. */
export const TOKEN_RUN = 16;

/** The runs of `token` and of its base64 and base64url forms that `tokenFound` looks for. */
function runsOf(token: string): string[] {
  const forms: string[] = [];
  for (const pad of ['', 'x', 'xx']) {
    const bytes = Buffer.from(pad + token);
    for (const enc of ['base64', 'base64url'] as const) {
      const e = bytes.toString(enc);
      // The first 4 characters mix in the pad's bytes, the last 4 whatever follows the token.
      forms.push(e.slice(pad ? 4 : 0, e.length - 4));
    }
  }
  const runs = new Set<string>();
  const add = (f: string) => {
    for (let i = 0; i + TOKEN_RUN <= f.length; i += 1) runs.add(f.slice(i, i + TOKEN_RUN));
  };
  if (token.length < TOKEN_RUN) runs.add(token);
  else add(token);
  for (const f of forms) add(f);
  return [...runs];
}

const runCache = new Map<string, string[]>();
const cachedRuns = (token: string): string[] => {
  let r = runCache.get(token);
  if (!r) {
    r = runsOf(token);
    runCache.set(token, r);
  }
  return r;
};

/** Each `%XX` sequence decoded where it is valid UTF-8, left as it is where it is not. */
const percentDecoded = (s: string): string =>
  s.replace(/(?:%[0-9a-fA-F]{2})+/g, (m) => {
    try {
      return decodeURIComponent(m);
    } catch {
      return m;
    }
  });

/** `s`, up to three rounds of percent-decoding of it, and each of those with `+` read as a space. */
function readings(s: string): string[] {
  const out = [s];
  let cur = s;
  for (let i = 0; i < 3; i += 1) {
    const next = percentDecoded(cur);
    if (next === cur) break;
    out.push(next);
    cur = next;
  }
  return [...out, ...out.map((r) => r.replace(/\+/g, ' '))];
}

/** Whether `haystack` carries `token`, as `TOKEN_RUN` describes in the header comment. */
export function tokenFound(token: string, haystack: string): boolean {
  const runs = cachedRuns(token);
  return readings(haystack).some((h) => runs.some((r) => h.includes(r)));
}

/** Why the request is refused, or null when it is allowed. */
export function refusal(
  input: string,
  method: string,
  headers: Headers = new Headers(),
  tokens: Tokens = {},
): string | null {
  let url: URL;
  try {
    url = new URL(input);
  } catch {
    return 'not an absolute URL';
  }
  if (url.protocol !== 'https:') return 'not https';
  if (url.username || url.password) return 'credentials in the URL';
  if (url.port !== '') return 'a non-default port';
  for (const [name] of tokenEntries) {
    const token = tokens[name];
    // A URL lands in server and proxy logs, so no token goes in one, not even to its own host.
    if (token && tokenFound(token, url.href)) return `${name} in a URL to ${url.hostname}`;
  }
  const m = method.toUpperCase();
  const route = ROUTES.find(
    (r) => r.host === url.hostname && r.method === m && r.path.test(url.pathname),
  );
  if (!route) return `${m} to that path on ${url.hostname} is not a request the check sends`;
  for (const [name, value] of url.searchParams) {
    if (!Object.hasOwn(route.params, name)) return `query parameter ${name} is not allowed there`;
    if (!route.params[name]!(value)) return `query parameter ${name} has a value not allowed there`;
  }
  for (const [name] of headers) {
    if (!HEADERS.includes(name) && !(route.headers ?? []).includes(name))
      return `header ${name} is not allowed there`;
  }
  const own = tokenEntries.find(([, host]) => host === url.hostname)?.[0];
  for (const [header, value] of headers) {
    for (const [name] of tokenEntries) {
      const token = tokens[name];
      if (!token || name === own) continue;
      if (tokenFound(token, value)) return `${name} in a header to ${url.hostname}`;
    }
    if (header !== 'authorization' && own && tokens[own] && tokenFound(tokens[own]!, value))
      return `${own} in the ${header} header`;
  }
  const auth = headers.get('authorization');
  if (auth !== null) {
    const token = own ? tokens[own] : undefined;
    if (!token || !auth.includes(token))
      return `an authorization header to ${url.hostname} that does not carry its token`;
  }
  return null;
}

/** Every string value of a parsed JSON value. Object keys are names, not values, and are left out. */
export function stringLeaves(value: unknown, out: string[] = []): string[] {
  if (typeof value === 'string') out.push(value);
  else if (Array.isArray(value)) for (const v of value) stringLeaves(v, out);
  else if (value !== null && typeof value === 'object') {
    for (const v of Object.values(value)) stringLeaves(v, out);
  }
  return out;
}

const urlOf = (input: RequestInfo | URL): string =>
  typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;

export function guardedFetch(
  inner: typeof fetch,
  onValue: (value: string) => void,
  tokens: Tokens = {},
): typeof fetch {
  return async (input, init) => {
    const url = urlOf(input);
    const method = init?.method ?? (input instanceof Request ? input.method : 'GET');
    const headers = new Headers(input instanceof Request ? input.headers : undefined);
    for (const [k, v] of new Headers(init?.headers)) headers.set(k, v);
    const why = refusal(url, method, headers, tokens);
    if (why) throw new RefusedRequest(why);
    const res = await inner(url, { ...init, method, headers, redirect: 'error' });
    const text = await res.text();
    try {
      for (const v of stringLeaves(JSON.parse(text))) onValue(v);
    } catch {
      onValue(text);
    }
    const empty = res.status === 204 || res.status === 304;
    return new Response(empty ? null : text, { status: res.status });
  };
}
