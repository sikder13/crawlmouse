import { connect, readOnlyApi, type Db } from './db';

/** Crawlmouse's production project. */
export const PRODUCTION_REF = 'ezspnfeyzwsisymytssm';

/**
 * The project ref a Supabase connection string names: the pooler's user is `postgres.<ref>` and
 * the direct host is `db.<ref>.supabase.co`. A URL that names neither (a local database) has none.
 */
export function refOfUrl(url: string): string | null {
  const parsed = new URL(url);
  const user = decodeURIComponent(parsed.username);
  const fromUser = /^[a-z_]+\.([a-z0-9]{20})$/.exec(user)?.[1];
  const fromHost = /^db\.([a-z0-9]{20})\.supabase\.co$/.exec(parsed.hostname)?.[1];
  return fromUser ?? fromHost ?? null;
}

export function assertAllowed(ref: string | null, yesProduction: boolean): void {
  if (ref === PRODUCTION_REF && !yesProduction) {
    throw new Error(
      `refusing to run against production (${PRODUCTION_REF}) without --yes-production`,
    );
  }
}

export interface TargetArgs {
  /** The NAME of an environment variable holding a connection string, so it never reaches argv. */
  dbUrlEnv?: string;
  /** A project ref, read through the Management API's read-only endpoint. */
  projectRef?: string;
  yesProduction: boolean;
}

export interface Target {
  label: string;
  ref: string | null;
  db: Db;
  writable: boolean;
}

export function openTarget(args: TargetArgs, env: NodeJS.ProcessEnv = process.env): Target {
  if (Boolean(args.dbUrlEnv) === Boolean(args.projectRef)) {
    throw new Error('name exactly one target: --db-url-env <VAR> or --project-ref <ref>');
  }
  if (args.dbUrlEnv) {
    const url = env[args.dbUrlEnv];
    if (!url) throw new Error(`${args.dbUrlEnv} is not set`);
    const ref = refOfUrl(url);
    assertAllowed(ref, args.yesProduction);
    return {
      label: ref ?? 'a database with no project ref',
      ref,
      db: connect(url),
      writable: true,
    };
  }
  const ref = args.projectRef!;
  assertAllowed(ref, args.yesProduction);
  const token = env.SUPABASE_ACCESS_TOKEN;
  if (!token) throw new Error('SUPABASE_ACCESS_TOKEN is not set');
  return { label: `${ref} (read-only)`, ref, db: readOnlyApi(ref, token), writable: false };
}
