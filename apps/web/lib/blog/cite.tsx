import type { ReactNode } from 'react';

// Citation primitives for research posts. A number in a research post is never typed bare: it is
// wrapped in <N> naming the source file and how the number is found there, and a sentence that
// carries a number carries a footnote <Ref> to the same file. __tests__/research-article-data.test.tsx
// resolves every <N> against the file it names and fails on any number left outside one. The data-*
// attributes are what that test reads; they also let a reader of the page source see where each
// number came from.

/** Folder the sources live in, relative to the repository root. */
export const SOURCE_DIR = 'docs/research/2026-10-crawler-access/';

export const SOURCES = {
  readme: {
    n: 1,
    file: 'README.md',
    about: 'what each round tested, when, from which network, and the limits the rounds share.',
  },
  r1: {
    n: 2,
    file: '01-homepage-probe-96-sites.md',
    about:
      'the first round: method, results, raw tables per site and identity, and the tagged re-run.',
  },
  r2: {
    n: 3,
    file: '02-sample-probe.md',
    about:
      'the second round, both parts: method, per-site tables, verdict counts, bugs found and limits.',
  },
  r3: {
    n: 4,
    file: 'fly-run-2/discriminators-2026-10-27T21-02-49-840Z.json',
    about: 'the third round: verdict counts per site and crawler name.',
  },
} as const;

export type SourceKey = keyof typeof SOURCES;

/** A pointer into the round-three JSON: the verdict rows for one site and verdict. */
export interface RowSpec {
  site: string;
  verdict: string;
  /** The crawler names the claim covers. Omitted: every crawler name recorded for the site. */
  tokens?: readonly string[];
}

/**
 * A number, with where it comes from. Give at least one of:
 * - `q`: an exact quote from the file that states the number;
 * - `row` + `field`: round-three verdict rows whose `count` or `of` all equal the number;
 * - `derived`: a count the test recomputes from the files (see DERIVED in the test).
 */
export function N({
  s,
  q,
  row,
  field,
  derived,
  children,
}: {
  s: SourceKey;
  q?: string;
  row?: RowSpec;
  field?: 'count' | 'of';
  derived?: 'distinct-sites' | 'egress-networks' | 'round3-crawler-names';
  children: string;
}) {
  return (
    <span
      data-n=""
      data-src={SOURCES[s].file}
      data-q={q}
      data-row={row ? JSON.stringify(row) : undefined}
      data-field={field}
      data-derived={derived}
    >
      {children}
    </span>
  );
}

/** A footnote marker pointing at the Data entry for a source file. */
export function Ref({ s }: { s: SourceKey }) {
  const { n, file } = SOURCES[s];
  return (
    <sup data-ref={file}>
      [<a href={`#data-${n}`}>{n}</a>]
    </sup>
  );
}

const ROUND_WORDS = { 1: 'one', 2: 'two', 3: 'three' } as const;

/** "round two": a label for a round, not a count. */
export function Round({ n, cap }: { n: 1 | 2 | 3; cap?: boolean }) {
  return (
    <span data-label="round" data-round={n}>
      {cap ? 'Round' : 'round'} {ROUND_WORDS[n]}
    </span>
  );
}

/** A file or folder name. */
export function FileName({ path, children }: { path: string; children?: ReactNode }) {
  return <code data-file={path}>{children ?? path}</code>;
}

/** The closing "Data" section: one entry per source, each the target of its footnotes. */
export function DataNotes({ intro }: { intro: ReactNode }) {
  return (
    <>
      <h2>Data</h2>
      <p>{intro}</p>
      <ol id="data">
        {Object.values(SOURCES).map((src) => (
          <li key={src.n} id={`data-${src.n}`}>
            <FileName path={src.file} />: {src.about}
          </li>
        ))}
      </ol>
    </>
  );
}
