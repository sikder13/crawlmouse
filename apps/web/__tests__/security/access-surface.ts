/**
 * The access surface as it is on disk, for the access matrix (CC-37 D1): the route handlers, the
 * server entry files that read data, and the files that open a service-role client. Read through the
 * TypeScript AST, so a comment or a string that names `supabaseAdmin` is not a call.
 */
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import ts from 'typescript';
import { parseSource, routeFolders } from './route-source';

export const WEB_DIR = resolve(__dirname, '../..');
export const REPO_DIR = resolve(WEB_DIR, '../..');

/** The two modules that open a database client on the server. Reaching either means reading data. */
export const DATA_SOURCES = ['apps/web/lib/supabase/admin.ts', 'apps/web/lib/supabase/server.ts'];

/** Next's server entry files other than route handlers: pages, layouts and the metadata routes. */
const SERVER_ENTRY =
  /^(page|layout|template|default|not-found|opengraph-image|twitter-image|icon|apple-icon|sitemap|robots|manifest)\.(ts|tsx)$/;

const SOURCE = /\.(ts|tsx)$/;
const TEST = /(\.test\.|\.spec\.|\.d\.ts$)/;
const SKIP_DIRS = new Set(['node_modules', '.next', '__tests__', 'tests', 'test-support']);

/** Repo-relative path with forward slashes. */
export const repoPath = (abs: string) => relative(REPO_DIR, abs).split(sep).join('/');

function walk(dir: string, keep: (name: string) => boolean, out: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (!SKIP_DIRS.has(entry.name)) walk(join(dir, entry.name), keep, out);
    } else if (keep(entry.name)) {
      out.push(join(dir, entry.name));
    }
  }
  return out;
}

const parsed = new Map<string, ts.SourceFile>();
function sourceOf(abs: string): ts.SourceFile {
  let sf = parsed.get(abs);
  if (!sf) {
    sf = parseSource(readFileSync(abs, 'utf8'), abs);
    parsed.set(abs, sf);
  }
  return sf;
}

const ALIASES: Array<[prefix: string, target: string]> = [
  ['@/', WEB_DIR],
  ['@crawlmouse/inngest/', resolve(REPO_DIR, 'inngest')],
];

function resolveFile(base: string): string | null {
  const stripped = base.replace(/\.js$/, '');
  for (const candidate of [
    stripped,
    `${stripped}.ts`,
    `${stripped}.tsx`,
    join(stripped, 'index.ts'),
    join(stripped, 'index.tsx'),
  ]) {
    if (existsSync(candidate) && statSync(candidate).isFile() && SOURCE.test(candidate)) {
      return candidate;
    }
  }
  return null;
}

