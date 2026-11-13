/**
 * What each route class requires of a route's source, as a list of problems (empty when it holds).
 * The checks read call positions from the AST, so code order counts and comments do not.
 */
import { posix } from 'node:path';
import ts from 'typescript';
import type { RouteClass } from '../../lib/security/route-policy';
import {
  callPositions,
  exportedMethods,
  importedModules,
  importSource,
  statusPositions,
} from './route-source';

const MEMBERSHIP_FUNCTIONS = new Set([
  'is_member',
  'is_member_for_site',
  'is_member_for_fix',
  'member_role',
]);

const first = (xs: number[]) => (xs.length ? Math.min(...xs) : Infinity);

/** `x.rpc('is_member', …)` calls, by offset. */
function membershipChecks(sf: ts.SourceFile): number[] {
  const out: number[] = [];
  const visit = (node: ts.Node) => {
    if (
      ts.isCallExpression(node) &&
      ts.isPropertyAccessExpression(node.expression) &&
      node.expression.name.text === 'rpc' &&
      node.arguments[0] &&
      ts.isStringLiteral(node.arguments[0]) &&
      MEMBERSHIP_FUNCTIONS.has(node.arguments[0].text)
    ) {
      out.push(node.getStart(sf));
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return out;
}

/** Calls of `.json()` or `.formData()` on an exported handler's request parameter. */
function bodyReads(sf: ts.SourceFile, methods = ['json', 'formData']): number[] {
  const params = new Set<string>();
  for (const stmt of sf.statements) {
    if (
      ts.isFunctionDeclaration(stmt) &&
      stmt.parameters[0] &&
      ts.isIdentifier(stmt.parameters[0].name)
    ) {
      params.add(stmt.parameters[0].name.text);
    }
  }
  const out: number[] = [];
  const visit = (node: ts.Node) => {
    if (
      ts.isCallExpression(node) &&
      ts.isPropertyAccessExpression(node.expression) &&
      methods.includes(node.expression.name.text) &&
      ts.isIdentifier(node.expression.expression) &&
      params.has(node.expression.expression.text)
    ) {
      out.push(node.getStart(sf));
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return out;
}

/** True when an exported handler parses its request body with `.json()`. */
export function readsJsonBody(sf: ts.SourceFile): boolean {
  return bodyReads(sf, ['json']).length > 0;
}

function sessionFirst(sf: ts.SourceFile): string[] {
  const getUser = first(callPositions(sf, 'getUser'));
  if (getUser === Infinity) return ['never calls getUser()'];
  const early = callPositions(sf, 'supabaseAdmin').filter((p) => p < getUser);
  return early.length ? [`calls supabaseAdmin() before getUser() (${early.length} call)`] : [];
}

/**
 * True when a module specifier in the route file `fileName` (relative to app/, as `readRoute` names it)
 * names `@supabase/supabase-js` (or a path inside it) or apps/web's `lib/supabase/admin`: through `@/`
 * or a relative path, with or without an extension or a trailing `/index`.
 */
function isServiceRoleModule(spec: string, fileName: string): boolean {
  if (spec === '@supabase/supabase-js' || spec.startsWith('@supabase/supabase-js/')) return true;
  let path: string;
  if (spec.startsWith('@/')) path = posix.normalize(spec.slice(2));
  else if (spec.startsWith('./') || spec.startsWith('../'))
    path = posix.join('app', posix.dirname(fileName), spec);
  else return false;
  path = path
    .replace(/\/$/, '')
    .replace(/\.(ts|tsx|js|jsx|mjs|cjs)$/, '')
    .replace(/\/index$/, '');
  return path === 'lib/supabase/admin';
}

/**
 * The support console's routes (CC-33): `requireOperator()` answers before the route makes a
 * service-role client (`supabaseAdmin`, `consoleAdmin`, or the store built on it, `consoleStore`) and
 * before it reads the request body, so a caller who is not an operator is answered with nothing read.
 * The route builds no client itself: a `supabaseAdmin()` or `createClient()` call anywhere in it is a
 * problem, and so is an import of `@/lib/supabase/admin` or `@supabase/supabase-js` in a spelling
 * `isServiceRoleModule` recognises, whatever name the import binds. Its service-role client is
 * `consoleAdmin(proof)`'s, which throws on a proof `requireOperator` did not issue
 * (lib/v2/ops/operator.ts).
 */
function operatorFirst(sf: ts.SourceFile): string[] {
  const at = first(callPositions(sf, 'requireOperator'));
  if (at === Infinity) return ['never calls requireOperator()'];
  const problems: string[] = [];
  const admin = ['supabaseAdmin', 'consoleAdmin', 'consoleStore']
    .flatMap((n) => callPositions(sf, n))
    .filter((p) => p < at);
  if (admin.length) {
    problems.push(
      `calls supabaseAdmin(), consoleAdmin() or consoleStore() before requireOperator() (${admin.length} call${admin.length === 1 ? '' : 's'})`,
    );
  }
  const body = [...bodyReads(sf), ...callPositions(sf, 'readBody')].filter((p) => p < at);
  if (body.length) {
    problems.push(
      `reads the request body before requireOperator() (${body.length} read${body.length === 1 ? '' : 's'})`,
    );
  }
  const built = ['supabaseAdmin', 'createClient'].flatMap((n) => callPositions(sf, n));
  if (built.length) {
    problems.push(
      `builds a client with supabaseAdmin() or createClient() (${built.length} call${built.length === 1 ? '' : 's'}); an operator route reaches the service role through consoleAdmin() or consoleStore()`,
    );
  }
  const modules = importedModules(sf).filter((m) => isServiceRoleModule(m, sf.fileName));
  if (modules.length) {
    problems.push(
      `imports from @/lib/supabase/admin or @supabase/supabase-js (${modules.join(', ')}); an operator route reaches the service role through consoleAdmin() or consoleStore()`,
    );
  }
  return problems;
}

/** Every method the route exports is destructured from `serve()` of `inngest/next`. */
function servedByInngest(sf: ts.SourceFile): string[] {
  if (importSource(sf, 'serve') !== 'inngest/next')
    return ['does not import serve from inngest/next'];
  const served = new Set<string>();
  for (const stmt of sf.statements) {
    if (!ts.isVariableStatement(stmt)) continue;
    for (const decl of stmt.declarationList.declarations) {
      const init = decl.initializer;
      if (
        init &&
        ts.isCallExpression(init) &&
        ts.isIdentifier(init.expression) &&
        init.expression.text === 'serve' &&
        ts.isObjectBindingPattern(decl.name)
      ) {
        for (const el of decl.name.elements) if (ts.isIdentifier(el.name)) served.add(el.name.text);
      }
    }
  }
  const others = exportedMethods(sf).filter((m) => !served.has(m));
  return others.length ? [`exports ${others.join(', ')} that serve() does not handle`] : [];
}

/** Every name a module imports: default, named and namespace bindings, from any module. */
function importedNames(sf: ts.SourceFile): Set<string> {
  const names = new Set<string>();
  for (const stmt of sf.statements) {
    const clause = ts.isImportDeclaration(stmt) ? stmt.importClause : undefined;
    if (!clause || clause.isTypeOnly) continue;
    if (clause.name) names.add(clause.name.text);
    const b = clause.namedBindings;
    if (b && ts.isNamespaceImport(b)) names.add(b.name.text);
    if (b && ts.isNamedImports(b))
      for (const el of b.elements) if (!el.isTypeOnly) names.add(el.name.text);
  }
  return names;
}

/** The identifier a call's callee chain starts from: `stripe` for `stripe.customers.update()`. */
function rootOf(node: ts.Expression): string | undefined {
  let e: ts.Expression = node;
  for (;;) {
    if (ts.isIdentifier(e)) return e.text;
    if (ts.isPropertyAccessExpression(e) || ts.isElementAccessExpression(e)) e = e.expression;
    else if (ts.isCallExpression(e) || ts.isNewExpression(e)) e = e.expression;
    else if (ts.isParenthesizedExpression(e) || ts.isAwaitExpression(e)) e = e.expression;
    else return undefined;
  }
}

/**
 * The verifier runs before the route does anything with the request: before it, no call is rooted at an
 * imported binding or at a local name bound to one (the verifier's own call aside), no `JSON.parse` runs,
 * and nothing calls `.json()` or `.formData()` (on the request, a clone of it, or anything else but the
 * Response classes). Anywhere in the handler, the request parameter is never parsed with those either.
 */
function verifiedFirst(sf: ts.SourceFile, verifier: string): string[] {
  const at = first(callPositions(sf, verifier));
  if (at === Infinity) return [`never calls ${verifier}()`];
  const problems: string[] = [];
  if (bodyReads(sf).length) problems.push('parses the request body with json() or formData()');
  const imported = importedNames(sf);
  const bindAliases = (node: ts.Node) => {
    if (
      ts.isVariableDeclaration(node) &&
      ts.isIdentifier(node.name) &&
      node.initializer &&
      node.getStart(sf) < at
    ) {
      const root = rootOf(node.initializer);
      if (root && imported.has(root)) imported.add(node.name.text);
    }
    ts.forEachChild(node, bindAliases);
  };
  bindAliases(sf);
  const visit = (node: ts.Node) => {
    if (ts.isCallExpression(node) && node.getStart(sf) < at) {
      const text = node.expression.getText(sf);
      const root = rootOf(node.expression);
      const name = ts.isPropertyAccessExpression(node.expression)
        ? node.expression.name.text
        : text;
      if (text === 'JSON.parse') problems.push(`calls JSON.parse() before ${verifier}()`);
      else if (
        (name === 'json' || name === 'formData') &&
        root !== 'NextResponse' &&
        root !== 'Response'
      ) {
        problems.push(`calls ${text}() before ${verifier}()`);
      } else if (root && imported.has(root) && name !== verifier) {
        problems.push(`calls ${text}() before ${verifier}()`);
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return problems;
}

/** The problems with a route's source for the class it is registered in. */
export function mechanismProblems(
  sf: ts.SourceFile,
  routeClass: RouteClass,
  verifier?: string,
): string[] {
  switch (routeClass) {
    case 'user':
      return sessionFirst(sf);
    case 'member': {
      const problems = sessionFirst(sf);
      const check = first(membershipChecks(sf));
      if (check === Infinity) problems.push('never checks membership through rpc()');
      else if (callPositions(sf, 'supabaseAdmin').some((p) => p < check)) {
        problems.push('calls supabaseAdmin() before the membership check');
      }
      return problems;
    }
    case 'service': {
      if (!verifier) return ['no verifier named'];
      const at = first(callPositions(sf, verifier));
      if (at === Infinity) return [`never calls ${verifier}()`];
      return callPositions(sf, 'supabaseAdmin').some((p) => p < at)
        ? [`calls supabaseAdmin() before ${verifier}()`]
        : [];
    }
    case 'webhook':
      if (!verifier) return ['no verifier named'];
      return verifier === 'serve' ? servedByInngest(sf) : verifiedFirst(sf, verifier);
    case 'operator':
      return operatorFirst(sf);
    case 'public':
      return [];
  }
}

/** A route that answers 401 once it has asked for the session is a signed-in route. */
export function refusesWithoutSession(sf: ts.SourceFile): boolean {
  const getUser = first(callPositions(sf, 'getUser'));
  return statusPositions(sf, 401).some((p) => p > getUser);
}
