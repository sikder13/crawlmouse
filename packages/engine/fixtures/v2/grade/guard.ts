/**
 * What the grade-change guard pins (src/v2/grade/expected.json): the files the grades are computed
 * from, by digest, and the grades and effects of the example sites.
 */
import { createHash } from 'node:crypto';
import ts from 'typescript';
import { MIN_GRADEABLE_PAGES } from '@crawlmouse/types';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { createRequire } from 'node:module';
import { every } from '../access/builders.js';
import { detectorOutcomes } from '../../../src/v2/grade/outcomes.js';
import { gradeCheck, type GradeInput } from '../../../src/v2/grade/index.js';
import type { AccessDetection } from '../../../src/v2/access/types.js';
import { blogSite, csrSite } from './sites.js';

const SRC = new URL('../../../src/', import.meta.url);

/**
 * Where the grades are computed: the grade, its fixes' effects and outcomes, and the content reader
 * that makes the features the content checks judge.
 */
const ENTRIES = ['v2/grade/index.ts', 'v2/grade/outcomes.ts', 'v2/content/read.ts'];

/**
 * The runtime module specifiers of `source`, relative or not, in order, read by the TypeScript parser:
 * `import … from` and `export … from` declarations, bare `import '…'`, `import x = require('…')` and
 * dynamic `import('…')` with a literal specifier. A declaration that is type-only (`import type`,
 * `export type`, or braces holding only `type` names) is erased when compiled and cannot change a
 * computed grade, so it is not followed. Text in strings, comments and regular expressions is not code.
 */
function runtimeSpecifiers(source: string): string[] {
  const file = ts.createSourceFile('x.ts', source, ts.ScriptTarget.Latest, true);
  const out: string[] = [];
  const specifier = (e: ts.Expression | undefined) => {
    if (e && ts.isStringLiteralLike(e)) out.push(e.text);
  };
  const visit = (node: ts.Node): void => {
    if (ts.isImportDeclaration(node)) {
      const c = node.importClause;
      const typeOnly =
        c !== undefined &&
        (c.isTypeOnly ||
          (c.name === undefined &&
            c.namedBindings !== undefined &&
            ts.isNamedImports(c.namedBindings) &&
            c.namedBindings.elements.length > 0 &&
            c.namedBindings.elements.every((e) => e.isTypeOnly)));
      if (!typeOnly) specifier(node.moduleSpecifier);
    } else if (ts.isExportDeclaration(node)) {
      const typeOnly =
        node.isTypeOnly ||
        (node.exportClause !== undefined &&
          ts.isNamedExports(node.exportClause) &&
          node.exportClause.elements.length > 0 &&
          node.exportClause.elements.every((e) => e.isTypeOnly));
      if (!typeOnly) specifier(node.moduleSpecifier);
    } else if (
      ts.isImportEqualsDeclaration(node) &&
      !node.isTypeOnly &&
      ts.isExternalModuleReference(node.moduleReference)
    ) {
      specifier(node.moduleReference.expression);
    } else if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword) {
      specifier(node.arguments[0]);
    }
    ts.forEachChild(node, visit);
  };
  visit(file);
  return out;
}

const isRelative = (spec: string) => /^\.{1,2}\//.test(spec);

/** The relative runtime imports of the engine source file `file` (a path under src/), as paths under src/. */
export function importsOf(file: string, source: string): string[] {
  return runtimeSpecifiers(source)
    .filter(isRelative)
    .map((spec) => {
      const url = new URL(spec.replace(/\.js$/, '.ts'), new URL(file, SRC));
      return url.pathname.slice(SRC.pathname.length);
    });
}

/** The package imports (not `node:`) of `source` that run: values another package gives the grade. */
export const packageImportsOf = (source: string): string[] =>
  runtimeSpecifiers(source).filter((spec) => !isRelative(spec) && !spec.startsWith('node:'));

/** `entries` and every engine file they import at runtime, directly or through another, sorted. */
export function closureOf(entries: readonly string[]): string[] {
  const seen = new Set<string>();
  const visit = (f: string): void => {
    if (seen.has(f)) return;
    seen.add(f);
    for (const g of importsOf(f, readFileSync(new URL(f, SRC), 'utf8'))) visit(g);
  };
  entries.forEach(visit);
  return [...seen].sort();
}

/** Every engine file the grades are computed from: ENTRIES and what they import at runtime. */
export const gradeSources = (): string[] => closureOf(ENTRIES);

