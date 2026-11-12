/**
 * The send ledger's rule as cases with their answers written out (D1, D7): the claim and finish
 * answers `claim_email_send` and `finish_email_send` give (migration 20261113000001 section A). Two
 * tests run every case: `__tests__/v2-028-mail.test.ts` against the SQL on PGlite, and `memory.test.ts`
 * against `memoryLedger`. Each holds its ledger to these answers, not to the other ledger, so the two
 * cannot pass by being wrong the same way. Cases that need the two-minute lease are the SQL test's
 * own: the memory ledger has no clock.
 *
 * Test support, imported by tests: `grep -rln "ledger-cases'" apps/web --include='*.ts*' | grep -v '\.test\.'`
 * lists this file alone.
 */
import type { MailKind } from './types';

export type LedgerStep =
  /** Claims the case's key for `kind` (the case's kind when omitted), expecting `answer`. */
  | { claim: Record<string, unknown>; kind?: MailKind }
  /** Finishes the case's key, expecting `answer` (true when the key was `sending`). */
  | { finish: 'sent' | 'failed'; code?: string; answer: boolean }
  /** Records a hard bounce on the case's address. */
  | { suppress: true };

export interface LedgerCase {
  name: string;
  kind: MailKind;
  steps: readonly LedgerStep[];
  /** The key's row at the end, as `status` and `errorCode`. */
  row: { status: string; errorCode: string | null };
}

const go = (attempt: number) => ({ outcome: 'go', attempt });

export const LEDGER_CASES: readonly LedgerCase[] = [
  {
    name: 'a first claim goes at attempt 1',
    kind: 'alert',
    steps: [{ claim: go(1) }],
    row: { status: 'sending', errorCode: null },
  },
  {
    name: 'a second claim while the first is sending is busy; once sent, done',
    kind: 'alert',
    steps: [
      { claim: go(1) },
      { claim: { outcome: 'busy' } },
      { finish: 'sent', answer: true },
      { claim: { outcome: 'done' } },
    ],
    row: { status: 'sent', errorCode: null },
  },
  {
    name: 'three failed attempts, then exhausted',
    kind: 'fix_to_developer',
    steps: [
      { claim: go(1) },
      { finish: 'failed', code: 'provider_500', answer: true },
      { claim: go(2) },
      { finish: 'failed', code: 'provider_500', answer: true },
      { claim: go(3) },
      { finish: 'failed', code: 'provider_500', answer: true },
      { claim: { outcome: 'exhausted' } },
      { claim: { outcome: 'exhausted' } },
    ],
    row: { status: 'failed', errorCode: 'provider_500' },
  },
  {
    name: 'a finish for a key that is not sending records nothing',
    kind: 'check_notify',
    steps: [
      { finish: 'sent', answer: false },
      { claim: go(1) },
      { finish: 'sent', answer: true },
      { finish: 'failed', code: 'late', answer: false },
    ],
    row: { status: 'sent', errorCode: null },
  },
  {
    name: 'a suppressed address is answered suppressed from the first claim on',
    kind: 'weekly_summary',
    steps: [
      { suppress: true },
      { claim: { outcome: 'suppressed' } },
      { claim: { outcome: 'suppressed' } },
    ],
    row: { status: 'suppressed', errorCode: null },
  },
  {
    name: 'account mail goes to a suppressed address',
    kind: 'trial_reminder',
    steps: [{ suppress: true }, { claim: go(1) }],
    row: { status: 'sending', errorCode: null },
  },
  {
    name: 'a retry after a bounce recorded since the first attempt is suppressed, not sent',
    kind: 'alert',
    steps: [
      { claim: go(1) },
      { finish: 'failed', code: 'provider_500', answer: true },
      { suppress: true },
      { claim: { outcome: 'suppressed' } },
      { claim: { outcome: 'suppressed' } },
    ],
    row: { status: 'failed', errorCode: 'suppressed' },
  },
  {
    name: 'the same order for check_notify, the stranger-addressed kind',
    kind: 'check_notify',
    steps: [
      { claim: go(1) },
      { finish: 'failed', code: 'network', answer: true },
      { suppress: true },
      { claim: { outcome: 'suppressed' } },
    ],
    row: { status: 'failed', errorCode: 'suppressed' },
  },
  {
    name: 'an account mail retry still goes after a bounce recorded since',
    kind: 'email_change_confirm',
    steps: [
      { claim: go(1) },
      { finish: 'failed', code: 'provider_500', answer: true },
      { suppress: true },
      { claim: go(2) },
    ],
    row: { status: 'sending', errorCode: null },
  },
  {
    name: 'a key already sent stays done after a bounce',
    kind: 'alert',
    steps: [
      { claim: go(1) },
      { finish: 'sent', answer: true },
      { suppress: true },
      { claim: { outcome: 'done' } },
    ],
    row: { status: 'sent', errorCode: null },
  },
  {
    name: 'a claim another worker holds stays busy after a bounce',
    kind: 'alert',
    steps: [{ claim: go(1) }, { suppress: true }, { claim: { outcome: 'busy' } }],
    row: { status: 'sending', errorCode: null },
  },
];
