/**
 * CC-38 D3: reads, with the TypeScript type checker, which subject each server event names. Used by
 * `__tests__/v2-038-internal-events.test.ts` over apps/web's source, and by the same file over small
 * fixture programs that probe the rules (a structural alias, `.call`, `.bind`, the function passed as
 * an argument, a literal null `accountId`).
 *
 * Two passes, both over one `ts.Program`:
 *
 * 1. References. Every identifier whose symbol (through import aliases) is `captureServerEvent`'s is
 *    read where it stands. Accepted: the declaration's own name; an import specifier; `typeof
 *    captureServerEvent` in a type; the callee of a call (`captureServerEvent(…)`, `ns.captureServerEvent(…)`);
 *    and the initialiser or default of a variable or parameter whose written type is `typeof
 *    captureServerEvent`. That binding's own references are then read by the same rules. Any other
 *    reference is an escape and is reported refused: a structural alias, `.call`, `.bind`, an
 *    argument, an object property, a re-export. A call made through an escape is not a call of
 *    `captureServerEvent`'s signature, so pass 2 would not see it; pass 1 is what catches it.
 * 2. Calls. Every call whose resolved signature is `captureServerEvent`'s declaration (a direct call,
 *    or one through a binding typed `typeof captureServerEvent`). Its event object is read:
 *    - `accountId` is accepted unless it is a literal `null`, `undefined` or `void …`, or its type has
 *      nothing but null / undefined in it. A nullable `string | null` is accepted: a check no account
 *      keeps has none to name (Q17). A refused `accountId` falls through to the distinct id.
 *    - the distinct id: a template starting `account:` or `seat:`; `x === null ? <none> : <accepted>`
 *      (or `!==` the other way round), the set branch interpolating `x`; a parameter of the function
 *      around the call makes it a wrapper, whose callers are read at that argument, at any depth.
 *    Anything else is refused, `check:` and `report:` included.
 */
import { existsSync } from 'node:fs';
import { join, relative } from 'node:path';
import ts from 'typescript';

export interface Tree {
  /** apps/web, or a fixture program's root. */
  web: string;
  /** The repository root, which `at` is relative to. */
  repo: string;
  /** The file declaring `captureServerEvent`. */
  sender: string;
  /** Which program files are read. */
  isSource: (file: string) => boolean;
}

export interface Call {
  /** `file:line` of the call (or the escaping reference), relative to `tree.repo`. */
  at: string;
  /** For a call of a wrapper: the `captureServerEvent` call inside the wrapper. */
  via?: string;
  /** How the subject was read, or why it was not accepted. */
  subject: string;
  ok: boolean;
}

/** apps/web of a checkout, with its sources and `inngest`'s that it imports. */
export function webTree(web: string): Tree {
  const repo = join(web, '../..');
  return {
    web,
    repo,
    sender: join(web, 'lib/analytics-server.ts'),
    isSource: (f) =>
      !f.includes('/node_modules/') &&
      !/\.test\.tsx?$/.test(f) &&
      !f.includes('/__tests__/') &&
      (f.startsWith(`${web}/`) || f.startsWith(`${repo}/inngest/`)),
  };
}

export const hasCc33 = (web: string): boolean =>
  existsSync(join(web, 'lib/v2/ops/internal-marker.ts'));

/** The program apps/web's tsconfig describes, its source roots only. */
export function webProgram(tree: Tree): ts.Program {
  const config = ts.getParsedCommandLineOfConfigFile(
    join(tree.web, 'tsconfig.json'),
    {},
    {
      ...ts.sys,
      onUnRecoverableConfigFileDiagnostic: (d) => {
        throw new Error(ts.flattenDiagnosticMessageText(d.messageText, '\n'));
      },
    },
  )!;
  const roots = config.fileNames.filter(tree.isSource);
  return ts.createProgram(roots, { ...config.options, noEmit: true, incremental: false });
}

