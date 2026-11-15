import { readFileSync } from 'node:fs';

/**
 * The ops scripts' way to the database (CC-33 D1): PostgREST over `fetch`, with the service-role key,
 * so the scripts need no client library. The URL and key come from the environment
 * (`SUPABASE_URL` or `NEXT_PUBLIC_SUPABASE_URL`, and `SUPABASE_SERVICE_ROLE_KEY`), else from the
 * gitignored `scripts/.env.local`. Nothing a script prints carries the key.
 */

export type Fetch = (input: string | URL, init?: RequestInit) => Promise<Response>;

export interface Credentials {
  url: string;
  key: string;
}

function parseEnvFile(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const line of text.split('\n')) {
    const t = line.trim();
    if (t === '' || t.startsWith('#') || !t.includes('=')) continue;
    const i = t.indexOf('=');
    out[t.substring(0, i).trim()] = t
      .substring(i + 1)
      .trim()
      .replace(/^["']|["']$/g, '');
  }
  return out;
}

const readLocal = (): string => {
  try {
    return readFileSync(new URL('../.env.local', import.meta.url), 'utf8');
  } catch {
    return '';
  }
};

export function credentials(
  env: Record<string, string | undefined> = process.env,
  read: () => string = readLocal,
): Credentials {
  const file = parseEnvFile(read());
  const url =
    env.SUPABASE_URL ||
    env.NEXT_PUBLIC_SUPABASE_URL ||
    file.SUPABASE_URL ||
    file.NEXT_PUBLIC_SUPABASE_URL;
  const key = env.SUPABASE_SERVICE_ROLE_KEY || file.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new Error(
      'set SUPABASE_URL (or NEXT_PUBLIC_SUPABASE_URL) and SUPABASE_SERVICE_ROLE_KEY, in the environment or scripts/.env.local',
    );
  }
  return { url, key };
}

export interface Rest {
  /** `method` on `/rest/v1/<path>`; the parsed JSON answer, or null for an empty one. */
  call(
    method: 'GET' | 'POST' | 'PATCH' | 'DELETE',
    path: string,
    body?: unknown,
    prefer?: string,
  ): Promise<unknown>;
}

export function restClient({ url, key, fetch: f = fetch }: Credentials & { fetch?: Fetch }): Rest {
  return {
    async call(method, path, body, prefer) {
      const res = await f(`${url.replace(/\/$/, '')}/rest/v1/${path}`, {
        method,
        headers: {
          apikey: key,
          authorization: `Bearer ${key}`,
          'content-type': 'application/json',
          ...(prefer ? { prefer } : {}),
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
      const text = await res.text();
      if (!res.ok) throw new Error(`${method} ${path.split('?')[0]} answered ${res.status}`);
      return text === '' ? null : (JSON.parse(text) as unknown);
    },
  };
}
