/**
 * The words a report document adds to what the audit's views say: its titles, the headings of its
 * sections, the labels of its tables and of a before-and-after pair. Every other string of a
 * `ReportDoc` is one a view returned (`lib/v2/reports/generate-doc.ts`); the test beside that file
 * holds each document to these two sources.
 */
export const REPORT_DOC_COPY = {
  auditTitle: 'Audit report',
  baselineTitle: 'Baseline',
  compareTitle: 'Before and after',
  fixProofTitle: 'Fix verified',

  grades: 'Grades',
  fixes: 'Open fixes, effects estimated',
  changes: 'What moved',
  notMeasuredEarlier: 'Not measured at the earlier check',

  /** The grades table. */
  gradesCaption: 'Letter, score and what each rests on',
  grade: 'Grade',
  letter: 'Letter',
  score: 'Score of 100',
  summary: 'What it rests on',
  /** What the Grade component prints in place of a letter and a score. */
  withheld: 'withheld',

  /** The crawler tables. */
  crawler: 'Crawler',
  verdict: 'Verdict',
  textRead: 'Text read',
  inTheWay: 'What is in the way',

  /** The fixes table. */
  fix: 'Fix',
  pages: 'Pages',
  effect: 'Estimated effect',
  effort: 'Effort',
  kind: 'Kind',

  /** The signals table. */
  signal: 'Signal',
  status: 'Status',
  where: 'Where',

  /** A before-and-after pair, and the facts under a change. */
  before: 'Before',
  after: 'After',
  effectOnGrades: 'Effect on the grades',
  /** A cell or a side with nothing to say. */
  none: '—',

  /** The line every report ends with; the check's date follows it. */
  checkedWith: 'Checked with Crawlmouse',
} as const;

/** The footer's line: who checked, and when (the check's date as its Result page writes it). */
export const footerLine = (checkedAt: string): string =>
  `${REPORT_DOC_COPY.checkedWith} · ${checkedAt}`;
