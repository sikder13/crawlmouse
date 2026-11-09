import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';

/**
 * GUARD — "0 links" and "links not read" are never confused (CC-20b D9).
 *
 * A page whose links the crawl did not read in full (a 404, a non-HTML response, a body cut short)
 * carries `links_read: false`, and its `links_out` is then not its count: 0 when none was read (the
 * PageResult schema needs a number), the links found so far when the read stopped early. A reader that
 * takes `links_out` without looking at `links_read` shows that number as a count.
 * So every read of a `links_out` property must sit in a function that also reads `links_read`
 * itself, in its own body rather than in a function nested inside it. That is a tripwire, not a
 * proof: it cannot tell which object each read is of.
 *
 * WHAT COUNTS AS A READ, from the TypeScript AST (the `typescript` package), so formatting cannot
 * hide one: a property access (`p.links_out`, `p?.links_out`, `p!.links_out`), an element access
 * with the literal name (`p['links_out']`), and a destructuring (`{ links_out }`,
 * `{ links_out: n }`, `{ ['links_out']: n }`). Not a read: the target of a plain `=` assignment, an object-literal key, and
 * anything in a type. Each form has a case below that the guard names; a property access, an
 * element access and a destructuring also have one that passes beside a `links_read` read.
 */

const REPO = resolve(__dirname, '../../..');
const ROOTS = [
  'packages/engine/src',
  'apps/web/lib',
  'apps/web/components',
  'apps/web/app',
  'inngest',
];
const SOURCE = /\.tsx?$/;
const TEST = /(\.test\.|\.spec\.)|(^|\/)__tests__\//;

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (name === 'node_modules') return [];
    if (statSync(path).isDirectory()) return sources(path);
    const rel = relative(REPO, path);
    return SOURCE.test(name) && !name.endsWith('.d.ts') && !TEST.test(rel) ? [rel] : [];
  });
}

const isFunction = (n: ts.Node): n is ts.FunctionLikeDeclaration =>
  ts.isFunctionDeclaration(n) ||
  ts.isFunctionExpression(n) ||
  ts.isArrowFunction(n) ||
  ts.isMethodDeclaration(n) ||
  ts.isGetAccessorDeclaration(n) ||
  ts.isSetAccessorDeclaration(n) ||
  ts.isConstructorDeclaration(n);

/** A read of the property `name` at `node`, as the header defines one. */
function readsProperty(node: ts.Node, name: string): boolean {
  if (ts.isPropertyAccessExpression(node) && node.name.text === name) {
    const p = node.parent;
    const assigned =
      ts.isBinaryExpression(p) &&
      p.left === node &&
      p.operatorToken.kind === ts.SyntaxKind.EqualsToken;
    return !assigned;
  }
  if (
    ts.isElementAccessExpression(node) &&
    ts.isStringLiteralLike(node.argumentExpression) &&
    node.argumentExpression.text === name
  ) {
    const p = node.parent;
    return !(
      ts.isBinaryExpression(p) &&
      p.left === node &&
      p.operatorToken.kind === ts.SyntaxKind.EqualsToken
    );
  }
  if (ts.isBindingElement(node) && ts.isObjectBindingPattern(node.parent)) {
    const key = node.propertyName ?? node.name;
    if (ts.isComputedPropertyName(key))
      return ts.isStringLiteralLike(key.expression) && key.expression.text === name;
    return (ts.isIdentifier(key) || ts.isStringLiteral(key)) && key.text === name;
  }
  return false;
}

/** Whether `scope` reads `name` in its own body, not counting functions nested in it. */
function readsDirectly(scope: ts.Node, name: string): boolean {
  let found = false;
  const visit = (n: ts.Node) => {
    if (found) return;
    if (n !== scope && isFunction(n)) return;
    if (readsProperty(n, name)) found = true;
    else ts.forEachChild(n, visit);
  };
  visit(scope);
  return found;
}

/** The lines of every `links_out` read with no enclosing function that reads `links_read`. */
function offenders(file: string, text: string): number[] {
  const kind = file.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS;
  const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, kind);
  const lines: number[] = [];
  const visit = (n: ts.Node) => {
    if (readsProperty(n, 'links_out')) {
      let gated = false;
      for (let at: ts.Node | undefined = n.parent; at && !gated; at = at.parent) {
        if (isFunction(at) || ts.isSourceFile(at)) gated = readsDirectly(at, 'links_read');
      }
      if (!gated) lines.push(source.getLineAndCharacterOfPosition(n.getStart()).line + 1);
    }
    ts.forEachChild(n, visit);
  };
  visit(source);
  return lines;
}

