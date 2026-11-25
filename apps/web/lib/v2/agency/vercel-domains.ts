/**
 * Goal 1 row 25: the port to Vercel's domain API, and its real implementation. A host is attached to
 * the project only after its TXT record proves the agency controls it (`domain.ts`), and removed from
 * it before its row is cleared. Endpoints, read in Vercel's REST reference on 25 Nov 2026:
 *
 * - add:    `POST   /v10/projects/{project}/domains`         body `{ name }`; 409 when another project
 *                                                            or team holds the host
 * - get:    `GET    /v9/projects/{project}/domains/{host}`   `verified`, `verification[]`
 * - verify: `POST   /v9/projects/{project}/domains/{host}/verify`
 * - config: `GET    /v6/domains/{host}/config`               `misconfigured`, `recommendedCNAME[]`
 * - remove: `DELETE /v9/projects/{project}/domains/{host}`
 *
 * With no token in `VERCEL_DOMAINS_TOKEN`, every call refuses with `not_configured` and sends nothing: the routes
 * answer 503 and write nothing. The token is never logged or returned.
 */
import 'server-only';

/** Vercel's challenge when another team has used the host: a TXT record at `domain`. */
export interface VercelChallenge {
  type: string;
  domain: string;
  value: string;
}

export interface VercelDomainState {
  /** Vercel serves the host for this project. */
  verified: boolean;
  /** What Vercel asks for before it will, when `verified` is false. */
  challenges: VercelChallenge[];
}

export interface VercelDomainConfig {
  /** Whether the DNS points at Vercel well enough for a certificate (`!misconfigured`). */
  configured: boolean;
  /** The CNAME target Vercel recommends first for this host; project-specific. */
  cname: string | null;
}

export type VercelFailure =
  | 'not_configured'
  /** Another Vercel project or team holds the host. */
  | 'in_use'
  | 'not_found'
  | 'rate_limited'
  | 'failed';

export type VercelResult<T> = { ok: true; value: T } | { ok: false; failure: VercelFailure };

export interface VercelDomains {
  add(host: string): Promise<VercelResult<VercelDomainState>>;
  get(host: string): Promise<VercelResult<VercelDomainState>>;
  verify(host: string): Promise<VercelResult<VercelDomainState>>;
  config(host: string): Promise<VercelResult<VercelDomainConfig>>;
  /** A host the project does not hold counts as removed. */
  remove(host: string): Promise<VercelResult<null>>;
}

/** The project and team the hosts are attached to (PROJECT_OVERVIEW §9; not secrets). */
export const VERCEL_PROJECT_ID = 'prj_ZOVjZgG2kU6BzcXyAFutzNpQQXx5';
export const VERCEL_TEAM_ID = 'team_7JoIUGWqgJwobBinsyt2qRKH';

const API = 'https://api.vercel.com';
const TIMEOUT_MS = 10_000;

type Fetch = (input: string, init: RequestInit) => Promise<Response>;

/** Every call refused: what the routes get while the owner's token is unset. */
export const UNCONFIGURED: VercelDomains = {
  add: async () => ({ ok: false, failure: 'not_configured' }),
  get: async () => ({ ok: false, failure: 'not_configured' }),
  verify: async () => ({ ok: false, failure: 'not_configured' }),
  config: async () => ({ ok: false, failure: 'not_configured' }),
  remove: async () => ({ ok: false, failure: 'not_configured' }),
};

/** Whether the owner's token is set: without it every call refuses (`UNCONFIGURED`). */
export function vercelConfigured(
  env: Readonly<Record<string, string | undefined>> = process.env,
): boolean {
  return (env.VERCEL_DOMAINS_TOKEN?.trim() ?? '') !== '';
}

/** The port as the environment configures it: the real calls with a token, refusals without. */
export function vercelDomainsFromEnv(
  env: Readonly<Record<string, string | undefined>> = process.env,
  fetchImpl: Fetch = fetch,
): VercelDomains {
  return vercelConfigured(env)
    ? vercelDomains(env.VERCEL_DOMAINS_TOKEN!.trim(), fetchImpl)
    : UNCONFIGURED;
}