function walk(node: ts.Node, visit: (n: ts.Node) => void): void {
  visit(node);
  ts.forEachChild(node, (c) => walk(c, visit));
}

/** The declaration a call resolves to, or undefined. */
function calleeOf(checker: ts.TypeChecker, call: ts.CallExpression): ts.Declaration | undefined {
  return checker.getResolvedSignature(call)?.getDeclaration() ?? undefined;
}

/** The function a node sits in, if any. */
function enclosingFunction(n: ts.Node): ts.SignatureDeclaration | undefined {
  for (let p = n.parent; p; p = p.parent) {
    if (ts.isArrowFunction(p) || ts.isFunctionExpression(p) || ts.isFunctionDeclaration(p))
      return p;
    if (ts.isMethodDeclaration(p)) return p;
  }
  return undefined;
}

/**
 * The signature a wrapper's callers resolve to: the type it is written against (a `Sender`, a
 * `CaptureEvent`) when it has one, else its own declaration.
 */
function wrapperSignature(
  checker: ts.TypeChecker,
  fn: ts.SignatureDeclaration,
): ts.Declaration | undefined {
  if (ts.isArrowFunction(fn) || ts.isFunctionExpression(fn)) {
    const contextual = checker.getContextualType(fn);
    const decl = contextual?.getCallSignatures()[0]?.getDeclaration();
    if (decl) return decl;
  }
  return fn;
}

/** Parentheses, `as`, `satisfies`, `!` and `<T>x` removed. */
function bare(e: ts.Expression): ts.Expression {
  for (;;) {
    if (
      ts.isParenthesizedExpression(e) ||
      ts.isAsExpression(e) ||
      ts.isSatisfiesExpression(e) ||
      ts.isNonNullExpression(e) ||
      ts.isTypeAssertionExpression(e)
    )
      e = e.expression;
    else return e;
  }
}

const NOTHING = ts.TypeFlags.Null | ts.TypeFlags.Undefined | ts.TypeFlags.Void | ts.TypeFlags.Never;

/** Why an `accountId` expression names no account, or undefined when it can name one. */
function emptyAccountId(checker: ts.TypeChecker, expr: ts.Expression): string | undefined {
  const e = bare(expr);
  if (e.kind === ts.SyntaxKind.NullKeyword) return 'accountId is a literal null';
  if (ts.isIdentifier(e) && e.text === 'undefined') return 'accountId is a literal undefined';
  if (ts.isVoidExpression(e)) return 'accountId is void';
  const type = checker.getTypeAtLocation(e);
  const parts = type.isUnion() ? type.types : [type];
  if (parts.every((t) => (t.flags & NOTHING) !== 0))
    return `accountId's type is ${checker.typeToString(type)}`;
  return undefined;
}

