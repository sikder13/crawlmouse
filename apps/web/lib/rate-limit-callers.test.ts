import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';
import { MAX_RATE_LIMIT_WINDOW_MS } from './rate-limit-window';

// B-F1: rows are deleted once their window started PRUNE_AFTER_MS ago, so no caller may use a
// window longer than MAX_RATE_LIMIT_WINDOW_MS. checkRateLimit throws on one at run time; this sweep
// reads the window argument of each call from source, so a route whose tests mock the module is
// still checked. A file is a caller when it imports the rate-limit module; the reader follows a
// named import (aliased or not) and a namespace import, and throws on a shape it cannot read: a
// dynamic import or require of the module, checkRateLimit used other than as a callee, a window it
// cannot evaluate, or a caller file with no call in it.

const WEB = resolve(__dirname, '..');
const MODULE = /(^|\/)rate-limit(\.(js|ts|mjs))?$/;

function callerFiles(): string[] {
  const out = execFileSync('git', ['grep', '-l', '-E', 'rate-limit[\'"]', '--', '.'], {
    cwd: WEB,
    encoding: 'utf8',
  });
  return out
    .split('\n')
    .filter((f) => /\.(ts|tsx|mts|js|mjs)$/.test(f))
    .filter((f) => !/\.test\.tsx?$/.test(f) && f !== 'lib/rate-limit.ts')
    .filter((f) => !f.startsWith('node_modules/'));
}

/** The number an expression of numeric literals, `*`, `+` and same-file consts comes to. */
function evaluate(node: ts.Expression, sf: ts.SourceFile, seen = new Set<string>()): number {
  if (ts.isNumericLiteral(node)) return Number(node.text.replace(/_/g, ''));
  if (ts.isParenthesizedExpression(node)) return evaluate(node.expression, sf, seen);
  if (ts.isBinaryExpression(node)) {
    const l = evaluate(node.left, sf, seen);
    const r = evaluate(node.right, sf, seen);
    if (node.operatorToken.kind === ts.SyntaxKind.AsteriskToken) return l * r;
    if (node.operatorToken.kind === ts.SyntaxKind.PlusToken) return l + r;
  }
  if (ts.isIdentifier(node) && !seen.has(node.text)) {
    seen.add(node.text);
    let init: ts.Expression | undefined;
    const visit = (n: ts.Node) => {
      if (
        ts.isVariableDeclaration(n) &&
        ts.isIdentifier(n.name) &&
        n.name.text === node.text &&
        n.initializer &&
        ts.isVariableDeclarationList(n.parent) &&
        n.parent.flags & ts.NodeFlags.Const
      ) {
        init = n.initializer;
      }
      ts.forEachChild(n, visit);
    };
    visit(sf);
    if (init) return evaluate(init, sf, seen);
  }
  throw new Error(`cannot evaluate ${node.getText(sf)}`);
}

/** The windows of the calls a module makes through its import of the rate-limit module. */
function windowsOf(file: string, text: string): Array<{ where: string; ms: number }> {
  const sf = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true);
  const at = (n: ts.Node) => `${file}:${sf.getLineAndCharacterOfPosition(n.getStart()).line + 1}`;
  const direct = new Set<string>();
  const namespaces = new Set<string>();
  let imports = false;
  for (const st of sf.statements) {
    // A re-export hands checkRateLimit to other modules under names this file does not see.
    if (
      ts.isExportDeclaration(st) &&
      st.moduleSpecifier &&
      ts.isStringLiteral(st.moduleSpecifier) &&
      MODULE.test(st.moduleSpecifier.text)
    ) {
      throw new Error(`${at(st)}: a re-export of the rate-limit module`);
    }
    if (!ts.isImportDeclaration(st) || !ts.isStringLiteral(st.moduleSpecifier)) continue;
    if (!MODULE.test(st.moduleSpecifier.text)) continue;
    imports = true;
    const b = st.importClause?.namedBindings;
    if (b && ts.isNamespaceImport(b)) namespaces.add(b.name.text);
    else if (b && ts.isNamedImports(b)) {
      for (const el of b.elements) {
        if ((el.propertyName ?? el.name).text === 'checkRateLimit') direct.add(el.name.text);
      }
    }
  }
  const out: Array<{ where: string; ms: number }> = [];
  const visit = (n: ts.Node) => {
    // import('…rate-limit') and require('…rate-limit') hand the module to code this cannot follow.
    if (
      ts.isCallExpression(n) &&
      (n.expression.kind === ts.SyntaxKind.ImportKeyword ||
        (ts.isIdentifier(n.expression) && n.expression.text === 'require')) &&
      n.arguments[0] &&
      ts.isStringLiteral(n.arguments[0]) &&
      MODULE.test(n.arguments[0].text)
    ) {
      throw new Error(`${at(n)}: a dynamic import of the rate-limit module`);
    }
    const isRef =
      (ts.isIdentifier(n) && direct.has(n.text) && !ts.isImportSpecifier(n.parent)) ||
      (ts.isPropertyAccessExpression(n) &&
        ts.isIdentifier(n.expression) &&
        namespaces.has(n.expression.text) &&
        n.name.text === 'checkRateLimit');
    if (isRef) {
      const call = n.parent;
      if (!ts.isCallExpression(call) || call.expression !== n) {
        throw new Error(`${at(n)}: checkRateLimit used other than as a callee`);
      }
      const arg = call.arguments[2];
      if (!arg) throw new Error(`${at(call)}: no window argument`);
      try {
        out.push({ where: at(call), ms: evaluate(arg, sf) });
      } catch (e) {
        throw new Error(`${at(call)}: ${(e as Error).message}`);
      }
      return;
    }
    // A namespace used other than through .checkRateLimit (passed on, destructured) is unreadable.
    if (
      ts.isIdentifier(n) &&
      namespaces.has(n.text) &&
      !ts.isNamespaceImport(n.parent) &&
      !(ts.isPropertyAccessExpression(n.parent) && n.parent.expression === n)
    ) {
      throw new Error(`${at(n)}: the rate-limit namespace used other than as obj.member`);
    }
    ts.forEachChild(n, visit);
  };
  visit(sf);
  if (imports && direct.size + namespaces.size > 0 && out.length === 0) {
    throw new Error(`${file}: imports checkRateLimit and calls it nowhere this can read`);
  }
  return out;
}

