import { spawn } from 'node:child_process';
import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { CLI_WORKDIR } from './files';

/**
 * Runs `supabase db push` on the repository's migrations. The CLI reads `<workdir>/supabase/
 * migrations`; with `--workdir infra` that is `infra/supabase/migrations`, the files themselves, so
 * nothing is copied, moved or linked. The workflows install exactly this version.
 */
export const SUPABASE_CLI_VERSION = '2.84.2';

/** The directory the CLI reads, derived the way the CLI derives it from `--workdir`. */
export const CLI_MIGRATIONS_DIR = join(CLI_WORKDIR, 'supabase', 'migrations');

/** The migration files the CLI is given: every `.sql` file in that directory, in name order. */
export function cliMigrationFiles(): string[] {
  return readdirSync(CLI_MIGRATIONS_DIR)
    .filter((f) => f.endsWith('.sql'))
    .sort();
}

export function pushArgs(dbUrl: string, { dryRun = false } = {}): string[] {
  return [
    '--workdir',
    CLI_WORKDIR,
    'db',
    'push',
    '--db-url',
    dbUrl,
    '--yes',
    ...(dryRun ? ['--dry-run'] : []),
  ];
}

/** The file names after "Would push these migrations:" in the CLI's output. */
export function parsePushList(output: string): string[] {
  return output
    .split('\n')
    .map((line) => /^\s*•\s+(\S+\.sql)\s*$/.exec(line)?.[1])
    .filter((f): f is string => Boolean(f));
}

/**
 * What to redact for a connection URL: the URL, and its password as the URL encodes it, as
 * encodeURIComponent encodes it, and raw. The encodings differ for characters such as $ and @.
 */
export function secretsOf(dbUrl: string): string[] {
  const encoded = new URL(dbUrl).password;
  const password = decodeURIComponent(encoded);
  return [dbUrl, encoded, encodeURIComponent(password), password];
}

/** Replaces each occurrence of each secret with ***, longest first. */
export function redact(text: string, secrets: string[]): string {
  return secrets
    .filter(Boolean)
    .sort((a, b) => b.length - a.length)
    .reduce((t, s) => t.split(s).join('***'), text);
}

export interface PushResult {
  output: string;
  files: string[];
}

/**
 * Runs the CLI with the URL as an argument (never through a shell) and returns its output with the
 * URL and password redacted. Throws on a non-zero exit, with that output.
 */
export async function dbPush(
  dbUrl: string,
  { dryRun = false, bin = process.env.SUPABASE_BIN ?? 'supabase', log = console.log } = {},
): Promise<PushResult> {
  const secrets = secretsOf(dbUrl);
  const child = spawn(bin, pushArgs(dbUrl, { dryRun }), { stdio: ['ignore', 'pipe', 'pipe'] });
  let output = '';
  const collect = (chunk: Buffer) => {
    output += chunk.toString('utf8');
  };
  child.stdout.on('data', collect);
  child.stderr.on('data', collect);
  const code = await new Promise<number | null>((resolve, reject) => {
    child.on('error', reject);
    child.on('close', resolve);
  });
  const clean = redact(output, secrets);
  log(clean);
  if (code !== 0) throw new Error(`supabase db push exited with ${code}`);
  return { output: clean, files: parsePushList(clean) };
}