/** Every `links_out` read in `text`, gated or not: the scan's own count. */
function reads(file: string, text: string): number {
  const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  let n = 0;
  const visit = (node: ts.Node) => {
    if (readsProperty(node, 'links_out')) n++;
    ts.forEachChild(node, visit);
  };
  visit(source);
  return n;
}

const FILES = ROOTS.flatMap((r) => sources(join(REPO, r)));
const text = (f: string) => readFileSync(join(REPO, f), 'utf8');

describe('every reader of links_out reads links_read', () => {
  it('names no offender, as file:line', () => {
    const found = FILES.flatMap((f) => offenders(f, text(f)).map((line) => `${f}:${line}`));
    expect(found, `links_out read without links_read:\n${found.join('\n')}`).toEqual([]);
  });

  it('scans the roots: it finds the builder’s read and each screen reader the plan named', () => {
    for (const f of [
      'packages/engine/src/v2/build/assemble.ts',
      'packages/engine/src/v2/detectors/scope.ts',
      'apps/web/lib/v2/view/link-map.ts',
      'apps/web/lib/v2/synthesise.ts',
    ]) {
      expect(FILES, f).toContain(f);
      expect(reads(f, text(f)), f).toBeGreaterThan(0);
    }
    expect(FILES.some((f) => f.startsWith('inngest/'))).toBe(true);
    // The routes and pages a later step reads loadCheck from (CC-22b, CC-30) live here.
    expect(FILES.some((f) => f.startsWith('apps/web/app/') && f.endsWith('route.ts'))).toBe(true);
    expect(FILES.some((f) => f.startsWith('apps/web/components/') && f.endsWith('.tsx'))).toBe(
      true,
    );
    expect(FILES.some((f) => TEST.test(f))).toBe(false);
  });
});

describe('what the guard counts as a read', () => {
  const bare = (body: string) => offenders('x.ts', `function f(p: P) { ${body} }`);

  it.each([
    ['a property access', 'return p.links_out;'],
    ['an optional chain', 'return p?.links_out;'],
    ['a non-null assertion', 'return p!.links_out;'],
    ['an element access', "return p['links_out'];"],
    ['a destructuring', 'const { links_out } = p; return links_out;'],
    ['a renamed destructuring', 'const { links_out: n } = p; return n;'],
    ['a destructuring by a computed key', "const { ['links_out']: n } = p; return n;"],
    ['an element access by a template literal', 'return p[`links_out`];'],
    ['a compound assignment, which reads first', 'p.links_out += 1;'],
  ])('names %s with no links_read', (_, body) => {
    expect(bare(body)).toEqual([1]);
  });

  it.each([
    ['a property access', 'return p.links_read ? p.links_out : null;'],
    ['an element access', "return p['links_read'] ? p['links_out'] : null;"],
    [
      'a destructuring',
      'const { links_out, links_read } = p; return links_read ? links_out : null;',
    ],
  ])('passes %s beside a links_read read', (_, body) => {
    expect(bare(body)).toEqual([]);
  });

  it.each([
    ['an object-literal key', 'return { links_out: 0 };'],
    ['a plain assignment', 'p.links_out = 0;'],
    ['a type', "type T = P['links_out']; const q: Pick<P, 'links_out'> = p; return q;"],
    ['a string', "return 'page_results[].links_out';"],
  ])('does not count %s', (_, body) => {
    expect(bare(body)).toEqual([]);
  });

  it('takes a links_read read in an enclosing function, and not one in a nested function', () => {
    const outer =
      'function f(p: P) { if (!p.links_read) return null; return [1].map(() => p.links_out); }';
    expect(offenders('x.ts', outer)).toEqual([]);
    const nested =
      'function f(p: P) { const ok = () => p.links_read; return ok() ? p.links_out : 0; }';
    expect(offenders('x.ts', nested)).toEqual([1]);
  });

  it('reads TSX', () => {
    const tsx = 'export const C = ({ p }: { p: P }) => <span>{p.links_out}</span>;';
    expect(offenders('x.tsx', tsx)).toEqual([1]);
  });
});