/** The real calls. `host` is always one `portalHostRefusal` accepted, so it needs no escaping
 * beyond `encodeURIComponent`, which is applied anyway. */
export function vercelDomains(token: string, fetchImpl: Fetch = fetch): VercelDomains {
  const project = encodeURIComponent(VERCEL_PROJECT_ID);
  const team = `teamId=${encodeURIComponent(VERCEL_TEAM_ID)}`;

  async function call(
    method: string,
    path: string,
    body?: object,
  ): Promise<{ status: number; json: unknown } | VercelFailure> {
    try {
      const res = await fetchImpl(`${API}${path}${path.includes('?') ? '&' : '?'}${team}`, {
        method,
        headers: {
          Authorization: `Bearer ${token}`,
          ...(body ? { 'Content-Type': 'application/json' } : {}),
        },
        ...(body ? { body: JSON.stringify(body) } : {}),
        redirect: 'error',
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
      const text = await res.text();
      let json: unknown = null;
      try {
        json = text === '' ? null : JSON.parse(text);
      } catch {
        json = null;
      }
      return { status: res.status, json };
    } catch {
      return 'failed';
    }
  }

  const failureOf = (status: number): VercelFailure =>
    status === 409
      ? 'in_use'
      : status === 404
        ? 'not_found'
        : status === 429
          ? 'rate_limited'
          : 'failed';

  const state = (json: unknown): VercelDomainState | null => {
    if (typeof json !== 'object' || json === null) return null;
    const j = json as { verified?: unknown; verification?: unknown };
    if (typeof j.verified !== 'boolean') return null;
    const challenges = Array.isArray(j.verification)
      ? j.verification.flatMap((v: unknown) => {
          const c = v as Partial<Record<'type' | 'domain' | 'value', unknown>>;
          return typeof c?.type === 'string' &&
            typeof c.domain === 'string' &&
            typeof c.value === 'string'
            ? [{ type: c.type, domain: c.domain, value: c.value }]
            : [];
        })
      : [];
    return { verified: j.verified, challenges };
  };

  const asState = async (
    r: Awaited<ReturnType<typeof call>>,
  ): Promise<VercelResult<VercelDomainState>> => {
    if (typeof r === 'string') return { ok: false, failure: r };
    if (r.status !== 200) return { ok: false, failure: failureOf(r.status) };
    const s = state(r.json);
    return s ? { ok: true, value: s } : { ok: false, failure: 'failed' };
  };

  const at = (host: string) => `/v9/projects/${project}/domains/${encodeURIComponent(host)}`;

  return {
    add: async (host) =>
      asState(await call('POST', `/v10/projects/${project}/domains`, { name: host })),
    get: async (host) => asState(await call('GET', at(host))),
    verify: async (host) => asState(await call('POST', `${at(host)}/verify`)),
    async config(host) {
      const r = await call(
        'GET',
        `/v6/domains/${encodeURIComponent(host)}/config?projectIdOrName=${project}`,
      );
      if (typeof r === 'string') return { ok: false, failure: r };
      if (r.status !== 200) return { ok: false, failure: failureOf(r.status) };
      const j = r.json as { misconfigured?: unknown; recommendedCNAME?: unknown } | null;
      if (typeof j?.misconfigured !== 'boolean') return { ok: false, failure: 'failed' };
      const ranked = Array.isArray(j.recommendedCNAME)
        ? (j.recommendedCNAME as Array<{ rank?: unknown; value?: unknown }>)
            .filter((c) => typeof c?.value === 'string' && typeof c.rank === 'number')
            .sort((a, b) => (a.rank as number) - (b.rank as number))
        : [];
      const first = ranked[0]?.value;
      return {
        ok: true,
        value: {
          configured: !j.misconfigured,
          cname: typeof first === 'string' ? first.replace(/\.$/, '') : null,
        },
      };
    },
    async remove(host) {
      const r = await call('DELETE', at(host));
      if (typeof r === 'string') return { ok: false, failure: r };
      if (r.status === 200 || r.status === 404) return { ok: true, value: null };
      return { ok: false, failure: failureOf(r.status) };
    },
  };
}
