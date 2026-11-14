/**
 * The access surface as it is on disk, for the access matrix (CC-37 D1): the route handlers, the
 * server entry files that read data, and the files that open a service-role client. Read through the
 * TypeScript AST, so a comment or a string that names `supabaseAdmin` is not a call.
 */
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import ts from 'typescript';
import { ADMIN_ROOTS } from './access-matrix.types';
import { parseSource, routeFolders } from './route-source';

export const WEB_DIR = resolve(__dirname, '../..');
export const REPO_DIR = resolve(WEB_DIR, '../..');

/** The two modules that open a database client on the server. Reaching either means reading data. */
export const DATA_SOURCES = ['apps/web/lib/supabase/admin.ts', 'apps/web/lib/supabase/server.ts'];

/** Next's server entry files other than route handlers: pages, layouts and the metadata routes. */
const SERVER_ENTRY =
  /^(page|layout|template|default|not-found|opengraph-image|twitter-image|icon|apple-icon|sitemap|robots|manifest)\.(ts|tsx|js|jsx)$/;

const SOURCE = /\.(ts|tsx|js|jsx|mjs|cjs)$/;
const TEST = /(\.test\.|\.spec\.|\.d\.ts$)/;
// Under app/, a folder whose name starts with `_` is private to Next and `tests` is a route segment, so
// only `__tests__` (and build output) is skipped there. Elsewhere the test-only folders are skipped too.
const SKIP_IN_APP = new Set(['node_modules', '.next', '__tests__']);
const SKIP_ELSEWHERE = new Set(['node_modules', '.next', '__tests__', 'tests', 'test-support']);

/** Repo-relative path with forward slashes. */
export const repoPath = (abs: string) => relative(REPO_DIR, abs).split(sep).join('/');

function walk(
  dir: string,
  keep: (name: string) => boolean,
  skip: ReadonlySet<string>,
  out: string[] = [],
): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (!skip.has(entry.name)) walk(join(dir, entry.name), keep, skip, out);
    } else if (keep(entry.name)) {
      out.push(join(dir, entry.name));
    }
  }
  return out;
}

/**
 * The non-test source files under `dir`, absolute. `root` says which skip rule applies: `app` keeps a
 * route segment named `tests`.
 */
export function sourceFiles(dir: string, root: 'app' | 'lib'): string[] {
  return walk(
    dir,
    (n) => SOURCE.test(n) && !TEST.test(n),
    root === 'app' ? SKIP_IN_APP : SKIP_ELSEWHERE,
  );
}

/** The server entry files (not route handlers) under an app/ directory, absolute. */
export function entryFiles(appDir: string): string[] {
  return walk(appDir, (n) => SERVER_ENTRY.test(n), SKIP_IN_APP);
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
  const stripped = base.replace(/\.(js|jsx|mjs|cjs)$/, '');
  for (const candidate of [
    stripped,
    `${stripped}.ts`,
    `${stripped}.tsx`,
    base,
    `${stripped}.js`,
    `${stripped}.jsx`,
    join(stripped, 'index.ts'),
    join(stripped, 'index.tsx'),
    join(stripped, 'index.js'),
  ]) {
    if (existsSync(candidate) && statSync(candidate).isFile() && SOURCE.test(candidate)) {
      return candidate;
    }
  }
  return null;
}

