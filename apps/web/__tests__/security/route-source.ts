/**
 * Reads a route handler's source through the TypeScript AST, so the route-policy guards see code and
 * never a comment, a string or a line break. Positions are character offsets in the file.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join, relative, resolve, sep } from 'node:path';
import ts from 'typescript';

export const APP_DIR = resolve(__dirname, '../../app');

const HTTP_METHODS = new Set(['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS']);

/** Every folder under app/ that holds a route.ts, as `api/audits/[id]/cancel`. */
export function routeFolders(dir = APP_DIR): string[] {
  const out: string[] = [];
  const walk = (d: string) => {
    for (const entry of readdirSync(d, { withFileTypes: true })) {
      const p = join(d, entry.name);
      if (entry.isDirectory()) walk(p);
      else if (entry.name === 'route.ts') out.push(relative(dir, d).split(sep).join('/'));
    }
  };
  walk(dir);
  return out.sort();
}

export function parseSource(text: string, name = 'route.ts'): ts.SourceFile {
  return ts.createSourceFile(name, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
}

export function readRoute(route: string): ts.SourceFile {
  return parseSource(readFileSync(join(APP_DIR, route, 'route.ts'), 'utf8'), `${route}/route.ts`);
}

const isExported = (node: ts.Node): boolean =>
  ts.canHaveModifiers(node) &&
  (ts.getModifiers(node) ?? []).some((m) => m.kind === ts.SyntaxKind.ExportKeyword);

/**
 * The HTTP methods a route module exports, in the three spellings a route can use:
 * `export async function POST`, `export { handler as GET }` and `export const { GET } = serve(…)`
 * (or `export const GET = …`).
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

/** Names imported from relative modules or the app's `@/` alias: the route's own code. */
export function localImports(sf: ts.SourceFile): string[] {
  const out: string[] = [];
  for (const stmt of sf.statements) {
    if (!ts.isImportDeclaration(stmt) || !ts.isStringLiteral(stmt.moduleSpecifier)) continue;
    const from = stmt.moduleSpecifier.text;
    if (!from.startsWith('@/') && !from.startsWith('.')) continue;
    const clause = stmt.importClause;
    if (!clause || clause.isTypeOnly) continue;
    if (clause.name) out.push(clause.name.text);
    if (clause.namedBindings && ts.isNamedImports(clause.namedBindings)) {
      for (const el of clause.namedBindings.elements) if (!el.isTypeOnly) out.push(el.name.text);
    }
  }
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
