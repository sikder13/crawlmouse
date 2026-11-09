/**
 * Finds the v1 items on disk that docs/ops/v1-inventory.json must rule: pages, metadata files, route
 * handlers, Inngest functions, their crons, and tables. Each finder takes its root, so the test can
 * point it at a fixture tree and prove it sees what it claims to see.
 *
 * What counts as v2, and is therefore not listed (the rule, not a list of items):
 * - app files under the `(v2-preview)` or `(account)` route group, or under `app/api/checks/`;
 * - an Inngest function built inside a function body (a factory) rather than as a top-level
 *   `export const x = inngest.createFunction(…)`; the v2 functions are registered that way, behind
 *   their flags;
 * - a table created by a migration whose file name contains `_v2_`.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join, relative, resolve, sep } from 'node:path';
import ts from 'typescript';

export const REPO_ROOT = resolve(__dirname, '../../..');
export const APP_DIR = resolve(__dirname, '../app');
export const INNGEST_DIR = join(REPO_ROOT, 'inngest');
export const MIGRATIONS_DIR = join(REPO_ROOT, 'infra/supabase/migrations');

const V2_APP_PREFIXES = ['(v2-preview)/', '(account)/', 'api/checks/'];

const PAGE_FILE = /^page\.(tsx|ts|jsx|js)$/;
const ROUTE_FILE = /^route\.(tsx|ts|jsx|js)$/;
/** Next's file conventions other than page and route: they render or are served without a page. */
const METADATA_FILE =
  /^(layout|template|loading|error|not-found|global-error|default|opengraph-image|twitter-image|icon|apple-icon|sitemap|manifest)\.(tsx|ts|jsx|js)$/;

export const isV2AppPath = (rel: string): boolean => V2_APP_PREFIXES.some((p) => rel.startsWith(p));

function walkApp(dir: string, keep: RegExp): string[] {
  const out: string[] = [];
  const walk = (d: string) => {
    for (const entry of readdirSync(d, { withFileTypes: true })) {
      const p = join(d, entry.name);
      if (entry.isDirectory()) walk(p);
      else if (keep.test(entry.name)) out.push(relative(dir, p).split(sep).join('/'));
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

/** The URL a page file serves: route groups dropped, `page.tsx` dropped. */
export function pageUrl(path: string): string {
  const segments = path
    .replace(/^app\//, '')
    .split('/')
    .slice(0, -1)
    .filter((s) => !/^\(.*\)$/.test(s));
  return `/${segments.join('/')}`;
}

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

/**
 * Top-level `export const name = <client>.createFunction(config, trigger, handler)` in each
 * non-test module of `dir`. `path` is `inngest/<file>#<name>`; the cron is read from the trigger.
 */
export function v1InngestFunctions(dir = INNGEST_DIR): InngestFunction[] {
  const out: InngestFunction[] = [];
  const files = readdirSync(dir).filter((f) => /\.ts$/.test(f) && !/\.test\.ts$/.test(f));
  for (const file of files.sort()) {
    const text = readFileSync(join(dir, file), 'utf8');
    const sf = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
    for (const stmt of sf.statements) {
      if (!ts.isVariableStatement(stmt)) continue;
      const exported = (ts.getModifiers(stmt) ?? []).some(
        (m) => m.kind === ts.SyntaxKind.ExportKeyword,
      );
      if (!exported) continue;
      for (const decl of stmt.declarationList.declarations) {
        const init = decl.initializer;
        if (!init || !ts.isCallExpression(init)) continue;
        const callee = init.expression;
        if (!ts.isPropertyAccessExpression(callee) || callee.name.text !== 'createFunction')
          continue;
        const id = stringLiteral(property(init.arguments[0], 'id'));
        if (id === null) throw new Error(`${file}: createFunction without a literal id`);
        out.push({
          path: `inngest/${file}#${decl.name.getText()}`,
          id,
          cron: stringLiteral(property(init.arguments[1], 'cron')),
        });
      }
    }
  }
  return out;
}

const CREATE_TABLE =
  /\bcreate\s+table\s+(?:if\s+not\s+exists\s+)?(?:public\.)?"?([a-z_][a-z0-9_]*)"?/gi;

/** Strips `--` line comments and block comments so a commented-out statement is not read. */
const stripSqlComments = (sql: string): string =>
  sql.replace(/\/\*[\s\S]*?\*\//g, '').replace(/--[^\n]*/g, '');

/** Tables created by the non-v2 migrations, as `public.<name>`. */
export function v1Tables(dir = MIGRATIONS_DIR): string[] {
  const names = new Set<string>();
  for (const file of readdirSync(dir).filter((f) => f.endsWith('.sql') && !f.includes('_v2_'))) {
    const sql = stripSqlComments(readFileSync(join(dir, file), 'utf8'));
    for (const m of sql.matchAll(CREATE_TABLE)) names.add(`public.${m[1]!.toLowerCase()}`);
  }
  return [...names].sort();
}