/** The local file a module specifier in `fromAbs` names, or null for a package. */
function resolveSpec(fromAbs: string, spec: string): string | null {
  let base: string | null = null;
  if (spec.startsWith('.')) base = resolve(dirname(fromAbs), spec);
  else {
    const alias = ALIASES.find(([prefix]) => spec.startsWith(prefix));
    if (alias) base = join(alias[1], spec.slice(alias[0].length));
    else if (spec === '@crawlmouse/inngest') base = resolve(REPO_DIR, 'inngest/client');
  }
  return base === null ? null : resolveFile(base);
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
    const file = resolveSpec(abs, spec);
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

/** DATA_SOURCES and the given service-role sites (absolute paths), as one set of absolute paths. */
export function dataSourcesOf(sites: Iterable<string>): Set<string> {
  return new Set([...DATA_SOURCES.map((p) => resolve(REPO_DIR, p)), ...sites]);
}

let dataSourceSet: Set<string> | null = null;
/** DATA_SOURCES and every file that opens a service-role client (`adminCallSites`), absolute. */
function dataSources(): Set<string> {
  if (!dataSourceSet) {
    dataSourceSet = dataSourcesOf([...adminCallSites().keys()].map((p) => resolve(REPO_DIR, p)));
  }
  return dataSourceSet;
}

/** True when the file reaches one of DATA_SOURCES, or any file that opens a service-role client. */
export function readsData(abs: string, sources: ReadonlySet<string> = dataSources()): boolean {
  for (const f of importClosure(abs)) if (sources.has(f)) return true;
  return false;
}

/** Route folders under app/, as route-policy.ts names them. */
export const routes = (): string[] => routeFolders();

/** Server entry files under app/ (not route handlers) that read data, repo-relative. */
export function dataReadingEntries(): string[] {
  return entryFiles(join(WEB_DIR, 'app'))
    .filter((f) => readsData(f))
    .map(repoPath)
    .sort();
}

/** Every server entry file under app/ (not route handlers), repo-relative, for the anti-vacuity count. */
export function allEntries(): string[] {
  return entryFiles(join(WEB_DIR, 'app')).map(repoPath).sort();
}

const SERVICE_KEY = 'SUPABASE_SERVICE_ROLE_KEY';
const ADMIN_MODULE = resolve(REPO_DIR, 'apps/web/lib/supabase/admin.ts');
const SUPABASE_JS = '@supabase/supabase-js';

const stringText = (e: ts.Node | undefined): string | null =>
  e && (ts.isStringLiteral(e) || ts.isNoSubstitutionTemplateLiteral(e)) ? e.text : null;

/**
 * Service-role clients a file opens, by AST and by binding, not by one spelling:
 * - a call of any binding imported from `lib/supabase/admin` (named, aliased, default, or a member of
 *   a namespace import), or a local name assigned one of those; a call of `supabaseAdmin` by name too;
 * - a `createClient(…)` (imported from `@supabase/supabase-js` under any name, through a namespace, or
 *   called by that name) whose arguments name `SUPABASE_SERVICE_ROLE_KEY`: the identifier, a
 *   `process.env['…']` element access, or a local binding whose initializer names it (destructuring
 *   included), followed to a fixpoint.
 * Binding names are file-wide, not scoped: a shadowed name counts, which can only over-count.
 */
export function adminCalls(sf: ts.SourceFile): number {
  const fromFile = sf.fileName;
  const adminFns = new Set<string>(['supabaseAdmin']);
  const adminNs = new Set<string>();
  const createFns = new Set<string>(['createClient']);
  const createNs = new Set<string>();
  for (const stmt of sf.statements) {
    if (!ts.isImportDeclaration(stmt) || !ts.isStringLiteral(stmt.moduleSpecifier)) continue;
    const spec = stmt.moduleSpecifier.text;
    const clause = stmt.importClause;
    if (!clause || clause.isTypeOnly) continue;
    const isAdmin = resolveSpec(fromFile, spec) === ADMIN_MODULE;
    const isSupa = spec === SUPABASE_JS;
    if (!isAdmin && !isSupa) continue;
    if (clause.name && isAdmin) adminFns.add(clause.name.text);
    const nb = clause.namedBindings;
    if (nb && ts.isNamespaceImport(nb)) (isAdmin ? adminNs : createNs).add(nb.name.text);
    if (nb && ts.isNamedImports(nb)) {
      for (const el of nb.elements) {
        if (el.isTypeOnly) continue;
        if (isAdmin) adminFns.add(el.name.text);
        else if ((el.propertyName ?? el.name).text === 'createClient') createFns.add(el.name.text);
      }
    }
  }

  const keyNames = new Set<string>();
  const namesKey = (node: ts.Node): boolean => {
    if (ts.isIdentifier(node) && (node.text === SERVICE_KEY || keyNames.has(node.text)))
      return true;
    if (ts.isElementAccessExpression(node) && stringText(node.argumentExpression) === SERVICE_KEY)
      return true;
    return ts.forEachChild(node, namesKey) === true;
  };
  // Local bindings: a name assigned the key, or assigned an admin function, to a fixpoint.
  const decls: ts.VariableDeclaration[] = [];
  const collect = (node: ts.Node) => {
    if (ts.isVariableDeclaration(node) && node.initializer) decls.push(node);
    ts.forEachChild(node, collect);
  };
  collect(sf);
  for (let changed = true; changed; ) {
    changed = false;
    for (const d of decls) {
      const init = d.initializer!;
      if (ts.isIdentifier(d.name)) {
        const name = d.name.text;
        if (!keyNames.has(name) && namesKey(init)) {
          keyNames.add(name);
          changed = true;
        }
        if (!adminFns.has(name) && ts.isIdentifier(init) && adminFns.has(init.text)) {
          adminFns.add(name);
          changed = true;
        }
      } else if (ts.isObjectBindingPattern(d.name)) {
        for (const el of d.name.elements) {
          const prop = el.propertyName ?? el.name;
          if (!ts.isIdentifier(el.name)) continue;
          const keyed =
            (ts.isIdentifier(prop) || ts.isStringLiteral(prop)) && prop.text === SERVICE_KEY;
          if (keyed && !keyNames.has(el.name.text)) {
            keyNames.add(el.name.text);
            changed = true;
          }
        }
      }
    }
  }

  let n = 0;
  const visit = (node: ts.Node) => {
    if (ts.isCallExpression(node)) {
      const e = node.expression;
      const viaNs = (ns: Set<string>, name?: string) =>
        ts.isPropertyAccessExpression(e) &&
        ts.isIdentifier(e.expression) &&
        ns.has(e.expression.text) &&
        (name === undefined || e.name.text === name);
      const isAdmin = (ts.isIdentifier(e) && adminFns.has(e.text)) || viaNs(adminNs);
      const isCreate =
        (ts.isIdentifier(e) && createFns.has(e.text)) || viaNs(createNs, 'createClient');
      if (isAdmin) n++;
      else if (isCreate && node.arguments.some(namesKey)) n++;
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return n;
}

const adminRootFiles = (): string[] =>
  ADMIN_ROOTS.flatMap((root) =>
    sourceFiles(resolve(REPO_DIR, root), root === 'apps/web/app' ? 'app' : 'lib'),
  );

let adminSites: Map<string, number> | null = null;
/** Each non-test source file under ADMIN_ROOTS that opens a service-role client, with its count. */
export function adminCallSites(): Map<string, number> {
  if (adminSites) return adminSites;
  const out = new Map<string, number>();
  for (const abs of adminRootFiles()) {
    const n = adminCalls(sourceOf(abs));
    if (n > 0) out.set(repoPath(abs), n);
  }
  adminSites = new Map([...out].sort(([a], [b]) => a.localeCompare(b)));
  return adminSites;
}

/** The non-test files under ADMIN_ROOTS that import `repoRelative` directly, repo-relative. */
export function importersOf(repoRelative: string): string[] {
  const target = resolve(REPO_DIR, repoRelative);
  const out: string[] = [];
  for (const abs of adminRootFiles()) {
    if (importsOf(abs).includes(target)) out.push(repoPath(abs));
  }
  return out.sort();
}

/**
 * Whether the file makes the check `marker` as code, with its result used (see `markerCalls`).
 * `arg`, when given, is the string the call's first argument must be: `eq` with `audit_id` is
 * `.eq('audit_id', …)`, a capability filter.
 */
export function callsMarker(repoRelative: string, marker: string, arg?: string): boolean {
  return markerCalls(sourceOf(resolve(REPO_DIR, repoRelative)), marker, arg) > 0;
}

/** The name a call is made through: the identifier, the method, or `x['method']`. */
function calledName(e: ts.Expression): string | null {
  if (ts.isIdentifier(e)) return e.text;
  if (ts.isPropertyAccessExpression(e)) return e.name.text;
  if (ts.isElementAccessExpression(e)) return stringText(e.argumentExpression);
  return null;
}

const WRAPPERS = new Set([
  ts.SyntaxKind.AwaitExpression,
  ts.SyntaxKind.ParenthesizedExpression,
  ts.SyntaxKind.AsExpression,
  ts.SyntaxKind.NonNullExpression,
  ts.SyntaxKind.TypeAssertionExpression,
  ts.SyntaxKind.SatisfiesExpression,
]);

/** Whether an identifier of this name is read somewhere in the file other than under `void`. */
function isRead(sf: ts.SourceFile, name: ts.Identifier): boolean {
  let read = false;
  const visit = (node: ts.Node, underVoid: boolean) => {
    if (read) return;
    if (ts.isIdentifier(node) && node !== name && node.text === name.text && !underVoid) {
      // A property name (`x.name`, `{ name: 1 }`) is not a read of the binding.
      const p = node.parent;
      const propName =
        (ts.isPropertyAccessExpression(p) && p.name === node) ||
        (ts.isPropertyAssignment(p) && p.name === node) ||
        (ts.isBindingElement(p) && p.propertyName === node);
      if (!propName) read = true;
      return;
    }
    ts.forEachChild(node, (c) => visit(c, underVoid || ts.isVoidExpression(node)));
  };
  visit(sf, false);
  return read;
}

/**
 * Whether a call's result is used, as far as the AST can say. Walk out through `await`, parentheses,
 * type assertions, chained methods (`.rpc(…).single()`) and property reads (`.success`). Not used:
 * the result of a bare expression statement, of `void`, or of the left side of a comma, or a
 * variable binding (destructured or not) that is never read but under `void`.
 */
function resultUsed(call: ts.CallExpression): boolean {
  let n: ts.Node = call;
  for (;;) {
    const p = n.parent;
    if (WRAPPERS.has(p.kind)) n = p;
    else if (
      (ts.isPropertyAccessExpression(p) || ts.isElementAccessExpression(p)) &&
      p.expression === n
    ) {
      n = ts.isCallExpression(p.parent) && p.parent.expression === p ? p.parent : p;
    } else break;
  }
  const p = n.parent;
  if (ts.isExpressionStatement(p) || ts.isVoidExpression(p)) return false;
  if (ts.isBinaryExpression(p) && p.operatorToken.kind === ts.SyntaxKind.CommaToken && p.left === n)
    return false;
  if (ts.isVariableDeclaration(p) && p.initializer === n) {
    // An exported binding (`export const { GET, POST } = serve(…)`) is read by whoever imports it.
    const stmt = p.parent.parent;
    if (
      ts.isVariableStatement(stmt) &&
      (ts.getModifiers(stmt) ?? []).some((m) => m.kind === ts.SyntaxKind.ExportKeyword)
    )
      return true;
    const sf = call.getSourceFile();
    const names: ts.Identifier[] = [];
    const bind = (b: ts.BindingName) => {
      if (ts.isIdentifier(b)) names.push(b);
      else for (const el of b.elements) if (!ts.isOmittedExpression(el)) bind(el.name);
    };
    bind(p.name);
    return names.some((id) => isRead(sf, id));
  }
  return true;
}

/**
 * The calls `callsMarker` counts, for a source already parsed (the tests probe it): a call of a
 * function or method named `marker` (`isOperator(…)`, `x.verify(…)`), or `.rpc('<marker>', …)`;
 * with `arg`, a call named `marker` whose first argument is the string `arg`. Only a call whose
 * result is used counts (`resultUsed`). A comment, an import, a type, a column name in
 * `.select('id')` or a string logged is not a check.
 */
export function markerCalls(sf: ts.SourceFile, marker: string, arg?: string): number {
  let n = 0;
  const visit = (node: ts.Node) => {
    if (ts.isCallExpression(node)) {
      const name = calledName(node.expression);
      const first = stringText(node.arguments[0]);
      const hit =
        arg === undefined
          ? name === marker || (name === 'rpc' && first === marker)
          : name === marker && first === arg;
      if (hit && resultUsed(node)) n++;
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

// A test that does not run, or runs alone: refused as a proof.
const NOT_RUN = new Set(['skip', 'todo', 'fails', 'only', 'skipIf', 'runIf']);

const escapeRe = (t: string) => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** The pieces of a literal title: text, and `null` for a `${…}` slot of a template literal. */
function titleParts(title: ts.Expression | undefined): Array<string | null> | null {
  if (!title) return null;
  const literal = stringText(title);
  if (literal !== null) return [literal];
  if (!ts.isTemplateExpression(title)) return null;
  const parts: Array<string | null> = [title.head.text];
  for (const span of title.templateSpans) parts.push(null, span.literal.text);
  return parts;
}

/** A table cell's value as vitest prints it with `%s`, or undefined when it is not a literal. */
function cellText(e: ts.Expression): string | undefined {
  const t = stringText(e);
  if (t !== null) return t;
  if (ts.isNumericLiteral(e)) return String(Number(e.text));
  if (e.kind === ts.SyntaxKind.TrueKeyword) return 'true';
  if (e.kind === ts.SyntaxKind.FalseKeyword) return 'false';
  if (e.kind === ts.SyntaxKind.NullKeyword) return 'null';
  return undefined;
}

/** An expression without its `as const`, `satisfies`, parentheses or `!`. */
const unwrap = (e: ts.Expression): ts.Expression =>
  ts.isAsExpression(e) ||
  ts.isSatisfiesExpression(e) ||
  ts.isParenthesizedExpression(e) ||
  ts.isNonNullExpression(e)
    ? unwrap(e.expression)
    : e;

const ANY = '(.+?)';
const PRINTF = /%[sdifjoO#%$]|\$[A-Za-z_][\w.]*/g;

/**
 * A regex for one row of an each table: `%…` placeholders take the row's cells in order and `$name`
 * the object's property, each as its literal text where the cell is a literal and as any text
 * where it is not; `%#` is the row's index and `%%` a percent sign. `cells` null: nothing is known
 * of the row (the table is not an array literal).
 */
function eachRowPattern(
  text: string,
  cells: readonly ts.Expression[] | null,
  props: ts.ObjectLiteralExpression | null,
  index: number | null,
): string {
  let i = 0;
  let out = '';
  let last = 0;
  for (const m of text.matchAll(PRINTF)) {
    out += escapeRe(text.slice(last, m.index));
    last = m.index! + m[0].length;
    const tok = m[0];
    let value: string | undefined;
    if (tok === '%%') value = '%';
    else if (tok === '%#') value = index === null ? undefined : String(index);
    else if (tok === '%$') value = index === null ? undefined : String(index + 1);
    else if (tok.startsWith('$')) {
      const key = tok.slice(1).split('.')[0];
      const prop = props?.properties.find(
        (p): p is ts.PropertyAssignment =>
          ts.isPropertyAssignment(p) &&
          !tok.slice(1).includes('.') &&
          (ts.isIdentifier(p.name) || ts.isStringLiteral(p.name)) &&
          p.name.text === key,
      );
      value = prop ? cellText(prop.initializer) : undefined;
    } else {
      const cell = cells?.[i++];
      value = cell === undefined ? undefined : tok === '%s' ? cellText(cell) : undefined;
      if (value !== undefined && (tok === '%d' || tok === '%i')) value = undefined;
    }
    out += value === undefined ? ANY : escapeRe(value);
  }
  return out + escapeRe(text.slice(last));
}

/**
 * The matchers for a test's title: exact text for `it('…')` (a template literal's `${…}` is any
 * text). For `it.each(table)` / `it.for(table)` with an array-literal table, one matcher per row with
 * the row's literal cells put in; for any other table, one matcher with each placeholder as any text,
 * and none when the title is placeholders only (`'%s'` would match every title). Null when the title
 * is not a literal.
 */
function titleMatchers(
  title: ts.Expression | undefined,
  each: ts.Expression | null | undefined,
): RegExp[] | null {
  const parts = titleParts(title);
  if (!parts) return null;
  const tmpl = (render: (text: string) => string) =>
    new RegExp(`^${parts.map((p) => (p === null ? ANY : render(p))).join('')}$`, 's');
  if (each === undefined) return [tmpl(escapeRe)];
  if (each && ts.isArrayLiteralExpression(each)) {
    return each.elements.map((r, index) => {
      const row = unwrap(r);
      const cells = ts.isArrayLiteralExpression(row) ? [...row.elements] : [row];
      const props = ts.isObjectLiteralExpression(row) ? row : null;
      return tmpl((text) => eachRowPattern(text, cells, props, index));
    });
  }
  const residue = parts
    .filter((p): p is string => p !== null)
    .join('')
    .replace(PRINTF, '');
  if (!/[A-Za-z]/.test(residue)) return [];
  return [tmpl((text) => eachRowPattern(text, null, null, null))];
}

/**
 * How many `it`/`test` declarations in the file have the title `title`, after `it.each` rendering is
 * accounted for. Counted: a call rooted at `it` or `test` (through `.each`, `.for`, `.concurrent`,
 * `.sequential`), with a literal title and a function after it. Not counted: `describe`, `.skip`,
 * `.todo`, `.fails`, `.only`, `.skipIf`, `.runIf`, or a title that merely contains `title`.
 */
export function testsTitled(sf: ts.SourceFile, title: string): number {
  let n = 0;
  // The table of `it.each(table)` / `it.for(table)`: undefined when the call is not an each, null
  // when the each has no table argument.
  const eachTable = (e: ts.Expression): ts.Expression | null | undefined => {
    if (
      ts.isCallExpression(e) &&
      ts.isPropertyAccessExpression(e.expression) &&
      (e.expression.name.text === 'each' || e.expression.name.text === 'for')
    )
      return e.arguments[0] ? unwrap(e.arguments[0]) : null;
    return undefined;
  };
  const chain = (e: ts.Expression, mods: string[]): string | null => {
    if (ts.isIdentifier(e)) return e.text;
    if (ts.isPropertyAccessExpression(e)) {
      mods.push(e.name.text);
      return chain(e.expression, mods);
    }
    if (ts.isCallExpression(e)) return chain(e.expression, mods);
    return null;
  };
  const visit = (node: ts.Node) => {
    if (ts.isCallExpression(node)) {
      const mods: string[] = [];
      const root = chain(node.expression, mods);
      const body = node.arguments
        .slice(1)
        .some((a) => ts.isArrowFunction(a) || ts.isFunctionExpression(a) || ts.isIdentifier(a));
      if ((root === 'it' || root === 'test') && body && !mods.some((m) => NOT_RUN.has(m))) {
        const res = titleMatchers(node.arguments[0], eachTable(node.expression));
        if (res && res.some((re) => re.test(title))) n++;
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return n;
}

/** Whether a parsed test file declares exactly one running test titled `title` (`testsTitled`). */
export function declaresIn(sf: ts.SourceFile, title: string): boolean {
  return testsTitled(sf, title) === 1;
}

/** `declaresIn` for a repo-relative test file; false when the file does not exist. */
export function declaresTest(repoRelative: string, title: string): boolean {
  const abs = resolve(REPO_DIR, repoRelative);
  if (!existsSync(abs)) return false;
  return declaresIn(sourceOf(abs), title);
}

/**
 * Whether every chain of importers from `start` ends at a gated row: a row whose gate is neither
 * `caller` nor `public`. A `caller` row, or a file with no row, is followed to its own importers
 * (`callersOf`); a file with no importers, or a cycle, ends the chain ungated. A `public` row ends it
 * ungated too, unless `publicEnds` (the row states why a public caller is safe: `publicCallers`).
 */
export function callerChainEnds(
  start: string,
  gateOf: (file: string) => string | undefined,
  callersOf: (file: string) => readonly string[],
  publicEnds = false,
): boolean {
  const ends = (file: string, path: ReadonlySet<string>): boolean => {
    const gate = gateOf(file);
    if (gate !== undefined && gate !== 'caller') return gate !== 'public' || publicEnds;
    if (path.has(file)) return false;
    const next = callersOf(file);
    if (next.length === 0) return false;
    const on = new Set(path).add(file);
    return next.every((c) => ends(c, on));
  };
  return ends(start, new Set());
}
