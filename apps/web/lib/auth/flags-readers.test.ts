import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';

/**
 * V2_PIPELINE registers the pipeline's functions; V2_CHECKS_PUBLIC switches what the account door
 * promises about checks (CC-20b split them). Outside lib/auth/flags.ts, no source file under apps/web
 * or inngest reads either by name: a property access (`env.V2_PIPELINE`, `process.env?.V2_PIPELINE`),
 * an element access with the literal name (`process.env['V2_PIPELINE']`), or a destructuring
 * (`const { V2_PIPELINE } = process.env`), found in the TypeScript AST. A name assembled at run time is
 * not seen. And the two account pages that render the promises read the copy flag, never the pipeline
 * one.
 */

const WEB = join(__dirname, '../..');
const REPO = join(WEB, '../..');
const SKIP = new Set(['node_modules', '.next', '__tests__', 'tests', 'public']);
const FLAGS = new Set(['V2_PIPELINE', 'V2_CHECKS_PUBLIC']);

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return SKIP.has(name) ? [] : sources(path);
    return /\.(ts|tsx)$/.test(name) && !/\.(test|spec)\.tsx?$/.test(name) && !name.endsWith('.d.ts')
      ? [path]
      : [];
  });
}

/** The flag a node reads by name, if it reads one. */
function flagRead(n: ts.Node): string | null {
  if (ts.isPropertyAccessExpression(n) && FLAGS.has(n.name.text)) return n.name.text;
  if (
    ts.isElementAccessExpression(n) &&
    ts.isStringLiteralLike(n.argumentExpression) &&
    FLAGS.has(n.argumentExpression.text)
  )
    return n.argumentExpression.text;
  if (ts.isBindingElement(n) && ts.isObjectBindingPattern(n.parent)) {
    const key = n.propertyName ?? n.name;
    const text = ts.isComputedPropertyName(key)
      ? ts.isStringLiteralLike(key.expression)
        ? key.expression.text
        : null
      : ts.isIdentifier(key) || ts.isStringLiteral(key)
        ? key.text
        : null;
    if (text !== null && FLAGS.has(text)) return text;
  }
  return null;
}

/** `file:line flag` for each read of a flag by name in `text`. */
function flagReads(file: string, text: string): string[] {
  const kind = file.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS;
  const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, kind);
  const found: string[] = [];
  const visit = (n: ts.Node) => {
    const flag = flagRead(n);
    if (flag)
      found.push(`${file}:${source.getLineAndCharacterOfPosition(n.getStart()).line + 1} ${flag}`);
    ts.forEachChild(n, visit);
  };
  visit(source);
  return found;
}

const FILES = [...sources(WEB), ...sources(join(REPO, 'inngest'))];

describe('the v2 pipeline and copy flags', () => {
  it('are read by name in lib/auth/flags.ts and in no other source file under apps/web or inngest', () => {
    const readers = FILES.flatMap((f) => flagReads(relative(REPO, f), readFileSync(f, 'utf8')));
    expect(readers.map((r) => r.split(':')[0])).toEqual([
      'apps/web/lib/auth/flags.ts',
      'apps/web/lib/auth/flags.ts',
    ]);
  });

  it.each([
    ['a property access', 'const on = env.V2_PIPELINE;'],
    ['an optional chain on process.env', 'const on = process.env?.V2_CHECKS_PUBLIC;'],
    ['an element access', "const on = process.env['V2_PIPELINE'];"],
    ['a template-literal element access', 'const on = process.env[`V2_CHECKS_PUBLIC`];'],
    ['a destructuring', 'const { V2_CHECKS_PUBLIC } = process.env;'],
    ['a renamed destructuring', 'const { V2_PIPELINE: on } = process.env;'],
    ['a computed-key destructuring', "const { ['V2_PIPELINE']: on } = process.env;"],
  ])('counts %s as a read', (_, line) => {
    expect(flagReads('x.ts', line)).toHaveLength(1);
  });

  it.each([
    ['a string naming the flag', "const note = 'set V2_PIPELINE=1';"],
    ['a comment', '// V2_CHECKS_PUBLIC waits on CC-28'],
    ['another variable', 'const on = env.V2_ACCOUNT_DOOR;'],
  ])('does not count %s', (_, line) => {
    expect(flagReads('x.ts', line)).toEqual([]);
  });

  it('scans apps/web, the account pages and inngest', () => {
    const rel = FILES.map((f) => relative(REPO, f));
    expect(rel).toContain('apps/web/lib/auth/flags.ts');
    expect(rel).toContain('apps/web/app/(account)/signup/page.tsx');
    expect(rel.some((f) => f.startsWith('inngest/'))).toBe(true);
  });

  it.each(['app/(account)/signup/page.tsx', 'app/(account)/check-email/page.tsx'])(
    '%s renders the promises from V2_CHECKS_PUBLIC',
    (page) => {
      const source = readFileSync(join(WEB, page), 'utf8');
      expect(source).toMatch(/checksPublic=\{checksPublicEnabled\(\)\}/);
      expect(source).not.toMatch(/\bpipelineEnabled\b/);
    },
  );
});
