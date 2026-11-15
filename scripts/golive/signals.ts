/**
 * The Sentry signals the code sets (CC-38 D6): every `signal` property of a `tags` object literal in
 * the source of apps/web, inngest and packages, read with the TypeScript parser, so a tag written on
 * several lines, quoted, spread beside others or shorthand is found as one written on a line.
 * A literal value (a string, or a template with no substitution) is listed by its name; any other
 * value by the file that sets it, whose name is then read from the file.
 *
 * docs/ops/launch-day.md lists them, pinned by launch-day.test.ts. Print the list:
 *
 *   pnpm --filter @crawlmouse/scripts exec tsx golive/signals.ts
 */
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { REPO_ROOT } from './env-scan';

export interface Signals {
  /** The names set as literals, sorted, each once. */
  literal: string[];
  /** The files that set a signal from a value, sorted, each once. */
  fromValue: string[];
}

/** The directories read, relative to the repository. */
export const SIGNAL_ROOTS = ['apps/web', 'inngest', 'packages'] as const;

const nameOf = (n: ts.PropertyName | undefined): string | undefined =>
  n === undefined
    ? undefined
    : ts.isIdentifier(n) || ts.isStringLiteral(n) || ts.isNoSubstitutionTemplateLiteral(n)
      ? n.text
      : undefined;

/** The signals one source file sets: `{ literal, fromValue }` with `file` for a value. */
export function signalsInSource(file: string, text: string, into: Signals): void {
  const kind = file.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS;
  const sf = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, false, kind);
  const visit = (n: ts.Node): void => {
    if (
      ts.isPropertyAssignment(n) &&
      nameOf(n.name) === 'tags' &&
      ts.isObjectLiteralExpression(n.initializer)
    ) {
      for (const p of n.initializer.properties) {
        if (ts.isShorthandPropertyAssignment(p) && p.name.text === 'signal') {
          into.fromValue.push(file);
        } else if (ts.isPropertyAssignment(p) && nameOf(p.name) === 'signal') {
          let v = p.initializer;
          while (ts.isParenthesizedExpression(v) || ts.isAsExpression(v)) v = v.expression;
          if (ts.isStringLiteral(v) || ts.isNoSubstitutionTemplateLiteral(v))
            into.literal.push(v.text);
          else into.fromValue.push(file);
        }
      }
    }
    ts.forEachChild(n, visit);
  };
  visit(sf);
}

const sorted = (xs: string[]): string[] => [...new Set(xs)].sort();

/** The signals of the tracked, non-test TypeScript source under SIGNAL_ROOTS. */
export function sentrySignals(repo: string = REPO_ROOT): Signals {
  const files = execFileSync('git', ['ls-files', '-z', '--', ...SIGNAL_ROOTS], {
    cwd: repo,
    encoding: 'utf8',
  })
    .split('\0')
    .filter(
      (f) => /\.(ts|tsx|mts|cts)$/.test(f) && !/\.test\.tsx?$/.test(f) && !f.endsWith('.d.ts'),
    );
  const out: Signals = { literal: [], fromValue: [] };
  for (const f of files) {
    const text = readFileSync(join(repo, f), 'utf8');
    if (text.includes('signal')) signalsInSource(f, text, out);
  }
  return { literal: sorted(out.literal), fromValue: sorted(out.fromValue) };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const { literal, fromValue } = sentrySignals();
  console.log('Set as a literal:');
  for (const s of literal) console.log(`  ${s}`);
  console.log('Set from a value (read the name in the file):');
  for (const f of fromValue) console.log(`  ${f}`);
}
