import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';

// POST /api/auth/claim claimed anonymous v1 audits with no binding check and had no caller; the
// sign-in POST (app/login/verify/route.ts) is the one claim path. Nothing may call the old URL again.
// "Call" means code: a string or template literal in a tracked source file, or the URL in a tracked
// JSON, YAML or TOML file. Comments, SQL (applied migrations are append-only and name no URL a client
// calls) and the prose in docs/ and evidence/ record the history and are not read.

const REPO = resolve(__dirname, '../../../..');
// Assembled, so this file does not hold the literal it searches for.
const OLD_URL = ['', 'api', 'auth', 'claim'].join('/');
const CODE = /\.(ts|tsx|mts|cts|js|mjs|cjs)$/;
const CONFIG = /\.(json|ya?ml|toml)$/;

function trackedFiles(): string[] {
  return execFileSync('git', ['ls-files'], { cwd: REPO, encoding: 'utf8' })
    .split('\n')
    .filter((f) => f && !f.startsWith('docs/') && !f.startsWith('evidence/'));
}

/** The string and template literals in a code file's text that hold the old URL, as file:line. */
function literalHits(file: string, text = readFileSync(resolve(REPO, file), 'utf8')): string[] {
  if (!text.includes(OLD_URL)) return [];
  const sf = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true);
  const hits: string[] = [];
  const visit = (node: ts.Node) => {
    if (
      (ts.isStringLiteralLike(node) ||
        ts.isTemplateHead(node) ||
        ts.isTemplateMiddle(node) ||
        ts.isTemplateTail(node)) &&
      node.text.includes(OLD_URL)
    ) {
      hits.push(`${file}:${sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1}`);
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return hits;
}

describe('POST /api/auth/claim is gone', () => {
  it('the route file no longer exists', () => {
    expect(existsSync(resolve(__dirname, '../../app/api/auth/claim/route.ts'))).toBe(false);
  });

  it('no tracked code or config names its URL', () => {
    const files = trackedFiles();
    expect(files.filter((f) => CODE.test(f)).length, 'anti-vacuity').toBeGreaterThan(500);
    const hits = [
      ...files.filter((f) => CODE.test(f)).flatMap((f) => literalHits(f)),
      ...files.filter(
        (f) => CONFIG.test(f) && readFileSync(resolve(REPO, f), 'utf8').includes(OLD_URL),
      ),
    ];
    expect(hits).toEqual([]);
  });

  it('the literal scan finds a call in a string or a template, and not in a comment', () => {
    const src = [
      `// once called ${OLD_URL}`,
      `fetch('${OLD_URL}', { method: 'POST' });`,
      `const u = \`\${base}${OLD_URL}\`;`,
    ].join('\n');
    expect(literalHits('x.ts', src)).toEqual(['x.ts:2', 'x.ts:3']);
  });
});
