/**
 * Finds the v1 items on disk that docs/ops/v1-inventory.json must rule: pages, metadata files, route
 * handlers, Inngest functions, their crons, and tables. Each finder takes its root, so the test can
 * point it at a fixture tree and prove it sees what it claims to see.
 *
 * What counts as v2, and is therefore not listed (the rule, not a list of items):
 * - app files under a `(v2-preview)` or `(account)` route group, at any depth;
 * - an app file that is a 404 whenever a v2 flag is off (`isFlagGated`): that is how v2 routes outside
 *   those groups gate themselves (`api/checks/[id]/claim` on `accountDoorEnabled`, CC-03's new billing
 *   routes on `billingV2Enabled`). A v1 file with a v2 branch is not a 404 with the flag off, so it
 *   stays v1;
 * - an Inngest function built inside a function body (a factory) rather than as a top-level
 *   `export const x = inngest.createFunction(…)`; the v2 functions are registered that way, behind
 *   their flags;
 * - a table created by a migration whose file name is a timestamp then `_v2_`.
 *
 * Not read: middleware, `next.config` redirects and rewrites, and storage buckets (the report states
 * this); a `create table` inside a dynamic `execute`, or a `--` inside a SQL string literal; parallel
 * (`@slot`) and intercepting (`(.)x`) segments, none of which exist under app/ today.
 */
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, resolve, sep } from 'node:path';
import ts from 'typescript';

export const REPO_ROOT = resolve(__dirname, '../../..');
export const APP_DIR = resolve(__dirname, '../app');
export const INNGEST_DIR = join(REPO_ROOT, 'inngest');
export const MIGRATIONS_DIR = join(REPO_ROOT, 'infra/supabase/migrations');

const V2_GROUPS = new Set(['(v2-preview)', '(account)']);

const PAGE_FILE = /^page\.(tsx|ts|jsx|js)$/;
const ROUTE_FILE = /^route\.(tsx|ts|jsx|js)$/;
/** Next's file conventions other than page and route: they render or are served without a page. */
const METADATA_FILE = new RegExp(
  [
    '^(layout|template|loading|error|not-found|global-error|default|opengraph-image|twitter-image|icon|apple-icon|sitemap|robots|manifest)\\.(tsx|ts|jsx|js)$',
    '^(icon|apple-icon|opengraph-image|twitter-image)\\d*\\.(ico|png|jpe?g|svg|gif)$',
    '^(favicon\\.ico|sitemap\\.xml|robots\\.txt|manifest\\.(json|webmanifest))$',
  ].join('|'),
);

/** A v2 route group at any depth. Next does not route `_folder`s, so they are skipped as well. */
export const isV2AppPath = (rel: string): boolean =>
  rel.split('/').some((segment) => V2_GROUPS.has(segment));

function walkApp(dir: string, keep: RegExp): string[] {
  const out: string[] = [];
  const walk = (d: string) => {
    for (const entry of readdirSync(d, { withFileTypes: true })) {
      const p = join(d, entry.name);
      if (entry.isDirectory()) {
        if (!entry.name.startsWith('_')) walk(p);
      } else if (keep.test(entry.name)) out.push(relative(dir, p).split(sep).join('/'));
    }
  };
  walk(dir);
  return out.filter((rel) => !isV2AppPath(rel)).sort();
}

/** v1 page files, as `app/…/page.tsx` paths relative to apps/web. */
export const v1Pages = (dir = APP_DIR): string[] =>
  walkApp(dir, PAGE_FILE).map((rel) => `app/${rel}`);

/** v1 metadata and special files (layouts, OG images, icons, not-found, global-error, sitemap). */
export const v1MetadataFiles = (dir = APP_DIR): string[] =>
  walkApp(dir, METADATA_FILE).map((rel) => `app/${rel}`);

/** v1 route handler files. */
export const v1Routes = (dir = APP_DIR): string[] =>
  walkApp(dir, ROUTE_FILE).map((rel) => `app/${rel}`);

const HANDLER_NAMES = new Set(['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS']);