export function enumerate(p: ts.Program, tree: Tree): Call[] {
  const checker = p.getTypeChecker();
  const sources = p.getSourceFiles().filter((sf) => tree.isSource(sf.fileName));
  const where = (n: ts.Node): string => {
    const sf = n.getSourceFile();
    return `${relative(tree.repo, sf.fileName)}:${sf.getLineAndCharacterOfPosition(n.getStart()).line + 1}`;
  };

  const calls: ts.CallExpression[] = [];
  const identifiers = new Map<string, ts.Identifier[]>();
  for (const sf of sources)
    walk(sf, (n) => {
      if (ts.isCallExpression(n)) calls.push(n);
      else if (ts.isIdentifier(n)) {
        const list = identifiers.get(n.text);
        if (list) list.push(n);
        else identifiers.set(n.text, [n]);
      }
    });

  const senderFile = p.getSourceFile(tree.sender);
  let senderDecl: ts.FunctionDeclaration | undefined;
  if (senderFile)
    walk(senderFile, (n) => {
      if (ts.isFunctionDeclaration(n) && n.name?.text === 'captureServerEvent') senderDecl = n;
    });
  if (senderDecl === undefined || senderDecl.name === undefined)
    throw new Error(`no captureServerEvent declared in ${tree.sender}`);
  const senderSymbol = checker.getSymbolAtLocation(senderDecl.name);
  if (senderSymbol === undefined) throw new Error('captureServerEvent has no symbol');

  const out: Call[] = [];

  // Pass 1: the references.
  const resolveSymbol = (id: ts.Identifier): ts.Symbol | undefined => {
    const parent = id.parent;
    let s: ts.Symbol | undefined;
    if (ts.isShorthandPropertyAssignment(parent) && parent.name === id)
      s = checker.getShorthandAssignmentValueSymbol(parent);
    else if (ts.isExportSpecifier(parent)) s = checker.getExportSpecifierLocalTargetSymbol(parent);
    else s = checker.getSymbolAtLocation(id);
    if (s && s.flags & ts.SymbolFlags.Alias) s = checker.getAliasedSymbol(s);
    return s;
  };
  const isTypeofSender = (t: ts.TypeNode | undefined): boolean => {
    if (t === undefined || !ts.isTypeQueryNode(t)) return false;
    const name = ts.isIdentifier(t.exprName) ? t.exprName : t.exprName.right;
    return resolveSymbol(name) === senderSymbol;
  };

  const followed = new Set<ts.Symbol>([senderSymbol]);
  const queue: { symbol: ts.Symbol; name: string; what: string }[] = [
    { symbol: senderSymbol, name: 'captureServerEvent', what: 'captureServerEvent' },
  ];
  const seenRef = new Set<ts.Identifier>();
  while (queue.length > 0) {
    const { symbol, name, what } = queue.shift()!;
    const names = new Set([name]);
    for (let grew = true; grew; ) {
      grew = false;
      for (const text of [...names])
        for (const id of identifiers.get(text) ?? []) {
          if (seenRef.has(id) || resolveSymbol(id) !== symbol) continue;
          seenRef.add(id);
          const parent = id.parent;
          // A declaration of the symbol itself.
          if (symbol.declarations?.some((d) => (d as ts.NamedDeclaration).name === id)) continue;
          // An import: its local name is read as a reference too.
          if (ts.isImportSpecifier(parent) || ts.isImportClause(parent)) {
            const local = ts.isImportSpecifier(parent) ? parent.name.text : id.text;
            if (!names.has(local)) {
              names.add(local);
              grew = true;
            }
            continue;
          }
          // `typeof captureServerEvent`, and `typeof ns.captureServerEvent`.
          if (ts.isTypeQueryNode(parent) || ts.isQualifiedName(parent)) continue;
          // The callee of a call, directly or as `ns.captureServerEvent`.
          const callee = ts.isPropertyAccessExpression(parent) && parent.name === id ? parent : id;
          if (ts.isCallExpression(callee.parent) && callee.parent.expression === callee) continue;
          // The initialiser or default of a binding typed `typeof captureServerEvent`.
          if (
            (ts.isVariableDeclaration(callee.parent) || ts.isParameter(callee.parent)) &&
            callee.parent.initializer === callee &&
            ts.isIdentifier(callee.parent.name) &&
            isTypeofSender(callee.parent.type)
          ) {
            const binding = checker.getSymbolAtLocation(callee.parent.name);
            if (binding && !followed.has(binding)) {
              followed.add(binding);
              queue.push({
                symbol: binding,
                name: callee.parent.name.text,
                what: `${callee.parent.name.text} (typed typeof captureServerEvent)`,
              });
            }
            continue;
          }
          out.push({
            at: where(id),
            ok: false,
            subject: `escape: ${what} used as \`${callee.parent.getText().slice(0, 80)}\``,
          });
        }
    }
  }

  // Pass 2: the calls.
  const seen = new Set<ts.Declaration>();

  /** Reads one distinct-id expression; a parameter of the surrounding function recurses. */
  const subject = (expr: ts.Expression, at: ts.Node): { ok: boolean; subject: string }[] => {
    const e = ts.isParenthesizedExpression(expr) ? expr.expression : expr;
    if (ts.isTemplateExpression(e) || ts.isNoSubstitutionTemplateLiteral(e)) {
      const head = ts.isTemplateExpression(e) ? e.head.text : e.text;
      const ok = /^(account|seat):$/.test(head);
      return [{ ok, subject: `\`${head}…\`` }];
    }
    if (ts.isConditionalExpression(e) && ts.isBinaryExpression(e.condition)) {
      const op = e.condition.operatorToken.kind;
      const nullSide = e.condition.right.kind === ts.SyntaxKind.NullKeyword;
      if (
        nullSide &&
        (op === ts.SyntaxKind.EqualsEqualsEqualsToken ||
          op === ts.SyntaxKind.ExclamationEqualsEqualsToken)
      ) {
        const [whenNull, whenSet] =
          op === ts.SyntaxKind.EqualsEqualsEqualsToken
            ? [e.whenTrue, e.whenFalse]
            : [e.whenFalse, e.whenTrue];
        const tested = e.condition.left.getText();
        const set = subject(whenSet, at);
        const named =
          (ts.isTemplateExpression(whenSet) &&
            whenSet.templateSpans.some((s) => s.expression.getText() === tested)) ||
          false;
        return set.map((r) => ({
          ok: r.ok && named,
          subject: `${tested} === null ? ${whenNull.getText()} : ${r.subject}`,
        }));
      }
    }
    if (ts.isIdentifier(e)) {
      const fn = enclosingFunction(at);
      const index = fn?.parameters.findIndex(
        (prm) => ts.isIdentifier(prm.name) && prm.name.text === e.text,
      );
      if (fn && index !== undefined && index >= 0) {
        const sig = wrapperSignature(checker, fn);
        if (sig === undefined)
          return [{ ok: false, subject: `parameter ${e.text} of an unreadable wrapper` }];
        if (seen.has(sig)) return [];
        seen.add(sig);
        const callers = calls.filter((c) => calleeOf(checker, c) === sig);
        if (callers.length === 0)
          return [{ ok: false, subject: `parameter ${e.text}: no caller found` }];
        for (const c of callers) {
          const arg = c.arguments[index];
          const results =
            arg === undefined ? [{ ok: false, subject: 'no argument' }] : subject(arg, c);
          for (const r of results) out.push({ at: where(c), via: where(at), ...r });
        }
        return [];
      }
    }
    return [{ ok: false, subject: `unread: ${e.getText()}` }];
  };

  for (const c of calls) {
    if (calleeOf(checker, c) !== senderDecl) continue;
    const event = c.arguments[1];
    if (event === undefined || !ts.isObjectLiteralExpression(event)) {
      out.push({ at: where(c), ok: false, subject: 'the event is not an object literal' });
      continue;
    }
    const prop = (name: string) =>
      event.properties.find((p) => p.name && ts.isIdentifier(p.name) && p.name.text === name);
    const valueOf = (p: ts.ObjectLiteralElementLike | undefined): ts.Expression | undefined =>
      p === undefined
        ? undefined
        : ts.isPropertyAssignment(p)
          ? p.initializer
          : ts.isShorthandPropertyAssignment(p)
            ? p.name
            : undefined;
    const account = valueOf(prop('accountId'));
    const emptyAccount = account === undefined ? undefined : emptyAccountId(checker, account);
    if (account !== undefined && emptyAccount === undefined) {
      out.push({ at: where(c), ok: true, subject: 'accountId' });
      continue;
    }
    const expr = valueOf(prop('distinctId'));
    if (expr === undefined) {
      out.push({ at: where(c), ok: false, subject: emptyAccount ?? 'no distinctId' });
      continue;
    }
    for (const r of subject(expr, c))
      out.push({
        at: where(c),
        ok: r.ok,
        subject: emptyAccount ? `${emptyAccount}; ${r.subject}` : r.subject,
      });
  }
  return out;
}
