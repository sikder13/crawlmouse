/**
 * What each route class requires of a route's source, as a list of problems (empty when it holds).
 * The checks read call positions from the AST, so code order counts and comments do not.
 */
import ts from 'typescript';
import type { RouteClass } from '../../lib/security/route-policy';
import {
  callPositions,
  exportedMethods,
  importSource,
  localImports,
  statusPositions,
} from './route-source';

const MEMBERSHIP_FUNCTIONS = new Set(['is_member', 'is_member_for_site', 'member_role']);

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
function bodyReads(sf: ts.SourceFile): number[] {
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
      ['json', 'formData'].includes(node.expression.name.text) &&
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

function sessionFirst(sf: ts.SourceFile): string[] {
  const getUser = first(callPositions(sf, 'getUser'));
  if (getUser === Infinity) return ['never calls getUser()'];
  const early = callPositions(sf, 'supabaseAdmin').filter((p) => p < getUser);
  return early.length ? [`calls supabaseAdmin() before getUser() (${early.length} call)`] : [];
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

function verifiedFirst(sf: ts.SourceFile, verifier: string): string[] {
  const at = first(callPositions(sf, verifier));
  if (at === Infinity) return [`never calls ${verifier}()`];
  const problems: string[] = [];
  if (bodyReads(sf).length) problems.push('parses the request body with json() or formData()');
  for (const name of localImports(sf)) {
    if (callPositions(sf, name).some((p) => p < at))
      problems.push(`calls ${name}() before ${verifier}()`);
  }
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
    case 'public':
      return [];
  }
}

/** A route that answers 401 once it has asked for the session is a signed-in route. */
export function refusesWithoutSession(sf: ts.SourceFile): boolean {
  const getUser = first(callPositions(sf, 'getUser'));
  return statusPositions(sf, 401).some((p) => p > getUser);
}