/** The bodies of a module's route handlers and its default export (a page). */
function handlerBodies(sf: ts.SourceFile): ts.Block[] {
  const exported = (n: ts.Node) =>
    (ts.canHaveModifiers(n) ? (ts.getModifiers(n) ?? []) : []).some(
      (m) => m.kind === ts.SyntaxKind.ExportKeyword,
    );
  const isDefault = (n: ts.Node) =>
    (ts.canHaveModifiers(n) ? (ts.getModifiers(n) ?? []) : []).some(
      (m) => m.kind === ts.SyntaxKind.DefaultKeyword,
    );
  const out: ts.Block[] = [];
  for (const st of sf.statements) {
    if (ts.isFunctionDeclaration(st) && exported(st) && st.body) {
      if (isDefault(st) || (st.name && HANDLER_NAMES.has(st.name.text))) out.push(st.body);
    }
    if (ts.isVariableStatement(st) && exported(st)) {
      for (const d of st.declarationList.declarations) {
        const init = d.initializer;
        if (
          ts.isIdentifier(d.name) &&
          HANDLER_NAMES.has(d.name.text) &&
          init &&
          (ts.isArrowFunction(init) || ts.isFunctionExpression(init)) &&
          ts.isBlock(init.body)
        ) {
          out.push(init.body);
        }
      }
    }
  }
  return out;
}

/**
 * True when a returned value is a refusal with a 404: `notFound()`, a `status: 404` property, or a
 * call whose first argument is 404 (`refuse(404, …)`). A 404 elsewhere in the value is not one.
 */
function holds404(node: ts.Expression): boolean {
  const is404 = (n: ts.Node | undefined) =>
    n !== undefined && ts.isNumericLiteral(n) && n.text === '404';
  let found = false;
  const visit = (n: ts.Node) => {
    if (found) return;
    if (ts.isCallExpression(n)) {
      if (ts.isIdentifier(n.expression) && n.expression.text === 'notFound') found = true;
      else if (ts.isIdentifier(n.expression) && is404(n.arguments[0])) found = true;
    }
    if (ts.isPropertyAssignment(n) && n.name.getText() === 'status' && is404(n.initializer)) {
      found = true;
    }
    ts.forEachChild(n, visit);
  };
  visit(node);
  return found;
}

/**
 * True when the file is a 404 whenever a v2 flag is off: it imports a `…Enabled` reader (a value
 * import, not `import type`) from a module whose path ends in `/flags`, and every route handler it
 * exports (and its default export, for a page) has, at the top level of its body,
 * `if (!reader()) return …` with a 404 in the returned value (`{ status: 404 }`, `refuse(404, …)`,
 * `notFound()`). A v1 route with a v2 branch, a flag-off fallback that serves v1, or a helper's early
 * return does not qualify, so such a file stays v1 and needs an entry.
 */
export function isFlagGated(file: string): boolean {
  const sf = ts.createSourceFile(file, readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true);
  const readers = new Set<string>();
  for (const st of sf.statements) {
    if (!ts.isImportDeclaration(st) || !ts.isStringLiteral(st.moduleSpecifier)) continue;
    if (!/\/flags$/.test(st.moduleSpecifier.text) || st.importClause?.isTypeOnly) continue;
    const named = st.importClause?.namedBindings;
    if (!named || !ts.isNamedImports(named)) continue;
    for (const e of named.elements) {
      if (!e.isTypeOnly && /Enabled$/.test((e.propertyName ?? e.name).text))
        readers.add(e.name.text);
    }
  }
  if (readers.size === 0) return false;
  const refusesWhenOff = (st: ts.Statement): boolean => {
    if (!ts.isIfStatement(st)) return false;
    const cond = st.expression;
    const negatesReader =
      ts.isPrefixUnaryExpression(cond) &&
      cond.operator === ts.SyntaxKind.ExclamationToken &&
      ts.isCallExpression(cond.operand) &&
      ts.isIdentifier(cond.operand.expression) &&
      readers.has(cond.operand.expression.text);
    if (!negatesReader) return false;
    const ret = ts.isReturnStatement(st.thenStatement)
      ? st.thenStatement
      : ts.isBlock(st.thenStatement)
        ? st.thenStatement.statements.find(ts.isReturnStatement)
        : undefined;
    return ret?.expression !== undefined && holds404(ret.expression);
  };
  const bodies = handlerBodies(sf);
  return bodies.length > 0 && bodies.every((b) => b.statements.some(refusesWhenOff));
}

