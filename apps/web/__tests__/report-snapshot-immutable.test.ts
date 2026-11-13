/**
 * Minted public-report immutability (OPERATING-RULES §5; CC-29 D6): no code in apps/web or inngest
 * writes `public_reports.report_snapshot` except the insert that mints a report.
 *
 * The scan reads every non-test TypeScript and JavaScript source under apps/web and inngest, with
 * full-line and block comments removed, and classifies each occurrence of `report_snapshot`:
 * - a property read (`row.report_snapshot`), or an optional field in a type (`report_snapshot?:`);
 * - inside the arguments of an `.insert(` call, at any depth;
 * - inside a string that is not an SQL update (a column list, an insert), a quoted key aside;
 * and anything else is a finding: an `.update(` or `.upsert(` argument, an object key or shorthand
 * outside an insert (a payload built apart and passed to an update later), an SQL `update … set`
 * that names it. What it cannot see: a key computed at run time (`['report_' + 'snapshot']`), and a
 * write in SQL outside these two trees (the migrations under infra, which no route runs).
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const WEB = resolve(__dirname, '..');
const INNGEST = resolve(__dirname, '../../../inngest');
const NAME = 'report_snapshot';

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    if (name === 'node_modules' || name === '.next' || name.startsWith('.')) return [];
    const path = join(dir, name);
    return statSync(path).isDirectory() ? walk(path) : [path];
  });
}

const SOURCE = /\.(ts|tsx|mts|js|mjs|cjs)$/;
const TEST = /\.test\.(ts|tsx)$|\/__tests__\//;

/** The source without block comments and full-line `//` comments; offsets are not preserved. */
const withoutComments = (src: string) =>
  src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .filter((line) => !line.trimStart().startsWith('//'))
    .join('\n');

/** The string literal `i` sits in (its quote and the text from its opening to `i`), or null. */
function enclosingString(src: string, i: number): string | null {
  let quote: string | null = null;
  let start = 0;
  for (let k = 0; k < i; k++) {
    const c = src[k]!;
    if (quote) {
      if (c === '\\') k++;
      else if (c === quote) quote = null;
    } else if (c === "'" || c === '"' || c === '`') {
      quote = c;
      start = k + 1;
    }
  }
  return quote ? src.slice(start, i) : null;
}

/** The method names of every call whose argument list encloses offset `i`, innermost first. */
function enclosingCalls(src: string, i: number): string[] {
  const calls: string[] = [];
  let depth = 0;
  for (let k = i - 1; k >= 0; k--) {
    const c = src[k];
    if (c === ')') depth++;
    else if (c === '(') {
      if (depth > 0) depth--;
      else calls.push(/\.?\s*(\w+)\s*$/.exec(src.slice(Math.max(0, k - 40), k))?.[1] ?? '');
    }
  }
  return calls;
}

const SQL_UPDATE = /\bupdate\b[\s\S]*\bset\b/i;

/** Each occurrence of `report_snapshot` in `source` that is not a read, a type or an insert. */
function snapshotWrites(source: string): string[] {
  const src = withoutComments(source);
  const found: string[] = [];
  for (const m of src.matchAll(new RegExp(`\\b${NAME}\\b`, 'g'))) {
    const i = m.index!;
    const line = src.slice(src.lastIndexOf('\n', i) + 1, src.indexOf('\n', i) + 1 || undefined);
    const text = enclosingString(src, i);
    // A quoted object key ('report_snapshot': …) is a key, not a string.
    const quotedKey = text === '' && /^['"`]\s*:/.test(src.slice(i + NAME.length));
    if (text !== null && !quotedKey) {
      if (SQL_UPDATE.test(text)) found.push(line.trim());
      continue;
    }
    if (src[i - 1] === '.') continue;
    if (src.slice(i + NAME.length).startsWith('?:')) continue;
    const calls = enclosingCalls(src, i);
    if (calls.includes('update') || calls.includes('upsert')) found.push(line.trim());
    else if (!calls.includes('insert')) found.push(line.trim());
  }
  return found;
}

const files = [...walk(WEB), ...walk(INNGEST)].filter((f) => SOURCE.test(f) && !TEST.test(f));

describe('no code rewrites a minted report’s snapshot', () => {
  it('scans apps/web and inngest, and finds the mint’s insert (anti-vacuity)', () => {
    expect(files.length).toBeGreaterThan(500);
    const mint = readFileSync(join(WEB, 'app/api/reports/mint/route.ts'), 'utf8');
    expect(mint).toMatch(/\.insert\([^)]*report_snapshot/);
    expect(snapshotWrites(mint)).toEqual([]);
  });

  it('no source writes report_snapshot outside an insert', () => {
    const findings = files.flatMap((f) =>
      snapshotWrites(readFileSync(f, 'utf8')).map((line) => `${relative(WEB, f)}: ${line}`),
    );
    expect(findings).toEqual([]);
  });
});

describe('the scan finds each spelling of a write, and passes reads and inserts', () => {
  it.each([
    [
      'an update with the key',
      "await sb.from('public_reports').update({ report_snapshot: s }).eq('slug', x);",
    ],
    [
      'an update with the shorthand',
      "await sb.from('public_reports').update({ report_snapshot });",
    ],
    ['an upsert', "await sb.from('public_reports').upsert({ slug, report_snapshot: s });"],
    ['a nested update payload', 'await q.update({ ...{ report_snapshot: s }, hidden_at: null });'],
    ['a payload built apart', 'const patch = { report_snapshot: s };\nawait q.update(patch);'],
    [
      'a payload built apart, quoted',
      "const patch = { 'report_snapshot': s };\nawait q.update(patch);",
    ],
    ['SQL in lower case', "await db.query('update public_reports set report_snapshot = $1', [s]);"],
    [
      'SQL in upper case',
      'await db.query(`UPDATE public.public_reports SET hidden_at = now(), report_snapshot = null`);',
    ],
  ])('%s', (_name, source) => {
    expect(snapshotWrites(source)).toHaveLength(1);
  });

  it.each([
    ['a read', 'if (row.report_snapshot) render(row.report_snapshot);'],
    ['an optional field in a type', 'interface R { report_snapshot?: Snapshot | null }'],
    ['a column list', 'const COLS = `domain, report_snapshot, claimed_at`;'],
    ['an insert', "await sb.from('public_reports').insert({ slug, report_snapshot: snapshot });"],
    ['an insert built inline with a call', 'await q.insert(row({ report_snapshot: build(s) }));'],
    [
      'an SQL insert',
      "await db.query('insert into public_reports (slug, report_snapshot) values ($1, $2)');",
    ],
    [
      'a comment',
      '// the update never touches report_snapshot\n/* update public_reports set report_snapshot */',
    ],
  ])('%s is not a write', (_name, source) => {
    expect(snapshotWrites(source)).toEqual([]);
  });
});
