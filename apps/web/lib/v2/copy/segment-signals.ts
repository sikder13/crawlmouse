/**
 * Final-Seg-Signals (Agent-readiness signals): where the rebuilt page's text differs from the
 * locked HTML, and why. Applied in order by the lock comparison (__tests__/v2/segment-signals.test.tsx).
 */
import type { Addition, CopyChange } from '../copy-registry';

export const SIGNALS_CHANGES: CopyChange[] = [
  {
    screen: 'segment-signals',
    kind: 'facts',
    locked:
      'Two of seven agent signals are present, and one of the missing five is worth your time today.',
    rendered: 'Two of seven agent signals are present.',
    source:
      'FACTS I10: Web Bot Auth, the one the clause meant, is not a fix and cannot be tested from outside yet.',
  },
  {
    screen: 'segment-signals',
    kind: 'facts',
    locked:
      'Most are new and some have no measured effect yet, so this section does not change your grade and does not add fixes.',
    rendered:
      'Most are new and some have no measured effect yet. Two of them, schema and Content Signals, are worth five points each of the AI readability grade; the other five change nothing yet and add no fixes.',
    source: 'FACTS B5 (the signals that count are read from `counts_toward_grade`).',
  },
  {
    screen: 'segment-signals',
    kind: 'facts',
    locked: 'Absent 5 Absent and worth adding now 1 Effect on the grade none',
    rendered: 'Absent 4 Not tested 1 Effect on the grade 10 of 100',
    source:
      'FACTS I10 (Web Bot Auth is not tested, so neither absent nor worth adding) and B5 (signals are worth 10 of 100).',
  },
  {
    screen: 'segment-signals',
    kind: 'fixture',
    locked: 'Honest answer for most: not yet. Raw responses',
    rendered: 'Honest answer for most: not yet.',
    source:
      'The contract keeps one line of evidence per signal (`evidence`), shown under “Where we looked”; there are no raw responses to open.',
  },
  {
    screen: 'segment-signals',
    kind: 'fixture',
    locked: 'Keep it. Product and Article types are complete.',
    rendered: 'Keep it.',
    source:
      'The fixture records that schema is present (“JSON-LD on 214 of 214 pages”), not which types are complete.',
  },
  // The Web Bot Auth row, in fragments: the locked row repeats its status and lift for the phone
  // layout and hides one copy at each width, so each fragment is one the page shows at every width.
  {
    screen: 'segment-signals',
    kind: 'facts',
    locked: 'not in effect',
    rendered: 'not tested',
    source:
      'FACTS I10: Web Bot Auth is a Signals row worded “Cloudflare can verify signed crawlers; we cannot test this from outside yet”, not a fix; no lift is claimed for what was not tested.',
    all: true,
  },
  {
    screen: 'segment-signals',
    kind: 'facts',
    locked:
      'Worth setting up. The durable version of the Cloudflare fix in Crawler access; on Pro there.',
    rendered: 'Nothing to do yet: we check it again on the next audit.',
    source:
      'FACTS I10: Web Bot Auth is a Signals row worded “Cloudflare can verify signed crawlers; we cannot test this from outside yet”, not a fix; no lift is claimed for what was not tested.',
  },
  {
    screen: 'segment-signals',
    kind: 'facts',
    locked: 'Yes, in our crawls: the durable way past Bot Fight Mode',
    rendered: 'Not measured: we cannot test it from outside yet',
    source:
      'FACTS I10: Web Bot Auth is a Signals row worded “Cloudflare can verify signed crawlers; we cannot test this from outside yet”, not a fix; no lift is claimed for what was not tested.',
    all: true,
  },
  {
    screen: 'segment-signals',
    kind: 'facts',
    locked: 'our signed test request was challenged like any other',
    rendered: 'Cloudflare can verify signed crawlers; we cannot test this from outside yet',
    source:
      'FACTS I10: Web Bot Auth is a Signals row worded “Cloudflare can verify signed crawlers; we cannot test this from outside yet”, not a fix; no lift is claimed for what was not tested.',
    hiddenOnPhone: true,
  },
  {
    screen: 'segment-signals',
    kind: 'fixture',
    locked: 'Skip. Fixing the product template gives agents the text they need.',
    rendered: 'Skip. Text in the HTML gives agents what they need.',
    source:
      'The contract ties no signal to a template, so the advice is said of any site rather than of this one’s product template.',
  },
  {
    screen: 'segment-signals',
    kind: 'facts',
    locked: 'AI visibility D · 41',
    rendered: 'AI readability D · 41',
    source: 'FACTS A1 (the competitor table, FACTS-proposed line 93)',
  },
  {
    screen: 'segment-signals',
    kind: 'fixture',
    locked: 'The first two fixes in this audit close that gap.',
    rendered: '',
    source:
      'The fixture does not say which fixes close the gap with the competitor; the sentence keeps what the two audits’ numbers show.',
  },
];

export const SIGNALS_ADDITIONS: Addition[] = [
  {
    screen: 'segment-signals',
    what: 'On a phone, “Who reads it” and “Where we looked” as lines under the advice, where the locked page drops them',
    source: 'Accessibility review: WCAG 1.4.10, no content lost at narrow widths',
  },
  {
    screen: 'segment-signals',
    what: 'Under each signal, whether it counts towards the grade or carries no weight, and its recommendation class (proposed until the contract carries one)',
    source: 'CC-23 brief, scope 5',
  },
  {
    screen: 'segment-signals',
    what: 'The coverage line: how many of the seven signals were tested',
    source: 'CC-23 brief, scope 2 (the coverage line on every section)',
  },
];
