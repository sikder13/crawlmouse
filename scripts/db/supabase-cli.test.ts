import { lstatSync, readdirSync, realpathSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';
import { CLI_WORKDIR, MIGRATIONS_DIR, REPO_ROOT, listMigrations } from './files';
import {
  CLI_MIGRATIONS_DIR,
  cliMigrationFiles,
  parsePushList,
  pushArgs,
  redact,
} from './supabase-cli';

describe('the CLI wrapper reads infra/supabase/migrations exactly', () => {
  it('gives the CLI the directory listing, file for file', () => {
    const listing = readdirSync(join(REPO_ROOT, 'infra/supabase/migrations'))
      .filter((f) => f.endsWith('.sql'))
      .sort();
    expect(listing.length).toBeGreaterThan(40);
    expect(cliMigrationFiles()).toEqual(listing);
    expect(listMigrations().map((m) => m.file)).toEqual(listing);
  });

  it('resolves --workdir to infra/supabase/migrations through no symlink', () => {
    expect(relative(REPO_ROOT, CLI_MIGRATIONS_DIR)).toBe('infra/supabase/migrations');
    expect(CLI_MIGRATIONS_DIR).toBe(MIGRATIONS_DIR);
    for (const p of [CLI_WORKDIR, join(CLI_WORKDIR, 'supabase'), CLI_MIGRATIONS_DIR]) {
      expect(lstatSync(p).isSymbolicLink(), p).toBe(false);
    }
    expect(realpathSync(CLI_MIGRATIONS_DIR)).toBe(CLI_MIGRATIONS_DIR);
  });

  it('passes --workdir infra, the URL, --yes, and --dry-run only when asked', () => {
    expect(pushArgs('postgresql://u:p@h/db')).toEqual([
      '--workdir',
      CLI_WORKDIR,
      'db',
      'push',
      '--db-url',
      'postgresql://u:p@h/db',
      '--yes',
    ]);
    expect(pushArgs('x', { dryRun: true }).at(-1)).toBe('--dry-run');
  });
});

describe('reading the CLI output', () => {
  // As printed by supabase 2.84.2 against an empty database on 2026-11-05 (first and last lines).
  const output = [
    'Using workdir infra',
    'DRY RUN: migrations will *not* be pushed to the database.',
    'Connecting to remote database...',
    'Would push these migrations:',
    ' • 20260524000001_init_users.sql',
    ' • 20261103000001_v2_006b_ledger_usage.sql',
    'Finished supabase db push.',
  ].join('\n');

  it('lists the files the CLI says it pushes', () => {
    expect(parsePushList(output)).toEqual([
      '20260524000001_init_users.sql',
      '20261103000001_v2_006b_ledger_usage.sql',
    ]);
  });

  it('redacts the URL and the password, encoded or not', () => {
    const url = 'postgresql://postgres.abc:p%40ss@h:5432/postgres';
    const text = `failed: ${url} p@ss p%40ss`;
    expect(redact(text, [url, 'p@ss', 'p%40ss'])).toBe('failed: *** *** ***');
  });
});
