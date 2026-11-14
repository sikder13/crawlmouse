/**
 * CC-38 D3: a server event about an internal account carries `internal: true`. CC-33's
 * `captureServerEvent` derives it from the event's subject: its distinct id when that is
 * `account:<id>`, `seat:<id>` or a bare id, and its `accountId` when the caller passes one
 * (`subjectsOf`, lib/v2/ops/internal-marker.ts on CC-33's tree). So the property this file checks is
 * the subject, call by call: each call that can fire about an account or a user names one in a form
 * `subjectsOf` reads.
 *
 * The calls are found with the TypeScript type checker over apps/web's source (inngest's comes in
 * through its imports): every call whose resolved signature is `captureServerEvent`'s, which takes in
 * a call through a value typed `typeof captureServerEvent` (pricing/events.ts, account-events.ts).
 * A call whose distinct id is a parameter of the function around it makes that function a wrapper;
 * the calls of the wrapper's signature are then read the same way, at any depth.
 *
 * A subject is accepted when:
 * - the event object passes an `accountId` (its value is not followed: a caller passing a null it
 *   could have filled is not seen here);
 * - the distinct id is a template starting `account:` or `seat:`;
 * - the distinct id is `x === null ? <no account> : <accepted>` (or `!== null` the other way round),
 *   the branch for a null account naming none.
 * Anything else fails, `check:` and `report:` included, which name something an account can own.
 *
 * The property needs CC-33's derivation, and fails on this tree without it (the check events name
 * `check:<ref>` and the ServerEvent type has no `accountId`); it runs once
 * lib/v2/ops/internal-marker.ts exists. The enumeration runs on any tree.
 */
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import ts from 'typescript';
import { beforeAll, describe, expect, it } from 'vitest';

const WEB = resolve(__dirname, '..');
const REPO = resolve(WEB, '../..');
const SENDER = join(WEB, 'lib/analytics-server.ts');
const CC33 = existsSync(join(WEB, 'lib/v2/ops/internal-marker.ts'));

const isSource = (f: string) =>
  !f.includes('/node_modules/') &&
  !/\.test\.tsx?$/.test(f) &&
  !f.includes('/__tests__/') &&
  (f.startsWith(`${WEB}/`) || f.startsWith(`${REPO}/inngest/`));

function program(): ts.Program {
  const config = ts.getParsedCommandLineOfConfigFile(
    join(WEB, 'tsconfig.json'),
    {},
    {
      ...ts.sys,
      onUnRecoverableConfigFileDiagnostic: (d) => {
        throw new Error(ts.flattenDiagnosticMessageText(d.messageText, '\n'));
      },
    },
  )!;
  const roots = config.fileNames.filter(isSource);
  return ts.createProgram(roots, { ...config.options, noEmit: true, incremental: false });
}

interface Call {
  /** `file:line` of the call, relative to the repository. */
  at: string;
  /** For a call of a wrapper: the `captureServerEvent` call inside the wrapper. */
  via?: string;
  /** How the subject was read, or why it was not accepted. */
  subject: string;
  ok: boolean;
}

function walk(node: ts.Node, visit: (n: ts.Node) => void): void {
  visit(node);
  ts.forEachChild(node, (c) => walk(c, visit));
}

const where = (n: ts.Node): string => {
  const sf = n.getSourceFile();
  return `${relative(REPO, sf.fileName)}:${sf.getLineAndCharacterOfPosition(n.getStart()).line + 1}`;
};

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

function enumerate(p: ts.Program): Call[] {
  const checker = p.getTypeChecker();
  const sources = p.getSourceFiles().filter((sf) => isSource(sf.fileName));
  const calls: ts.CallExpression[] = [];
  for (const sf of sources) walk(sf, (n) => ts.isCallExpression(n) && calls.push(n));

  const senderDecl = calls
    .map((c) => calleeOf(checker, c))
    .find(
      (d) =>
        d !== undefined &&
        d.getSourceFile().fileName === SENDER &&
        ts.isFunctionDeclaration(d) &&
        d.name?.text === 'captureServerEvent',
    );
  if (senderDecl === undefined) throw new Error('no call resolves to captureServerEvent');

  const out: Call[] = [];
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
    if (prop('accountId')) {
      out.push({ at: where(c), ok: true, subject: 'accountId' });
      continue;
    }
    const id = prop('distinctId');
    const expr =
      id === undefined
        ? undefined
        : ts.isPropertyAssignment(id)
          ? id.initializer
          : ts.isShorthandPropertyAssignment(id)
            ? id.name
            : undefined;
    if (expr === undefined) {
      out.push({ at: where(c), ok: false, subject: 'no distinctId' });
      continue;
    }
    for (const r of subject(expr, c)) out.push({ at: where(c), ...r });
  }
  return out;
}

describe('CC-38 D3: the server events name the subject internal is derived from', () => {
  let calls: Call[] = [];
  beforeAll(() => {
    calls = enumerate(program());
  }, 180_000);

  it('finds the direct calls a text search finds, and the calls through a typed alias', () => {
    const grep = execFileSync(
      'git',
      [
        'grep',
        '-n',
        'captureServerEvent(',
        '--',
        'apps/web',
        'inngest',
        ':!*.test.ts',
        ':!*.test.tsx',
      ],
      { cwd: REPO, encoding: 'utf8' },
    )
      .split('\n')
      .filter(Boolean)
      // The declaration, and the doc comments that name the function with a parenthesis.
      .filter((l) => !/export async function captureServerEvent\(|^\S+:\d+:\s*(\/\*\*|\*)/.test(l))
      .map((l) => l.split(':').slice(0, 2).join(':'));
    const found = new Set(calls.flatMap((c) => [c.at, c.via]));
    expect(grep.length).toBeGreaterThan(0);
    for (const at of grep) expect(found.has(at), at).toBe(true);
    // Through `capture: typeof captureServerEvent = captureServerEvent`.
    expect(calls.some((c) => c.at.startsWith('apps/web/lib/v2/pricing/events.ts:'))).toBe(true);
    expect(calls.some((c) => c.at.startsWith('apps/web/lib/v2/account/account-events.ts:'))).toBe(
      true,
    );
    // Through a wrapper: persist.ts sends fix_closed through account/events.ts's Sender.
    expect(calls.some((c) => c.at.startsWith('apps/web/lib/v2/pipeline/persist.ts:'))).toBe(true);
  });

  it.runIf(CC33)('accepts no call whose subject internal cannot be derived from', () => {
    const refused = calls.filter((c) => !c.ok).map((c) => `${c.at} ${c.subject}`);
    expect(refused).toEqual([]);
  });

  it.skipIf(CC33)(
    'is waiting for CC-33: without it the check events name no account (the property runs once lib/v2/ops/internal-marker.ts exists)',
    () => {
      expect(calls.some((c) => !c.ok)).toBe(true);
    },
  );
});