/** The URL a page file serves: route groups dropped, `page.tsx` dropped. */
export function pageUrl(path: string): string {
  const segments = path
    .replace(/^app\//, '')
    .split('/')
    .slice(0, -1)
    .filter((s) => !/^\(.*\)$/.test(s));
  return `/${segments.join('/')}`;
}

/** The URL a route or metadata file serves: its folder, route groups dropped. */
export const fileUrl = pageUrl;

/** True when a concrete URL path is served by a page URL pattern such as `/blog/[slug]`. */
export function urlMatches(pattern: string, url: string): boolean {
  const p = pattern.split('/').filter(Boolean);
  const u = url.split('/').filter(Boolean);
  if (p.length !== u.length) return false;
  return p.every((seg, i) => /^\[[^\]]+\]$/.test(seg) || seg === u[i]);
}

export type InngestFunction = { path: string; id: string; cron: string | null };

const stringLiteral = (node: ts.Expression | undefined): string | null =>
  node && (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) ? node.text : null;

function property(obj: ts.Node | undefined, name: string): ts.Expression | undefined {
  if (!obj || !ts.isObjectLiteralExpression(obj)) return undefined;
  for (const p of obj.properties) {
    if (ts.isPropertyAssignment(p) && p.name.getText() === name) return p.initializer;
  }
  return undefined;
}

/** The crons a trigger argument names: an object, or an array of them. A non-literal cron throws. */
function crons(trigger: ts.Expression | undefined, where: string): string[] {
  const objects =
    trigger && ts.isArrayLiteralExpression(trigger) ? [...trigger.elements] : [trigger];
  return objects.flatMap((o) => {
    const cron = property(o, 'cron');
    if (cron === undefined) return [];
    const text = stringLiteral(cron);
    if (text === null) throw new Error(`${where}: a cron that is not a literal`);
    return [text];
  });
}

/** A function that is not run where it is written; an immediately invoked one runs at load. */
function isFactoryBody(node: ts.Node): boolean {
  if (!ts.isFunctionLike(node)) return false;
  let outer: ts.Node = node;
  while (ts.isParenthesizedExpression(outer.parent)) outer = outer.parent;
  return !(ts.isCallExpression(outer.parent) && outer.parent.expression === outer);
}

/**
 * The identifiers in the serve route's `functions: [ … ]` array, or null when `functions` is not an
 * array literal (CC-20b's branch builds it with a call). An entry that is not a plain name (a spread,
 * a call) throws, so a list this cannot read is not checked as if it were complete.
 */