function windows(file: string): Array<{ where: string; ms: number }> {
  return windowsOf(file, readFileSync(join(WEB, file), 'utf8'));
}

describe('every checkRateLimit caller (B-F1)', () => {
  it('uses a window no longer than MAX_RATE_LIMIT_WINDOW_MS', () => {
    const files = callerFiles();
    // The routes that count today: magic-link, audits/start, re-audit, notify, verify, mint, the
    // report routes, waitlist, takedown. A sweep that found none would pass by reading nothing.
    expect(files.length).toBeGreaterThanOrEqual(10);
    // windowsOf throws for a file that imports checkRateLimit and yields no call, so a file the
    // reader cannot follow fails here rather than adding nothing.
    const found = files.flatMap(windows);
    expect(new Set(found.map((w) => w.where.split(':')[0])).size).toBeGreaterThanOrEqual(10);
    const tooLong = found.filter((w) => !(w.ms > 0 && w.ms <= MAX_RATE_LIMIT_WINDOW_MS));
    expect(tooLong).toEqual([]);
  });

  it('reads a window it is given, and refuses one it cannot evaluate', () => {
    const sf = (src: string) => ts.createSourceFile('x.ts', src, ts.ScriptTarget.Latest, true);
    const expr = (s: ts.SourceFile) =>
      (s.statements.at(-1) as ts.ExpressionStatement).expression as ts.Expression;
    const a = sf('const H = 60 * 60 * 1000; const D = 24 * H; D + 1;');
    expect(evaluate(expr(a), a)).toBe(MAX_RATE_LIMIT_WINDOW_MS + 1);
    const b = sf('import { D } from "./x"; D;');
    expect(() => evaluate(expr(b), b)).toThrow(/cannot evaluate/);
    const c = sf('let W = 5; W;');
    expect(() => evaluate(expr(c), c)).toThrow(/cannot evaluate/);
  });

  it('follows an aliased and a namespace import, and refuses a shape it cannot read', () => {
    const H = 'const H = 3_600_000;';
    expect(
      windowsOf(
        'a.ts',
        `import { checkRateLimit as limit } from '@/lib/rate-limit'; ${H} limit('k', 1, 25 * H);`,
      ),
    ).toEqual([{ where: 'a.ts:1', ms: 25 * 3_600_000 }]);
    expect(
      windowsOf('b.ts', `import * as RL from '../rate-limit'; ${H} RL.checkRateLimit('k', 1, H);`),
    ).toEqual([{ where: 'b.ts:1', ms: 3_600_000 }]);
    expect(
      windowsOf(
        'e.ts',
        `import { checkRateLimit } from '../rate-limit.js'; ${H} checkRateLimit('k', 1, 2 * H);`,
      ),
    ).toEqual([{ where: 'e.ts:1', ms: 2 * 3_600_000 }]);
    // The window constant's module is not the rate-limit module.
    expect(windowsOf('c.ts', `import { MAX } from './rate-limit-window'; MAX;`)).toEqual([]);
    for (const [src, why] of [
      [`const m = await import('@/lib/rate-limit');`, /dynamic import/],
      [
        `import { checkRateLimit } from '@/lib/rate-limit'; const f = checkRateLimit;`,
        /other than as a callee/,
      ],
      [`import * as RL from '@/lib/rate-limit'; const { checkRateLimit } = RL;`, /namespace used/],
      [`import { checkRateLimit } from '@/lib/rate-limit'; export {};`, /calls it nowhere/],
      [`export { checkRateLimit as limitBy } from './rate-limit';`, /re-export/],
      [`export * from './rate-limit';`, /re-export/],
      [`export * as RL from '../lib/rate-limit.js';`, /re-export/],
    ] as const) {
      expect(() => windowsOf('d.ts', src), src).toThrow(why);
    }
  });
});