/** The local modules a file imports, statically or with `import()`; packages are not followed. */
export function importsOf(abs: string): string[] {
  const sf = sourceOf(abs);
  const specs: string[] = [];
  const visit = (node: ts.Node) => {
    if (
      (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) &&
      node.moduleSpecifier &&
      ts.isStringLiteral(node.moduleSpecifier)
    ) {
      // `import type` reads no data at run time.
      const typeOnly = ts.isImportDeclaration(node)
        ? node.importClause?.isTypeOnly === true
        : node.isTypeOnly;
      if (!typeOnly) specs.push(node.moduleSpecifier.text);
    } else if (
      ts.isCallExpression(node) &&
      node.expression.kind === ts.SyntaxKind.ImportKeyword &&
      node.arguments[0] &&
      ts.isStringLiteral(node.arguments[0])
    ) {
      specs.push(node.arguments[0].text);
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  const out: string[] = [];
  for (const spec of specs) {
    let base: string | null = null;
    if (spec.startsWith('.')) base = resolve(dirname(abs), spec);
    else {
      const alias = ALIASES.find(([prefix]) => spec.startsWith(prefix));
      if (alias) base = join(alias[1], spec.slice(alias[0].length));
      else if (spec === '@crawlmouse/inngest') base = resolve(REPO_DIR, 'inngest/client');
    }
    const file = base === null ? null : resolveFile(base);
    if (file) out.push(file);
  }
  return out;
}

/** Every local module the file reaches through imports, itself included. */
export function importClosure(abs: string): Set<string> {
  const seen = new Set<string>();
  const stack = [abs];
  while (stack.length) {
    const f = stack.pop()!;
    if (seen.has(f)) continue;
    seen.add(f);
    stack.push(...importsOf(f));
  }
  return seen;
}

/** True when the file reaches one of DATA_SOURCES. */
export function readsData(abs: string): boolean {
  const sources = new Set(DATA_SOURCES.map((p) => resolve(REPO_DIR, p)));
  for (const f of importClosure(abs)) if (sources.has(f)) return true;
  return false;
}

/** Route folders under app/, as route-policy.ts names them. */
export const routes = (): string[] => routeFolders();

/** Server entry files under app/ (not route handlers) that read data, repo-relative. */
export function dataReadingEntries(): string[] {
  return walk(join(WEB_DIR, 'app'), (n) => SERVER_ENTRY.test(n))
    .filter(readsData)
    .map(repoPath)
    .sort();
}

/** Every server entry file under app/ (not route handlers), repo-relative, for the anti-vacuity count. */
export function allEntries(): string[] {
  return walk(join(WEB_DIR, 'app'), (n) => SERVER_ENTRY.test(n))
    .map(repoPath)
    .sort();
}

/** Whether an expression names `SUPABASE_SERVICE_ROLE_KEY` anywhere inside it. */
function namesServiceKey(node: ts.Node): boolean {
  if (ts.isIdentifier(node) && node.text === 'SUPABASE_SERVICE_ROLE_KEY') return true;
  return ts.forEachChild(node, namesServiceKey) === true;
}

/**
 * Service-role clients a file opens, by AST: calls of `supabaseAdmin()`, and `createClient(…)` calls
 * whose arguments name `SUPABASE_SERVICE_ROLE_KEY` (the Inngest functions build their own).
 */
export function adminCalls(sf: ts.SourceFile): number {
  let n = 0;
  const visit = (node: ts.Node) => {
    if (ts.isCallExpression(node) && ts.isIdentifier(node.expression)) {
      const name = node.expression.text;
      if (name === 'supabaseAdmin') n++;
      else if (name === 'createClient' && node.arguments.some(namesServiceKey)) n++;
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return n;
}

/** The directories whose non-test sources may open a service-role client. */
const ADMIN_ROOTS = ['apps/web/app', 'apps/web/lib', 'apps/web/components', 'inngest'];

/** Each non-test source file that calls `supabaseAdmin(`, with its call count, repo-relative. */
export function adminCallSites(): Map<string, number> {
  const out = new Map<string, number>();
  for (const root of ADMIN_ROOTS) {
    for (const abs of walk(resolve(REPO_DIR, root), (n) => SOURCE.test(n) && !TEST.test(n))) {
      const n = adminCalls(sourceOf(abs));
      if (n > 0) out.set(repoPath(abs), n);
    }
  }
  return new Map([...out].sort(([a], [b]) => a.localeCompare(b)));
}

/** The non-test files under ADMIN_ROOTS that import `repoRelative` directly, repo-relative. */
export function importersOf(repoRelative: string): string[] {
  const target = resolve(REPO_DIR, repoRelative);
  const out: string[] = [];
  for (const root of ADMIN_ROOTS) {
    for (const abs of walk(resolve(REPO_DIR, root), (n) => SOURCE.test(n) && !TEST.test(n))) {
      if (importsOf(abs).includes(target)) out.push(repoPath(abs));
    }
  }
  return out.sort();
}

/**
 * Whether the file makes the check `marker` as code: a call of a function or method of that name
 * (`isOperator(…)`, `x.verify(…)`), or a call whose first argument is that string
 * (`rpc('is_member_for_site', …)`). A comment, an import or a type that names it is not a check.
 */
export function callsMarker(repoRelative: string, marker: string): boolean {
  return markerCalls(sourceOf(resolve(REPO_DIR, repoRelative)), marker) > 0;
}

/** The number of calls `callsMarker` counts, for a source already parsed (the tests probe it). */
export function markerCalls(sf: ts.SourceFile, marker: string): number {
  let n = 0;
  const visit = (node: ts.Node) => {
    if (ts.isCallExpression(node)) {
      const e = node.expression;
      const name = ts.isIdentifier(e)
        ? e.text
        : ts.isPropertyAccessExpression(e)
          ? e.name.text
          : null;
      const first = node.arguments[0];
      const literal =
        first && (ts.isStringLiteral(first) || ts.isNoSubstitutionTemplateLiteral(first))
          ? first.text
          : null;
      if (name === marker || literal === marker) n++;
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return n;
}

/** Whether a string literal `text` is passed as an argument of some call in the file (a seat action). */
export function passesLiteral(repoRelative: string, text: string): boolean {
  const sf = sourceOf(resolve(REPO_DIR, repoRelative));
  let found = false;
  // A value that can be `text`: the literal, or a `cond ? a : b` with it on one side
  // (`p_action: verb === 'DELETE' ? 'remove_site' : 'edit_site'` asks both).
  const yields = (e: ts.Expression): boolean =>
    ts.isParenthesizedExpression(e)
      ? yields(e.expression)
      : ts.isConditionalExpression(e)
        ? yields(e.whenTrue) || yields(e.whenFalse)
        : (ts.isStringLiteral(e) || ts.isNoSubstitutionTemplateLiteral(e)) && e.text === text;
  const visit = (node: ts.Node) => {
    if (found) return;
    if (ts.isCallExpression(node) || ts.isObjectLiteralExpression(node)) {
      const parts = ts.isCallExpression(node)
        ? node.arguments
        : node.properties.flatMap((p) => (ts.isPropertyAssignment(p) ? [p.initializer] : []));
      if (parts.some(yields)) {
        found = true;
        return;
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return found;
}

/** Whether a test file declares a test (`it`, `test`, `it.each`, …) or suite whose title contains `name`. */
export function declaresTest(repoRelative: string, name: string): boolean {
  const abs = resolve(REPO_DIR, repoRelative);
  if (!existsSync(abs)) return false;
  const sf = sourceOf(abs);
  let found = false;
  const callee = (e: ts.Expression): string | null => {
    if (ts.isIdentifier(e)) return e.text;
    if (ts.isPropertyAccessExpression(e)) return callee(e.expression);
    if (ts.isCallExpression(e)) return callee(e.expression);
    return null;
  };
  const visit = (node: ts.Node) => {
    if (found) return;
    if (ts.isCallExpression(node)) {
      const c = callee(node.expression);
      const title = node.arguments[0];
      if (
        (c === 'it' || c === 'test' || c === 'describe') &&
        title &&
        (ts.isStringLiteral(title) || ts.isNoSubstitutionTemplateLiteral(title)) &&
        title.text.includes(name)
      ) {
        found = true;
        return;
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return found;
}
