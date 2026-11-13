/**
 * The proof page's own words (CC-31 D6b). A proof page draws a stored `ReportDoc`
 * (lib/v2/reports/generate.ts) and adds no sentence, number or grade to it: the strings below are
 * the labels its layout needs where the document holds none, and
 * components/v2/screens/proof/ProofScreen.test.tsx holds each rendered text to the document's
 * strings and these.
 */
export const PROOF_COPY = {
  /** The heading of the document's not-measured list, which has none of its own. */
  notMeasured: 'Not measured',
  /** A side of a pair whose own label is empty. */
  before: 'Before',
  after: 'After',
} as const;

/** The labels as a list, for the test that holds the page to its document. */
export const PROOF_LABELS: readonly string[] = Object.values(PROOF_COPY);
