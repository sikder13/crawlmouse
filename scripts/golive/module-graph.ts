/**
 * The repository files the go-live check loads when it runs: a walk of the runtime imports from an
 * entry module. Test-only (probes/check-inputs.test.ts holds `CHECK_INPUTS` in live.ts to it).
 *
 * Followed: `import` and `export … from` declarations that are not `import type` / `export type`, an
 * import whose every named binding is `type` (TypeScript erases it), and `import('…')` calls with a
 * string literal. A relative specifier resolves to `<path>`, `<path>.ts`, `<path>.tsx` or
 * `<path>/index.ts`; a `@crawlmouse/<name>` specifier resolves through that workspace package's
 * `exports` (or `main`). Any other bare specifier is a dependency in node_modules and is not followed.
 */
import { existsSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import ts from 'typescript';
import { REPO_ROOT } from './env-scan';

/** The workspace package directories, by package name. */
function workspacePackages(root: string): Map<string, string> {
  const dirs = ['apps/web', 'inngest', 'scripts'];
  for (const p of ['packages']) {
    for (const d of ts.sys.getDirectories(join(root, p))) dirs.push(`${p}/${d}`);
  }
  const out = new Map<string, string>();
  for (const d of dirs) {
    const file = join(root, d, 'package.json');
    if (!existsSync(file)) continue;
    const pkg = JSON.parse(readFileSync(file, 'utf8')) as { name?: string };
    if (pkg.name) out.set(pkg.name, d);
  }
  return out;
}

const isFile = (p: string): boolean => existsSync(p) && statSync(p).isFile();

function resolveFile(base: string): string | null {
  const stripped = base.replace(/\.js$/, '');
  for (const c of [base, `${stripped}.ts`, `${stripped}.tsx`, join(stripped, 'index.ts')]) {
    if (isFile(c)) return c;
  }
  return null;
}

function resolveWorkspace(spec: string, root: string, pkgs: Map<string, string>): string | null {
  const m = /^(@crawlmouse\/[^/]+)(\/.*)?$/.exec(spec);
  if (!m) return null;
  const dir = pkgs.get(m[1]!);
  if (!dir) throw new Error(`no workspace package ${m[1]}`);
  const pkg = JSON.parse(readFileSync(join(root, dir, 'package.json'), 'utf8')) as {
    exports?: Record<string, string | { import?: string; default?: string }>;
    main?: string;
  };
  const sub = `.${m[2] ?? ''}`;
  const entry = pkg.exports?.[sub] ?? (sub === '.' ? pkg.main : undefined);
  const target = typeof entry === 'string' ? entry : (entry?.import ?? entry?.default);
  if (!target) throw new Error(`${spec} is not exported by ${dir}/package.json`);
  const file = resolveFile(join(root, dir, target));
  if (!file) throw new Error(`${spec} resolves to no file`);
  return file;
}

/** The runtime module specifiers `source` loads. */
export function runtimeSpecifiers(source: string, fileName = 'x.ts'): string[] {
  const sf = ts.createSourceFile(fileName, source, ts.ScriptTarget.Latest, true);
  const out: string[] = [];
  const visit = (node: ts.Node): void => {
    if (ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier)) {
      const clause = node.importClause;
      const typeOnly =
        clause !== undefined &&
        (clause.isTypeOnly ||
          (clause.name === undefined &&
            clause.namedBindings !== undefined &&
            ts.isNamedImports(clause.namedBindings) &&
            clause.namedBindings.elements.length > 0 &&
            clause.namedBindings.elements.every((e) => e.isTypeOnly)));
      if (!typeOnly) out.push(node.moduleSpecifier.text);
    } else if (
      ts.isExportDeclaration(node) &&
      node.moduleSpecifier !== undefined &&
      ts.isStringLiteral(node.moduleSpecifier) &&
      !node.isTypeOnly
    ) {
      out.push(node.moduleSpecifier.text);
    } else if (
      ts.isCallExpression(node) &&
      node.expression.kind === ts.SyntaxKind.ImportKeyword &&
      node.arguments[0] !== undefined &&
      ts.isStringLiteral(node.arguments[0])
    ) {
      out.push(node.arguments[0].text);
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return out;
}

/** The repository files (relative to `root`) loaded at runtime from `entry`, `entry` included. */
export function moduleGraph(entry: string, root = REPO_ROOT): string[] {
  const pkgs = workspacePackages(root);
  const seen = new Set<string>();
  const queue = [resolve(root, entry)];
  while (queue.length > 0) {
    const file = queue.pop()!;
    if (seen.has(file)) continue;
    seen.add(file);
    for (const spec of runtimeSpecifiers(readFileSync(file, 'utf8'), file)) {
      let next: string | null;
      if (spec.startsWith('.')) {
        next = resolveFile(resolve(dirname(file), spec));
        if (!next) throw new Error(`${relative(root, file)}: ${spec} resolves to no file`);
      } else {
        next = resolveWorkspace(spec, root, pkgs);
      }
      if (next && !next.includes(`${'/'}node_modules${'/'}`)) queue.push(next);
    }
  }
  return [...seen].map((f) => relative(root, f)).sort();
}
