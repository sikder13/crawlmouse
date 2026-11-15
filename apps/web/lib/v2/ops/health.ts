/**
 * What `GET /api/health` answers, and what /status shows: this deployment's version and commit. It
 * reads no database and no upstream service, so it says "this deployment is serving" and nothing
 * else. `commit` is the Vercel git SHA when present, else null.
 */
import pkg from '../../../package.json';

type Env = Readonly<Record<string, string | undefined>>;

export interface HealthReport {
  ok: true;
  version: string;
  commit: string | null;
}

export function healthReport(env: Env = process.env): HealthReport {
  return { ok: true, version: pkg.version, commit: env.VERCEL_GIT_COMMIT_SHA ?? null };
}

/** `ok: true` in words, as /status shows it: the deployment rendered the answer. */
export const ANSWERING = 'answering';
