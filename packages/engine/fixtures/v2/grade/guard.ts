/**
 * What the grade-change guard pins (src/v2/grade/expected.json): the files the grades are computed
 * from, by digest, and the grades and effects of the example sites.
 */
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
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

/** Comments, removed before imports are read, so a comment cannot hide or fake one. */
const COMMENTS = /\/\*[\s\S]*?\*\/|(^|[^:'"`\\])\/\/.*$/gm;

/**
 * A relative module specifier in an `import … from` or `export … from` statement, a bare `import '…'`
 * or a dynamic `import('…')`. A statement's clause holds no quote, semicolon, or another `import` or
 * `export`, so a match cannot run from one statement into the next. `import type` and `export type`
 * statements (group 1) are erased when compiled and cannot change a computed grade, so they are not
 * followed; an inline `type` inside braces is, with its statement. Package imports are not followed.
 */
const RELATIVE =
  /\b(?:import|export)\s+(type\s+)?(?:(?!\b(?:import|export)\b)[^;'"])*?\bfrom\s*['"](\.{1,2}\/[^'"]+)['"]|\bimport\s*\(?\s*['"](\.{1,2}\/[^'"]+)['"]/g;

/** The relative runtime imports of the engine source file `file` (a path under src/), as paths under src/. */
export function importsOf(file: string, source: string): string[] {
  const code = source.replace(COMMENTS, '$1');
  return [...code.matchAll(RELATIVE)]
    .filter((m) => m[1] === undefined)
    .map((m) => {
      const url = new URL((m[2] ?? m[3])!.replace(/\.js$/, '.ts'), new URL(file, SRC));
      return url.pathname.slice(SRC.pathname.length);
    });
}

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

export const sourceDigest = (): string => digestOf(gradeSources());

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
  return {
    '31 % of words served without JavaScript, every crawler served': outcomeOf(csrSite(0.31)),
    'words without JavaScript not yet measured': outcomeOf(csrSite(null)),
    'blog: a crawler blocked, one served thin, 8 openings without an answer, 2 orphans': outcomeOf(
      blog.input,
      blog.access,
    ),
    'blog: one scored crawler measured': outcomeOf(oneMeasured.input, oneMeasured.access),
  };
}
