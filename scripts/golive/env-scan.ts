/**
 * Which environment variables the code reads (CC-35 D3b). The scan parses each source file with the
 * TypeScript compiler and walks its syntax tree, so a name in a comment or inside a string that is
 * not an index is not a read. What counts as a read:
 *
 *   process.env.X        process.env['X']        process.env?.X
 *   env.X  env?.X  env['X']   where the object is an identifier named `env` or ending in `Env`
 *   const { X } = process.env    (and the same from an `env` identifier)
 *   const SOME_ENV = 'X'         a name constant (the worker client's `WORKER_URL_ENV`)
 *   const ENV = { token: 'X' }   a table of name constants (`ENV` or `*_ENV`; the render client's)
 *
 * `env[SOME_ENV]` and `env[ENV.token]` are covered by the constant's own declaration. Any other dynamic read
 * (`env[name]` with a computed name) is not found: `DYNAMIC_READS` lists the ones known, and
 * env-scan.test.ts fails when a new `env[identifier]` appears outside them.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

export const REPO_ROOT = join(fileURLToPath(new URL('.', import.meta.url)), '../..');

export interface EnvRead {
  name: string;
  /** Repo-relative, `/`-separated. */
  file: string;
  line: number;
}

const NAME = /^[A-Z][A-Z0-9_]*$/;
const SOURCE_EXT = /\.(ts|tsx|mts|cts|js|mjs|cjs)$/;
const SKIP_DIRS = new Set(['node_modules', '.next', 'dist', '.turbo', 'coverage']);

/** A test, a fixture or a test harness: read by the test runner, never by a deployed build. */
export function isTestFile(file: string): boolean {
  return (
    /\.(test|spec)\.[cm]?[jt]sx?$/.test(file) ||
    /\.fixture\.[cm]?[jt]sx?$/.test(file) ||
    /(^|\/)(__tests__|test-support|tests|e2e)\//.test(file) ||
    /(^|\/)(vitest|playwright)\.config\.[cm]?[jt]s$/.test(file)
  );
}

/** `ENV`, or a name ending in `_ENV`: a constant holding environment names. */
const isNameConstant = (name: string): boolean => name === 'ENV' || /_ENV$/.test(name);

/** The expression under `as const`, `satisfies …` and parentheses. */
function unwrap(node: ts.Expression): ts.Expression {
  let n = node;
  while (ts.isAsExpression(n) || ts.isSatisfiesExpression(n) || ts.isParenthesizedExpression(n)) {
    n = n.expression;
  }
  return n;
}

function isEnvObject(node: ts.Expression): boolean {
  if (ts.isPropertyAccessExpression(node)) {
    return (
      node.name.text === 'env' &&
      ts.isIdentifier(node.expression) &&
      node.expression.text === 'process'
    );
  }
  if (ts.isIdentifier(node)) return node.text === 'env' || /Env$/.test(node.text);
  return false;
}

/** Every environment name `source` reads, by the spellings in this file's header. */
export function readsIn(source: string, file: string): EnvRead[] {
  const sf = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, scriptKind(file));
  const found: EnvRead[] = [];
  const add = (name: string, node: ts.Node) => {
    if (!NAME.test(name)) return;
    found.push({ name, file, line: sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1 });
  };
  const visit = (node: ts.Node): void => {
    if (ts.isPropertyAccessExpression(node) && isEnvObject(node.expression)) {
      add(node.name.text, node.name);
    } else if (
      ts.isElementAccessExpression(node) &&
      isEnvObject(node.expression) &&
      (ts.isStringLiteral(node.argumentExpression) ||
        ts.isNoSubstitutionTemplateLiteral(node.argumentExpression))
    ) {
      add(node.argumentExpression.text, node.argumentExpression);
    } else if (
      ts.isVariableDeclaration(node) &&
      node.initializer &&
      ts.isObjectBindingPattern(node.name) &&
      isEnvObject(node.initializer)
    ) {
      for (const el of node.name.elements) {
        const key = el.propertyName ?? el.name;
        if (ts.isIdentifier(key) || ts.isStringLiteral(key)) add(key.text, key);
      }
    } else if (
      ts.isVariableDeclaration(node) &&
      ts.isIdentifier(node.name) &&
      isNameConstant(node.name.text) &&
      node.initializer
    ) {
      const init = unwrap(node.initializer);
      if (ts.isStringLiteral(init)) add(init.text, init);
      if (ts.isObjectLiteralExpression(init)) {
        for (const p of init.properties) {
          if (ts.isPropertyAssignment(p) && ts.isStringLiteral(unwrap(p.initializer))) {
            add((unwrap(p.initializer) as ts.StringLiteral).text, p.initializer);
          }
        }
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return found;
}

/** `env[expression]` reads whose name the scan cannot see: not a literal and not a name constant. */
export function dynamicReadsIn(source: string, file: string): EnvRead[] {
  const sf = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, scriptKind(file));
  const found: EnvRead[] = [];
  const visit = (node: ts.Node): void => {
    if (
      ts.isElementAccessExpression(node) &&
      isEnvObject(node.expression) &&
      !ts.isStringLiteral(node.argumentExpression) &&
      !ts.isNoSubstitutionTemplateLiteral(node.argumentExpression) &&
      !isConstantRef(node.argumentExpression)
    ) {
      found.push({
        name: node.argumentExpression.getText(sf),
        file,
        line: sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1,
      });
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return found;
}

/** `SOME_ENV` or `ENV.key`: a reference to a name constant the scan reads at its declaration. */
function isConstantRef(node: ts.Expression): boolean {
  if (ts.isIdentifier(node)) return isNameConstant(node.text);
  return (
    ts.isPropertyAccessExpression(node) &&
    ts.isIdentifier(node.expression) &&
    isNameConstant(node.expression.text)
  );
}

function scriptKind(file: string): ts.ScriptKind {
  if (file.endsWith('.tsx')) return ts.ScriptKind.TSX;
  if (/\.[cm]?js$/.test(file)) return ts.ScriptKind.JS;
  return ts.ScriptKind.TS;
}

/** The directories the deployed code is built from. */
export function scanRoots(root = REPO_ROOT): string[] {
  const packages = readdirSync(join(root, 'packages'))
    .map((p) => join(root, 'packages', p, 'src'))
    .filter((p) => {
      try {
        return statSync(p).isDirectory();
      } catch {
        return false;
      }
    });
  return [join(root, 'apps/web'), join(root, 'inngest'), ...packages];
}

function walk(dir: string, out: string[]): void {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (!SKIP_DIRS.has(entry.name)) walk(join(dir, entry.name), out);
    } else if (SOURCE_EXT.test(entry.name) && !entry.name.endsWith('.d.ts')) {
      out.push(join(dir, entry.name));
    }
  }
}

/** The non-test source files under the scan roots, repo-relative. */
export function sourceFiles(root = REPO_ROOT): string[] {
  const files: string[] = [];
  for (const dir of scanRoots(root)) walk(dir, files);
  return files.map((f) => relative(root, f).split(sep).join('/')).filter((f) => !isTestFile(f));
}

export function scan(root = REPO_ROOT): EnvRead[] {
  return sourceFiles(root).flatMap((f) => readsIn(readFileSync(join(root, f), 'utf8'), f));
}

export function scanDynamic(root = REPO_ROOT): EnvRead[] {
  return sourceFiles(root).flatMap((f) => dynamicReadsIn(readFileSync(join(root, f), 'utf8'), f));
}

/** True for a file of the crawl worker, which runs on Fly and reads Fly's environment, not Vercel's. */
export const isWorkerFile = (file: string): boolean => file.startsWith('packages/worker/');