/** The sha256 of `files` (paths under src/), each with its path. */
export function digestOf(files: readonly string[]): string {
  const h = createHash('sha256');
  for (const f of files) h.update(`${f}\0${readFileSync(new URL(f, SRC), 'utf8')}\0`);
  return h.digest('hex');
}

/**
 * What the file digest cannot see: the value the grade's files take from a workspace package at
 * runtime, and the installed version of each library they call. grade-guard.test.ts fails when the
 * closure's package imports are not exactly these.
 */
export const PACKAGE_VALUES = { '@crawlmouse/types': { MIN_GRADEABLE_PAGES } } as const;
export const LIBRARIES = ['cheerio', 'graphology', 'graphology-pagerank'] as const;

const require = createRequire(new URL('../../../package.json', import.meta.url));
/** The installed version of `lib`: the package.json above its entry point that names it. */
function versionOf(lib: string): string {
  for (let dir = dirname(require.resolve(lib)); dir !== dirname(dir); dir = dirname(dir)) {
    const file = join(dir, 'package.json');
    if (!existsSync(file)) continue;
    const pkg = JSON.parse(readFileSync(file, 'utf8')) as { name?: string; version: string };
    if (pkg.name === lib) return pkg.version;
  }
  throw new Error(`guard: no package.json names ${lib}`);
}

export const sourceDigest = (): string =>
  createHash('sha256')
    .update(digestOf(gradeSources()))
    .update(JSON.stringify(PACKAGE_VALUES))
    .update(JSON.stringify(LIBRARIES.map((lib) => [lib, versionOf(lib)])))
    .digest('hex');

/** The content reader and what it imports: the code the label set's features were read with. */
export const readerDigest = (): string => digestOf(closureOf(['v2/content/read.ts']));

function outcomeOf(input: GradeInput, access: AccessDetection[] = []) {
  const g = gradeCheck(input);
  const { outcomes, overview } = detectorOutcomes(g, access, input.structure);
  return {
    technical_seo: g.technical_seo,
    ai_readability: g.ai_readability,
    content: g.content,
    signals: g.signals.map((s) => ({ signal: s.signal, state: s.state })),
    fixes: outcomes
      .flatMap((o) => (o.state === 'detected' ? [{ fingerprint: o.fingerprint, ...o.fix }] : []))
      .sort((a, b) => a.rank - b.rank)
      .map((f) => ({ type: f.type, fingerprint: f.fingerprint, rank: f.rank, effect: f.effect })),
    overview,
  };
}

const blocked = every(2, 'blocked_by_ua_rule');

/** The example sites, by name, and what the engine makes of each. */
export function guardCases(): Record<string, ReturnType<typeof outcomeOf>> {
  const blog = blogSite(
    13,
    8,
    { PerplexityBot: blocked, 'ChatGPT-User': every(2, 'allowed_thin') },
    [{ path: '/old-1' }, { path: '/old-2' }],
  );
  const refused = every(2, 'refused_unverified');
  const oneMeasured = blogSite(6, 0, {
    'OAI-SearchBot': refused,
    'ChatGPT-User': refused,
    'Claude-SearchBot': refused,
    PerplexityBot: blocked,
  });
  // the counted checks fail on posts, and question headings (not counted) on every page
  const thin = blogSite(13, 0);
  const posts = [...thin.input.content.keys()].filter((u) => u.includes('/blog/'));
  const content = new Map(
    [...thin.input.content].map(([u, f]) => {
      const i = posts.indexOf(u);
      if (i === -1)
        return [u, { ...f, headings: { count: 4, questions: 0, section_questions: 0 } }];
      return [
        u,
        {
          ...f,
          headings: { count: 4, questions: 0, section_questions: 0 },
          json_ld: f.json_ld.map((n) => ({
            ...n,
            has_author: false,
            has_description: i % 2 === 0,
          })),
          byline: { ...f.byline, meta_author: false },
        },
      ];
    }),
  );
  return {
    'blog: no post names its author, 6 of 13 lack a page description, no question headings':
      outcomeOf({ ...thin.input, content }, thin.access),
    '31 % of words served without JavaScript, every crawler served': outcomeOf(csrSite(0.31)),
    'words without JavaScript not yet measured': outcomeOf(csrSite(null)),
    'blog: a crawler blocked, one served thin, 8 openings without an answer, 2 orphans': outcomeOf(
      blog.input,
      blog.access,
    ),
    'blog: one scored crawler measured': outcomeOf(oneMeasured.input, oneMeasured.access),
  };
}
