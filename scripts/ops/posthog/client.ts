import { readFileSync } from 'node:fs';

/**
 * A small client for PostHog's private API (CC-41 D6): the project, and the six kinds of object the
 * spec defines, over an injected `fetch`. The host is US Cloud's; the key is a personal API key,
 * sent as `Authorization: Bearer`, and read only from the environment or the gitignored
 * `scripts/.env.local`. No error message carries the key.
 */
export const POSTHOG_HOST = 'https://us.posthog.com';

export const KINDS = [
  'action',
  'cohort',
  'feature_flag',
  'survey',
  'dashboard',
  'insight',
] as const;
export type Kind = (typeof KINDS)[number];

const PATHS: Record<Kind, string> = {
  action: 'actions',
  cohort: 'cohorts',
  feature_flag: 'feature_flags',
  survey: 'surveys',
  dashboard: 'dashboards',
  insight: 'insights',
};

/** The personal API key's scopes the apply needs: read and write on the project and each kind. */
export const REQUIRED_SCOPES: readonly string[] = (['project', ...KINDS] as const).flatMap((k) => [
  `${k}:read`,
  `${k}:write`,
]);

/** The most pages a list reads (200 objects a page): a longer list is refused, not read forever. */
export const MAX_PAGES = 50;

export type Fetch = (input: string, init?: RequestInit) => Promise<Response>;

export interface Credentials {
  key: string;
  projectId: string;
}

function parseEnvFile(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const line of text.split('\n')) {
    const t = line.trim();
    if (t === '' || t.startsWith('#') || !t.includes('=')) continue;
    const i = t.indexOf('=');
    out[t.slice(0, i).trim()] = t
      .slice(i + 1)
      .trim()
      .replace(/^["']|["']$/g, '');
  }
  return out;
}

const readLocal = (): string => {
  try {
    return readFileSync(new URL('../../.env.local', import.meta.url), 'utf8');
  } catch {
    return '';
  }
};

/** The key and project id, from the environment, else `scripts/.env.local`; refuses without both. */
export function credentials(
  env: Record<string, string | undefined> = process.env,
  read: () => string = readLocal,
): Credentials {
  const file = parseEnvFile(read());
  const key = env.POSTHOG_PERSONAL_API_KEY || file.POSTHOG_PERSONAL_API_KEY;
  const projectId = env.POSTHOG_PROJECT_ID || file.POSTHOG_PROJECT_ID;
  if (!key || !projectId) {
    throw new Error(
      'set POSTHOG_PERSONAL_API_KEY and POSTHOG_PROJECT_ID, in the environment or scripts/.env.local',
    );
  }
  if (!/^\d+$/.test(projectId)) throw new Error('POSTHOG_PROJECT_ID is not a number');
  return { key, projectId };
}

/** An object as PostHog lists it: an id, a name and whatever else it holds. */
export interface Remote {
  id: number | string;
  name: string;
  [field: string]: unknown;
}

export interface PostHogClient {
  getProject(): Promise<Record<string, unknown>>;
  updateProject(body: Record<string, unknown>): Promise<void>;
  list(kind: Kind): Promise<Remote[]>;
  create(kind: Kind, body: Record<string, unknown>): Promise<Remote>;
  update(kind: Kind, id: Remote['id'], body: Record<string, unknown>): Promise<void>;
  /** A survey is deleted; the other kinds are soft-deleted (`deleted: true`), as PostHog has it. */
  remove(kind: Kind, id: Remote['id']): Promise<void>;
}

export function postHogClient({
  key,
  projectId,
  fetch: f,
}: Credentials & { fetch: Fetch }): PostHogClient {
  const base = `${POSTHOG_HOST}/api/projects/${projectId}/`;

  async function call(method: string, url: string, body?: unknown): Promise<unknown> {
    const res = await f(url, {
      method,
      headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json' },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    const text = await res.text();
    const path = url.slice(POSTHOG_HOST.length).split('?')[0];
    if (!res.ok) throw new Error(`${method} ${path} answered ${res.status}: ${text.slice(0, 300)}`);
    return text === '' ? null : (JSON.parse(text) as unknown);
  }

  return {
    async getProject() {
      return (await call('GET', base)) as Record<string, unknown>;
    },
    async updateProject(body) {
      await call('PATCH', base, body);
    },
    async list(kind) {
      const out: Remote[] = [];
      let url: string | null = `${base}${PATHS[kind]}/?limit=200`;
      for (let page = 0; url !== null; page++) {
        if (page === MAX_PAGES) throw new Error(`${kind}: more than ${MAX_PAGES} pages`);
        // A `next` link is followed only within this project's API, so the key goes nowhere else.
        if (!url.startsWith(base))
          throw new Error(`${kind}: refusing to follow a next link off ${base}`);
        const answer = (await call('GET', url)) as { results: Remote[]; next: string | null };
        out.push(...answer.results.filter((r) => r.deleted !== true));
        url = answer.next;
      }
      return out;
    },
    async create(kind, body) {
      return (await call('POST', `${base}${PATHS[kind]}/`, body)) as Remote;
    },
    async update(kind, id, body) {
      await call('PATCH', `${base}${PATHS[kind]}/${id}/`, body);
    },
    async remove(kind, id) {
      const url = `${base}${PATHS[kind]}/${id}/`;
      if (kind === 'survey') await call('DELETE', url);
      else await call('PATCH', url, { deleted: true });
    },
  };
}