export function servedFunctionNames(routeFile: string): string[] | null {
  const sf = ts.createSourceFile(
    routeFile,
    readFileSync(routeFile, 'utf8'),
    ts.ScriptTarget.Latest,
    true,
  );
  let names: string[] | null = null;
  const visit = (node: ts.Node) => {
    if (
      ts.isPropertyAssignment(node) &&
      node.name.getText() === 'functions' &&
      ts.isArrayLiteralExpression(node.initializer)
    ) {
      const elements = node.initializer.elements;
      const odd = elements.find((e) => !ts.isIdentifier(e));
      if (odd)
        throw new Error(`serve route: a functions entry that is not a name: ${odd.getText()}`);
      names = elements.map((e) => (e as ts.Identifier).text);
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return names;
}

/**
 * Every `createFunction(…)` call in each non-test module of `dir`. A call inside a function body is
 * a factory's (the v2 rule) and is skipped; a call written as the top-level
 * `export const name = <client>.createFunction(config, trigger, handler)` is a v1 function, `path`
 * `inngest/<file>#<name>`. Any other placement throws, so a shape this finder does not read cannot
 * pass unseen.
 */
export function v1InngestFunctions(dir = INNGEST_DIR): InngestFunction[] {
  const out: InngestFunction[] = [];
  const files = readdirSync(dir).filter((f) => /\.ts$/.test(f) && !/\.test\.ts$/.test(f));
  for (const file of files.sort()) {
    const text = readFileSync(join(dir, file), 'utf8');
    const sf = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
    const visit = (node: ts.Node, inFunction: boolean) => {
      const callee = ts.isCallExpression(node) ? node.expression : undefined;
      const isCall =
        callee !== undefined &&
        ((ts.isPropertyAccessExpression(callee) && callee.name.text === 'createFunction') ||
          (ts.isIdentifier(callee) && callee.text === 'createFunction') ||
          (ts.isElementAccessExpression(callee) &&
            ts.isStringLiteralLike(callee.argumentExpression) &&
            callee.argumentExpression.text === 'createFunction'));
      if (isCall && !inFunction) {
        const call = node as ts.CallExpression;
        const decl = call.parent;
        const stmt = decl?.parent?.parent;
        const topLevelExport =
          ts.isPropertyAccessExpression(call.expression) &&
          ts.isVariableDeclaration(decl) &&
          decl.initializer === call &&
          stmt !== undefined &&
          ts.isVariableStatement(stmt) &&
          stmt.parent === sf &&
          (ts.getModifiers(stmt) ?? []).some((m) => m.kind === ts.SyntaxKind.ExportKeyword);
        const where = `${file}:${sf.getLineAndCharacterOfPosition(call.getStart()).line + 1}`;
        if (!topLevelExport)
          throw new Error(`${where}: a createFunction call this finder cannot read`);
        const id = stringLiteral(property(call.arguments[0], 'id'));
        if (id === null) throw new Error(`${where}: createFunction without a literal id`);
        const found = crons(call.arguments[1], where);
        if (found.length > 1) throw new Error(`${where}: more than one cron`);
        out.push({
          path: `inngest/${file}#${(decl as ts.VariableDeclaration).name.getText()}`,
          id,
          cron: found[0] ?? null,
        });
      }
      ts.forEachChild(node, (child) => visit(child, inFunction || isFactoryBody(node)));
    };
    visit(sf, false);
  }
  return out;
}

/** A v2 migration's file name: the timestamp, then `_v2_` (not `…_engine_v2_…`, which is v1's). */
const V2_MIGRATION = /^\d{14}_v2_/;

const CREATE_TABLE =
  /\bcreate\s+(?:unlogged\s+)?table\s+(?:if\s+not\s+exists\s+)?(?:"?([a-z_][a-z0-9_]*)"?\.)?"?([a-z_][a-z0-9_]*)"?/gi;

/** Strips `--` line comments and block comments so a commented-out statement is not read. */
const stripSqlComments = (sql: string): string =>
  sql.replace(/\/\*[\s\S]*?\*\//g, '').replace(/--[^\n]*/g, '');

/** Tables created by the non-v2 migrations, as `<schema>.<name>` (`public` when unqualified). */
export function v1Tables(dir = MIGRATIONS_DIR): string[] {
  const names = new Set<string>();
  for (const file of readdirSync(dir).filter((f) => f.endsWith('.sql') && !V2_MIGRATION.test(f))) {
    const sql = stripSqlComments(readFileSync(join(dir, file), 'utf8'));
    for (const m of sql.matchAll(CREATE_TABLE)) {
      names.add(`${(m[1] ?? 'public').toLowerCase()}.${m[2]!.toLowerCase()}`);
    }
  }
  return [...names].sort();
}

const WEB_PREFIX = /^((app|lib|components)\/|middleware\.ts$)/;
const FULL_REF =
  /(?<![\w/.])((?:apps|packages|inngest|infra|docs|scripts|app|lib|components)\/[\w./()[\]-]+|middleware\.ts):(\d+(?:[-,]\s?\d+)*)/g;
const BARE_REF = /(?<![\w/.[\]()-])([\w-]+\.(?:tsx?|jsx?|mjs|sql|json)):(\d+)/g;
/** One path segment: a route group `(name)` whole, or a run without brackets. */
const SEGMENT = String.raw`(?:\([\w.-]+\)|[\w.[\]-]+)`;
const PATH_REF = new RegExp(
  String.raw`(?<![\w/.@-])((?:${SEGMENT}\/)+${SEGMENT}\.(?:tsx?|jsx?|mjs|sql|json)):(\d+(?:[-,]\s?\d+)*)`,
  'g',
);
/** Where a folder-relative reference may start, tried in order. */
const REF_ROOTS = [
  'apps/web/app/',
  'apps/web/',
  'packages/engine/src/',
  'packages/engine/',
  'inngest/',
  '',
];
const localDir = (segment: string): boolean =>
  REF_ROOTS.some((r) => {
    const p = join(REPO_ROOT, r, segment);
    return existsSync(p) && statSync(p).isDirectory();
  });
const RELATIVE_REF = /(?<![\w\])])(?:^|(?<=[\s(,]))(?<!\S\S:):(\d+(?:[-,]\s?\d+)*)/g;

/**
 * The file:line references in `text` that do not hold: a full path (`apps/…`, `inngest/…`, or
 * apps/web-relative `app/…`, `lib/…`, `components/…`) that is not a tracked file or is shorter than
 * the line; a relative `(:45-47)` when there is no `own` file to read it against, or past its end; a
 * bare `route.ts:12` that names no folder; a folder-relative `api/x/route.ts:3` that resolves under
 * none of `REF_ROOTS` although its first folder is one of ours. A path whose first folder is not ours
 * (`got-scraping/dist/index.js:543`, a dependency's file) is not checked. `lineCount` returns 0 for a
 * file that is not tracked.
 */
export function refProblems(
  text: string,
  own: string | undefined,
  lineCount: (repoPath: string) => number,
  isLocalDir: (segment: string) => boolean = localDir,
): string[] {
  const bad: string[] = [];
  const maxLine = (spec: string) => Math.max(...spec.split(/[-,]\s?/).map(Number));
  const repoPath = (p: string) => (WEB_PREFIX.test(p) ? `apps/web/${p}` : p);
  for (const m of text.matchAll(FULL_REF)) {
    if (maxLine(m[2]!) > lineCount(repoPath(m[1]!))) bad.push(m[0]);
  }
  const withoutFull = text.replace(FULL_REF, ' ');
  for (const m of withoutFull.matchAll(PATH_REF)) {
    const found = REF_ROOTS.map((r) => r + m[1]!).find((p) => lineCount(p) > 0);
    if (found !== undefined) {
      if (maxLine(m[2]!) > lineCount(found)) bad.push(m[0]);
    } else if (isLocalDir(m[1]!.split('/')[0]!)) {
      bad.push(`unresolved ${m[0]}`);
    }
  }
  const withoutPaths = withoutFull.replace(PATH_REF, ' ');
  for (const m of withoutPaths.matchAll(BARE_REF)) bad.push(`bare ${m[0]}`);
  const withoutAny = withoutPaths.replace(BARE_REF, ' ');
  for (const m of withoutAny.matchAll(RELATIVE_REF)) {
    if (own === undefined) bad.push(`relative ${m[0]} with no file`);
    else if (maxLine(m[1]!) > lineCount(repoPath(own))) bad.push(`${own}${m[0]}`);
  }
  return bad;
}

/**
 * A retired page's redirect: `same` (v2 serves the URL), `410`, `none`, or a path. The path must have
 * the shape of a page that stays served (a `keep` page, or a `retire` page whose redirect is `same`),
 * must not be the page's own URL, and each dynamic segment it names must be one of the source's, so
 * `/compare/[a]/[b]` may send `[a]` on to `/audit/[a]`.
 */
export function redirectProblems(
  entries: readonly {
    kind: string;
    path: string;
    ruling: string;
    url?: string;
    redirect?: string;
  }[],
): string[] {
  const shape = (url: string) => url.replace(/\[[^\]]+\]/g, '[]');
  const segments = (url: string) => [...url.matchAll(/\[[^\]]+\]/g)].map((m) => m[0]);
  const served = new Set(
    entries
      .filter(
        (e) =>
          e.kind === 'page' &&
          e.url !== undefined &&
          (e.ruling === 'keep' || (e.ruling === 'retire' && e.redirect === 'same')),
      )
      .map((e) => shape(e.url!)),
  );
  return entries
    .filter((e) => e.kind === 'page' && e.ruling === 'retire' && e.redirect?.startsWith('/'))
    .flatMap((e) => {
      const to = e.redirect!;
      if (to === e.url) return [`${e.path}: redirects to itself (use same)`];
      const own = new Set(segments(e.url ?? ''));
      const foreign = segments(to).filter((s) => !own.has(s));
      if (foreign.length > 0) {
        return [`${e.path}: ${to} names ${foreign.join(', ')}, which ${e.url} does not have`];
      }
      if (!served.has(shape(to))) return [`${e.path}: ${to} is not a page that stays served`];
      return [];
    });
}

/** D3's conditions on `delete` entries that the tree can show: an app file, gone, with its query. */
export function deleteProblems(
  entries: readonly { kind: string; path: string; ruling: string; evidence: string }[],
  exists: (webPath: string) => boolean,
): string[] {
  return entries
    .filter((e) => e.ruling === 'delete')
    .flatMap((e) => {
      if (!['page', 'metadata', 'route'].includes(e.kind)) {
        return [`${e.path}: only app files are deleted here`];
      }
      const out: string[] = [];
      if (exists(e.path)) out.push(`${e.path}: still on disk`);
      if (!/posthog/i.test(e.evidence)) out.push(`${e.path}: no PostHog query`);
      return out;
    });
}
