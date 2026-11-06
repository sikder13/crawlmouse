/**
 * The grade-change guard: the grades are a published number, so the code that computes them cannot
 * change without the record of what it computes. expected.json holds a digest of every file the grades
 * are computed from and the grades and effects of the example sites; this test fails when either no
 * longer matches. To change the grades, change GRADE_VERSION and run fixtures/v2/grade/write-expected.ts,
 * which refuses changed results under an unchanged version.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
import {
  gradeSources,
  guardCases,
  importsOf,
  LIBRARIES,
  PACKAGE_VALUES,
  packageImportsOf,
  sourceDigest,
} from '../../../fixtures/v2/grade/guard.js';
import expected from './expected.json' with { type: 'json' };
import { GRADE_VERSION } from './weights.js';

describe('the grade-change guard', () => {
  it('the grade code is the code expected.json was written from', () => {
    const sources = gradeSources();
    // reached only through other modules: a v1 module, a module two imports deep, and the text bound
    for (const f of ['grade.ts', 'analysis/js-detect.ts', 'v2/grade/access.ts', 'text-safety.ts'])
      expect(sources).toContain(f);
    expect(sources.some((f) => f.endsWith('.test.ts'))).toBe(false);
    expect(sourceDigest(), 'grade code changed without expected.json').toBe(expected.source_digest);
  });

  it('follows relative runtime imports through `from`, bare and dynamic `import`; skips type-only imports, packages and comments', () => {
    const source = [
      "import { a } from './a.js';",
      "import type { B } from '../b/b.js';",
      "export { c } from './c.js';",
      "import './side.js';",
      "import { z } from '@crawlmouse/types/v2';",
      "import { readFileSync } from 'node:fs';",
      'import {\n  type E,\n  d,\n} from "./d.js";',
      "import type {\n  F,\n} from './f.js';",
      "export type { G } from './g.js';",
      // a comment naming a type-only export does not hide the import after it
      "/** Each fix's export type is listed below */\nimport { h } from './h.js';",
      // a type alias with no semicolon does not swallow the next import
      'export type K = { k: number }\nimport { m } from "./m.js";',
      "// import { fake } from './fake.js';",
      "const lazy = () => import('./lazy.js');",
      "const url = 'https://a.test'; import { n } from './n.js';",
      // text inside a string, a comment or a regular expression is not code
      "const mime = 'text/html,*/*'; import { o } from './o.js'; /** note */",
      "const joined = `${a}//${b}`; import { p } from './p.js';",
      'export const s = "x from \'./fake.js\'"',
      '"foo"// import { f } from \'./fake.js\'',
      'const t = "import { f } from \'./fake.js\'";',
      "const u = `import x from './fake.js'`;",
      "const r = /\\//; import { real } from './real.js';",
      // braces holding only type names are erased too
      "import { type Q } from './q-type.js';",
    ].join('\n');
    expect(importsOf('v2/grade/x.ts', source)).toEqual([
      'v2/grade/a.ts',
      'v2/grade/c.ts',
      'v2/grade/side.ts',
      'v2/grade/d.ts',
      'v2/grade/h.ts',
      'v2/grade/m.ts',
      'v2/grade/lazy.ts',
      'v2/grade/n.ts',
      'v2/grade/o.ts',
      'v2/grade/p.ts',
      'v2/grade/real.ts',
    ]);
  });

  it("the grade's files call three libraries and take one value from a workspace package, and the digest holds each", () => {
    const found = gradeSources().flatMap((f) =>
      packageImportsOf(readFileSync(new URL(`../../${f}`, import.meta.url), 'utf8')).map(
        (spec) => `${f} ${spec}`,
      ),
    );
    expect(found).toEqual([
      'analysis/js-detect.ts cheerio',
      'analysis/pagerank.ts graphology-pagerank',
      'constants.ts @crawlmouse/types',
      'graph.ts graphology',
      'v2/content/read.ts cheerio',
    ]);
    // the one value constants.ts takes from @crawlmouse/types, by name
    const constants = ts.createSourceFile(
      'constants.ts',
      readFileSync(new URL('../../constants.ts', import.meta.url), 'utf8'),
      ts.ScriptTarget.Latest,
    );
    const names = constants.statements.flatMap((st) =>
      ts.isExportDeclaration(st) &&
      st.moduleSpecifier &&
      ts.isStringLiteral(st.moduleSpecifier) &&
      st.moduleSpecifier.text === '@crawlmouse/types' &&
      st.exportClause &&
      ts.isNamedExports(st.exportClause)
        ? st.exportClause.elements.map((e) => e.name.text)
        : [],
    );
    expect(names).toEqual(Object.keys(PACKAGE_VALUES['@crawlmouse/types']));
    const packages = new Set(found.map((x) => x.split(' ')[1]!));
    expect([...Object.keys(PACKAGE_VALUES), ...LIBRARIES].sort()).toEqual([...packages].sort());
  });

  it('it is recorded under the current grade version', () => {
    expect(expected.grade_version).toBe(GRADE_VERSION);
  });

  it('the example sites grade as recorded', () => {
    expect(JSON.parse(JSON.stringify(guardCases()))).toEqual(expected.cases);
  });
});
