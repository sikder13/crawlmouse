/**
 * No customer address in a URL (CC-33 D2, security review round 1 S1). PostgREST's gateway logs a
 * request's query string, so a filter on an address column (`.eq('email', …)`, `email=eq.…`) puts
 * the address in Supabase's API log. The console and the ops scripts resolve an address through an
 * rpc, a POST whose body carries it. This scans their source for a filter on any column whose name
 * holds `email`, in the query builder's spellings and the raw URL's.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const WEB = resolve(__dirname, '../../..');
const ROOTS = [resolve(WEB, 'lib/v2/ops'), resolve(WEB, '../../scripts/ops')];

const QUOTE = `['"\`]`;
const COLUMN = `${QUOTE}\\w*email\\w*${QUOTE}`;
/** A filter on a column named like `email`, as the query builder or the URL writes it. */
const PATTERNS: readonly RegExp[] = [
  new RegExp(
    `\\.\\s*(eq|neq|like|ilike|in|is|match|filter|not|contains|textSearch|or)\\s*\\(\\s*${COLUMN}`,
  ),
  /\b\w*email\w*=(not\.)?(eq|neq|like|ilike|in|is|fts|plfts|phfts|wfts|cs|cd|match|imatch)[.(]/,
  /\.\s*match\s*\(\s*\{[^}]*\b\w*email\w*\s*:/,
  /\.\s*or\s*\(\s*['"`][^'"`]*\b\w*email\w*\./,
];

function addressFilters(source: string): string[] {
  return source.split('\n').filter((line) => PATTERNS.some((p) => p.test(line)));
}

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return sources(path);
    return /\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name) ? [path] : [];
  });
}

describe('the scanner', () => {
  it.each([
    ".eq('email', q.email)",
    '.eq("email", q.email)',
    '.eq(`email`, q.email)',
    ".eq( 'email' , q.email)",
    ".neq('email', x)",
    ".ilike('email', x)",
    ".like('invited_email', x)",
    ".in('email', [x])",
    ".filter('email', 'eq', x)",
    ".not('email', 'eq', x)",
    '.match({ id, email: x })',
    ".or('id.eq.1,email.eq.x')",
    ".eq('email_normalized', x)",
    '`users?select=id&email=eq.${x}`',
    '`users?select=id&email=ilike.${x}`',
    '`seats?invited_email=eq.${x}`',
    '`users?email=not.eq.${x}`',
    '`users?email=in.(${x})`',
  ])('sees %s', (line) => {
    expect(addressFilters(line)).toEqual([line]);
  });

  it.each([
    ".select('id, email').eq('id', userId)",
    ".select('email')",
    "admin.rpc('operator_account_ids_by_email', { p_email: q.email })",
    "rest.call('POST', 'rpc/user_id_by_email', { p_email: email })",
    "case 'email': {",
  ])('passes %s', (line) => {
    expect(addressFilters(line)).toEqual([]);
  });
});

describe('the console and the ops scripts', () => {
  const files = ROOTS.flatMap(sources);

  it('are read: the scan covers the store, the search and both scripts', () => {
    const names = files.map((f) => relative(resolve(WEB, '../..'), f));
    expect(names).toEqual(
      expect.arrayContaining([
        'apps/web/lib/v2/ops/console-store.ts',
        'apps/web/lib/v2/ops/search.ts',
        'scripts/ops/operator.ts',
        'scripts/ops/internal.ts',
      ]),
    );
  });

  it('filter on no address column', () => {
    const found = files.flatMap((f) =>
      addressFilters(readFileSync(f, 'utf8')).map((line) => `${relative(WEB, f)}: ${line.trim()}`),
    );
    expect(found).toEqual([]);
  });
});
