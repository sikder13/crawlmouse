import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';
import { MAX_RATE_LIMIT_WINDOW_MS } from './rate-limit-window';

// B-F1: rows are deleted once their window started PRUNE_AFTER_MS ago, so no caller may use a
// window longer than MAX_RATE_LIMIT_WINDOW_MS. checkRateLimit throws on one at run time; this sweep
// reads every call's window argument from source, so a caller no test reaches is still checked.
// A window this reader cannot evaluate (a parameter, an import, a call) fails the sweep.

const WEB = resolve(__dirname, '..');

function callerFiles(): string[] {
  const out = execFileSync('git', ['grep', '-l', 'checkRateLimit(', '--', 'app', 'lib'], {
    cwd: WEB,
    encoding: 'utf8',
  });
  return out
    .split('\n')
    .filter(Boolean)
    .filter((f) => !/\.test\.tsx?$/.test(f) && f !== 'lib/rate-limit.ts');
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

function windows(file: string): Array<{ where: string; ms: number }> {
  const text = readFileSync(join(WEB, file), 'utf8');
  const sf = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true);
  const out: Array<{ where: string; ms: number }> = [];
  const visit = (n: ts.Node) => {
    if (
      ts.isCallExpression(n) &&
      ts.isIdentifier(n.expression) &&
      n.expression.text === 'checkRateLimit'
    ) {
      const where = `${file}:${sf.getLineAndCharacterOfPosition(n.getStart()).line + 1}`;
      const arg = n.arguments[2];
      if (!arg) throw new Error(`${where}: no window argument`);
      try {
        out.push({ where, ms: evaluate(arg, sf) });
      } catch (e) {
        throw new Error(`${where}: ${(e as Error).message}`);
      }
    }
    ts.forEachChild(n, visit);
  };
  visit(sf);
  return out;
}

describe('every checkRateLimit caller (B-F1)', () => {
  it('uses a window no longer than MAX_RATE_LIMIT_WINDOW_MS', () => {
    const files = callerFiles();
    // The routes that count today: magic-link, audits/start, re-audit, notify, verify, mint, the
    // report routes, waitlist, takedown. A sweep that found none would pass by reading nothing.
    expect(files.length).toBeGreaterThanOrEqual(10);
    const found = files.flatMap(windows);
    expect(found.length).toBeGreaterThanOrEqual(files.length);
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
});
