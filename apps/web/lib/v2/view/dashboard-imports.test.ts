import { existsSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';

// The dashboard is built into the production bundle, and the preview build ran out of memory once
// `dashboard.ts` reached the sample-data modules: the four contract fixture JSON files, the
// recordings they are read with, and the public report's snapshot builder. This walks the static
// import graph from `dashboard.ts` and fails, printing the chain, when any of them is reachable.
//
// An edge is an `import … from`, an `export … from`, a bare `import '…'` or a dynamic `import('…')`
// whose specifier is relative or starts with `@/` (apps/web). `import type` and `export type` are
// not edges: the compiler erases them. An import whose named bindings are all `type` is still an
// edge here, which can only make the walk find more, not less. Bare package specifiers are not
// followed. A relative or `@/` specifier that resolves to no file throws, so a path the walker
// cannot follow fails the test instead of being skipped.

const WEB = resolve(__dirname, '../../..');

const FORBIDDEN: readonly { name: string; test: RegExp }[] = [
  { name: 'lib/v2/recordings', test: /^lib\/v2\/recordings(\.|\/|$)/ },
  { name: 'lib/v2/reports/build-snapshot', test: /^lib\/v2\/reports\/build-snapshot(\.|\/|$)/ },
  { name: 'lib/fixtures/v2/*.json', test: /^lib\/fixtures\/v2\/[^/]+\.json$/ },
];

const EXTENSIONS = ['', '.ts', '.tsx', '/index.ts', '/index.tsx'];

function resolveSpecifier(from: string, spec: string): string | null {
  let base: string;
  if (spec.startsWith('@/')) base = join(WEB, spec.slice(2));
  else if (spec.startsWith('./') || spec.startsWith('../')) base = resolve(dirname(from), spec);
  else return null;
  for (const ext of EXTENSIONS) {
    const p = base + ext;
    if (existsSync(p) && statSync(p).isFile()) return p;
  }
  throw new Error(`${relative(WEB, from)}: cannot resolve '${spec}'`);
}

function specifiers(file: string): string[] {
  if (file.endsWith('.json')) return [];
  const src = ts.createSourceFile(file, readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true);
  const out: string[] = [];
  const visit = (node: ts.Node) => {
    if (ts.isImportDeclaration(node)) {
      if (!node.importClause?.isTypeOnly && ts.isStringLiteral(node.moduleSpecifier))
        out.push(node.moduleSpecifier.text);
    } else if (ts.isExportDeclaration(node)) {
      if (!node.isTypeOnly && node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier))
        out.push(node.moduleSpecifier.text);
    } else if (
      ts.isCallExpression(node) &&
      node.expression.kind === ts.SyntaxKind.ImportKeyword &&
      node.arguments[0] &&
      ts.isStringLiteralLike(node.arguments[0])
    ) {
      out.push(node.arguments[0].text);
    }
    ts.forEachChild(node, visit);
  };
  visit(src);
  return out;
}

/** Every file reachable from `entry`, each with the chain (entry first) that first reached it. */
function reachable(entry: string): Map<string, string[]> {
  const start = join(WEB, entry);
  const seen = new Map<string, string[]>([[start, [start]]]);
  const queue = [start];
  while (queue.length > 0) {
    const file = queue.shift()!;
    for (const spec of specifiers(file)) {
      const next = resolveSpecifier(file, spec);
      if (next === null || seen.has(next)) continue;
      seen.set(next, [...seen.get(file)!, next]);
      queue.push(next);
    }
  }
  return seen;
}

/** The forbidden files reachable from `entry`, each as a printed chain. */
function forbiddenChains(entry: string): string[] {
  const out: string[] = [];
  for (const [file, chain] of reachable(entry)) {
    const rel = relative(WEB, file);
    const rule = FORBIDDEN.find((f) => f.test.test(rel));
    if (rule) out.push(`${rule.name}: ${chain.map((c) => relative(WEB, c)).join(' -> ')}`);
  }
  return out.sort();
}

describe('the dashboard import graph', () => {
  it('reaches none of the recordings, the snapshot builder or the fixture JSON from dashboard.ts', () => {
    expect(forbiddenChains('lib/v2/view/dashboard.ts')).toEqual([]);
  });

  // The walker is live: each forbidden pattern is found from a module that does reach it, so an
  // empty result above is the graph, not a matcher or resolver that sees nothing.
  it('does find each forbidden pattern from a module that reaches it', () => {
    const fromAgencies = forbiddenChains('lib/v2/view/agencies.ts').join('\n');
    expect(fromAgencies).toMatch(/^lib\/v2\/recordings: lib\/v2\/view\/agencies\.ts -> /m);
    expect(fromAgencies).toMatch(/^lib\/v2\/reports\/build-snapshot: /m);
    const fromFixtures = forbiddenChains('lib/v2/fixtures.ts');
    expect(fromFixtures.filter((c) => c.startsWith('lib/fixtures/v2/*.json: '))).toHaveLength(4);
  });

  it('follows the @/ alias and throws on a specifier it cannot resolve', () => {
    const from = join(WEB, 'lib/v2/view/dashboard.ts');
    expect(resolveSpecifier(from, '@/lib/v2/recordings')).toBe(join(WEB, 'lib/v2/recordings.ts'));
    expect(resolveSpecifier(from, 'react')).toBeNull();
    expect(() => resolveSpecifier(from, './no-such-module')).toThrow(/cannot resolve/);
  });
});
