/**
 * Reads a route handler's source through the TypeScript AST, so the route-policy guards see code and
 * never a comment, a string or a line break. Positions are character offsets in the file.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join, relative, resolve, sep } from 'node:path';
import ts from 'typescript';

export const APP_DIR = resolve(__dirname, '../../app');

const HTTP_METHODS = new Set(['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS']);

/** A route handler's file name: Next serves `route` with any of its default page extensions. */
const ROUTE_FILE = /^route\.(ts|tsx|js|jsx)$/;

/** Every folder under `dir` that holds a route handler, as `api/audits/[id]/cancel`. */
export function routeFolders(dir = APP_DIR): string[] {
  const out: string[] = [];
  const walk = (d: string) => {
    for (const entry of readdirSync(d, { withFileTypes: true })) {
      const p = join(d, entry.name);
      if (entry.isDirectory()) walk(p);
      else if (ROUTE_FILE.test(entry.name)) out.push(relative(dir, d).split(sep).join('/'));
    }
  };
  walk(dir);
  return out.sort();
}

export function parseSource(text: string, name = 'route.ts'): ts.SourceFile {
  const kind = name.endsWith('.tsx')
    ? ts.ScriptKind.TSX
    : name.endsWith('.ts')
      ? ts.ScriptKind.TS
      : ts.ScriptKind.JSX;
  return ts.createSourceFile(name, text, ts.ScriptTarget.Latest, true, kind);
}

/** The route handler file in a route folder, whichever extension it has. */
export function routeFile(route: string, dir = APP_DIR): string {
  const found = readdirSync(join(dir, route)).filter((f) => ROUTE_FILE.test(f));
  if (found.length !== 1) throw new Error(`${route}: ${found.length} route files`);
  return join(dir, route, found[0]!);
}

export function readRoute(route: string): ts.SourceFile {
  const file = routeFile(route);
  return parseSource(readFileSync(file, 'utf8'), `${route}/${file.split(sep).pop()}`);
}

const isExported = (node: ts.Node): boolean =>
  ts.canHaveModifiers(node) &&
  (ts.getModifiers(node) ?? []).some((m) => m.kind === ts.SyntaxKind.ExportKeyword);

/**
 * The HTTP methods a route module exports, in the four spellings the routes use:
 * `export async function POST`, `export function GET`, `export { handler as GET }` and
 * `export const { GET } = serve(…)` (or `export const GET = …`).
 */
export function exportedMethods(sf: ts.SourceFile): string[] {
  const names: string[] = [];
  for (const stmt of sf.statements) {
    if (ts.isFunctionDeclaration(stmt) && isExported(stmt) && stmt.name) names.push(stmt.name.text);
    if (ts.isVariableStatement(stmt) && isExported(stmt)) {
      for (const decl of stmt.declarationList.declarations) {
        if (ts.isIdentifier(decl.name)) names.push(decl.name.text);
        else if (ts.isObjectBindingPattern(decl.name)) {
          for (const el of decl.name.elements)
            if (ts.isIdentifier(el.name)) names.push(el.name.text);
        }
      }
    }
    if (ts.isExportDeclaration(stmt) && stmt.exportClause && ts.isNamedExports(stmt.exportClause)) {
      for (const el of stmt.exportClause.elements) names.push(el.name.text);
    }
  }
  return names.filter((n) => HTTP_METHODS.has(n)).sort();
}

/** The name a call is made through: `getUser` for `sb.auth.getUser()`, `serve` for `serve()`. */
function calleeName(call: ts.CallExpression | ts.NewExpression): string | undefined {
  const e = call.expression;
  if (ts.isIdentifier(e)) return e.text;
  if (ts.isPropertyAccessExpression(e)) return e.name.text;
  return undefined;
}

/** The offset of every call to a function or method of that name, in source order. */
export function callPositions(sf: ts.SourceFile, name: string): number[] {
  const out: number[] = [];
  const visit = (node: ts.Node) => {
    if (ts.isCallExpression(node) && calleeName(node) === name) out.push(node.getStart(sf));
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return out;
}

/** The module a name is imported from, or undefined. */
export function importSource(sf: ts.SourceFile, name: string): string | undefined {
  for (const stmt of sf.statements) {
    if (!ts.isImportDeclaration(stmt) || !ts.isStringLiteral(stmt.moduleSpecifier)) continue;
    const bindings = stmt.importClause?.namedBindings;
    if (bindings && ts.isNamedImports(bindings)) {
      if (bindings.elements.some((el) => el.name.text === name)) return stmt.moduleSpecifier.text;
    }
    if (stmt.importClause?.name?.text === name) return stmt.moduleSpecifier.text;
  }
  return undefined;
}

/**
 * Every module the source names, in source order: `import … from`, a bare `import '…'`, `export … from`,
 * and the string argument of an `import('…')` or `require('…')` call.
 */
export function importedModules(sf: ts.SourceFile): string[] {
  const out: string[] = [];
  const visit = (node: ts.Node) => {
    if (
      (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) &&
      node.moduleSpecifier &&
      ts.isStringLiteral(node.moduleSpecifier)
    ) {
      out.push(node.moduleSpecifier.text);
    }
    if (
      ts.isCallExpression(node) &&
      (node.expression.kind === ts.SyntaxKind.ImportKeyword ||
        (ts.isIdentifier(node.expression) && node.expression.text === 'require')) &&
      node.arguments[0] &&
      ts.isStringLiteralLike(node.arguments[0])
    ) {
      out.push(node.arguments[0].text);
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return out;
}

/** Offsets of every `status: <n>` property in an object literal, e.g. `{ status: 401 }`. */
export function statusPositions(sf: ts.SourceFile, status: number): number[] {
  const out: number[] = [];
  const visit = (node: ts.Node) => {
    if (
      ts.isPropertyAssignment(node) &&
      ts.isIdentifier(node.name) &&
      node.name.text === 'status' &&
      ts.isNumericLiteral(node.initializer) &&
      Number(node.initializer.text) === status
    ) {
      out.push(node.getStart(sf));
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return out;
}
