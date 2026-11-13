import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, posix, resolve } from 'node:path';
import { NextRequest, NextResponse } from 'next/server';
import ts from 'typescript';
import { describe, expect, it, vi } from 'vitest';
import { handleEdge } from '../../middleware';
import { ROUTE_POLICIES } from '../../lib/security/route-policy';

// CC-35 D5. POST /api/billing/agency-trial (CC-03) opened an Agency trial with no consent recorded
// (CC-31 Q45). CC-29's POST /api/agency-trial records the consent and is the one way to start one.
// "Names the URL" means code: a string or template literal in a tracked source file, or the URL in a
// tracked JSON, YAML or TOML file. docs/ and evidence/ record the history and are not read.

const REPO = resolve(__dirname, '../../../..');
// Assembled, so this file does not hold the literal it searches for.
const OLD_URL = ['', 'api', 'billing', 'agency-trial'].join('/');
const OLD_ROUTE = OLD_URL.slice(1);
const CODE = /\.(ts|tsx|mts|cts|js|mjs|cjs)$/;
const CONFIG = /\.(json|ya?ml|toml)$/;
const TEST = /\.test\.(ts|tsx)$/;
const THIS_FILE = 'apps/web/__tests__/security/billing-agency-trial-removed.test.ts';

const tracked = (): string[] =>
  execFileSync('git', ['ls-files'], { cwd: REPO, encoding: 'utf8' })
    .split('\n')
    .filter((f) => f && f !== THIS_FILE && !f.startsWith('docs/') && !f.startsWith('evidence/'));

const read = (file: string): string => readFileSync(resolve(REPO, file), 'utf8');
const sourceOf = (file: string, text = read(file)) =>
  ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true);

/** The string and template literals in a code file that hold `needle`, as file:line. */
function literalHits(file: string, needle: string, text = read(file)): string[] {
  if (!text.includes(needle)) return [];
  const sf = sourceOf(file, text);
  const hits: string[] = [];
  const visit = (node: ts.Node) => {
    if (
      (ts.isStringLiteralLike(node) ||
        ts.isTemplateHead(node) ||
        ts.isTemplateMiddle(node) ||
        ts.isTemplateTail(node)) &&
      node.text.includes(needle)
    ) {
      hits.push(`${file}:${sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1}`);
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return hits;
}

/** Whether a module specifier is lib/billing/agency-trial, by the alias or by any relative path. */
const STARTER = 'apps/web/lib/billing/agency-trial';

/** Whether `specifier`, imported from `file` (repo-relative), is lib/billing/agency-trial. */
function isAgencyTrialModule(file: string, specifier: string): boolean {
  const path = specifier.startsWith('@/')
    ? `apps/web/${specifier.slice(2)}`
    : specifier.startsWith('.')
      ? posix.join(dirname(file), specifier)
      : specifier;
  return path.replace(/\.(ts|js)$/, '') === STARTER;
}

/** Files that import `agencyTrial` (the starter) from lib/billing/agency-trial, in any import form. */
function starterImports(file: string, text = read(file)): boolean {
  const sf = sourceOf(file, text);
  let found = false;
  const visit = (node: ts.Node) => {
    if (
      ts.isImportDeclaration(node) &&
      ts.isStringLiteral(node.moduleSpecifier) &&
      isAgencyTrialModule(file, node.moduleSpecifier.text)
    ) {
      const b = node.importClause?.namedBindings;
      if (b && ts.isNamespaceImport(b)) found = true;
      if (b && ts.isNamedImports(b)) {
        found ||= b.elements.some((e) => (e.propertyName ?? e.name).text === 'agencyTrial');
      }
    }
    if (
      ts.isCallExpression(node) &&
      node.expression.kind === ts.SyntaxKind.ImportKeyword &&
      node.arguments[0] &&
      ts.isStringLiteralLike(node.arguments[0]) &&
      isAgencyTrialModule(file, node.arguments[0].text)
    ) {
      found = true;
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return found;
}

describe('POST /api/billing/agency-trial is gone (CC-35 D5)', () => {
  it('the route file no longer exists', () => {
    expect(existsSync(resolve(__dirname, '../../app/api/billing/agency-trial/route.ts'))).toBe(
      false,
    );
  });

  it('the route policy has no row for it, so the middleware answers 404 before any route runs', async () => {
    expect(ROUTE_POLICIES.map((p) => p.route)).not.toContain(OLD_ROUTE);
    const next = vi.fn(() => Promise.resolve(NextResponse.next()));
    const res = await handleEdge(
      new NextRequest(
        new Request(`https://crawlmouse.com${OLD_URL}`, {
          method: 'POST',
          headers: { origin: 'https://crawlmouse.com', 'content-type': 'application/json' },
          body: JSON.stringify({ interval: 'month' }),
        }),
      ),
      next,
      () => {},
    );
    expect(res.status).toBe(404);
    expect(next).not.toHaveBeenCalled();
  });

  it('no tracked code or config names its URL', () => {
    const files = tracked();
    expect(files.filter((f) => CODE.test(f)).length, 'anti-vacuity').toBeGreaterThan(500);
    const hits = [
      ...files.filter((f) => CODE.test(f)).flatMap((f) => literalHits(f, OLD_URL)),
      ...files.filter((f) => CODE.test(f)).flatMap((f) => literalHits(f, OLD_ROUTE)),
      ...files.filter((f) => CONFIG.test(f) && read(f).includes(OLD_ROUTE)),
    ];
    expect(hits).toEqual([]);
  });

  it("CC-29's route, which records consent, is the one source file that imports the trial starter", () => {
    const importers = tracked()
      .filter((f) => f.startsWith('apps/web/') && CODE.test(f) && !TEST.test(f))
      .filter((f) => read(f).includes('agency-trial') && starterImports(f));
    expect(importers).toEqual(['apps/web/app/api/agency-trial/route.ts']);
  });

  it('reads every import form of the starter', () => {
    const forms: [file: string, text: string][] = [
      ['apps/web/app/api/x/route.ts', "import { agencyTrial } from '@/lib/billing/agency-trial';"],
      [
        'apps/web/app/api/x/route.ts',
        "import { agencyTrial as s } from '../../../lib/billing/agency-trial';",
      ],
      ['apps/web/lib/billing/x.ts', "import { agencyTrial } from './agency-trial';"],
      ['apps/web/app/api/x/route.ts', "import * as t from '@/lib/billing/agency-trial';"],
      ['apps/web/app/api/x/route.ts', "const t = await import('@/lib/billing/agency-trial');"],
    ];
    for (const [file, text] of forms) expect(starterImports(file, text), text).toBe(true);
    // A relative path that does not reach lib/billing is another module.
    expect(
      starterImports(
        'apps/web/app/api/x/route.ts',
        "import { agencyTrial } from './agency-trial';",
      ),
    ).toBe(false);
    expect(
      starterImports(
        'apps/web/x.ts',
        "import { AGENCY_TRIAL_HREF } from '@/lib/v2/view/agencies';",
      ),
    ).toBe(false);
    expect(
      starterImports('apps/web/x.ts', "import type { X } from '@/lib/v2/view/agency-trial';"),
    ).toBe(false);
  });
});
