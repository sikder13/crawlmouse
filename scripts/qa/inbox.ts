import type { QaKey } from './accounts';

/**
 * The QA accounts' addresses: one owner-controlled inbox, plus-addressed by account key
 * (`QA_INBOX=qa@example.test` gives `qa+free@example.test`). The inbox comes from the environment
 * only, so no person's address is in the repo.
 */

export class QaInboxError extends Error {}

/** `QA_INBOX`, checked: one `@`, a local part and a domain, and no `+` of its own. */
export function qaInbox(env: Readonly<Record<string, string | undefined>>): {
  local: string;
  domain: string;
} {
  const raw = env.QA_INBOX?.trim() ?? '';
  if (raw === '') throw new QaInboxError('set QA_INBOX to the QA mailbox, e.g. qa@example.test');
  const parts = raw.split('@');
  const [local, domain] = parts;
  if (parts.length !== 2 || !local || !domain || !domain.includes('.')) {
    throw new QaInboxError('QA_INBOX is not an address');
  }
  if (local.includes('+')) {
    throw new QaInboxError('QA_INBOX must be the bare mailbox; qa:seed adds the +key itself');
  }
  return { local: local.toLowerCase(), domain: domain.toLowerCase() };
}

export function qaAddress(inbox: { local: string; domain: string }, key: QaKey): string {
  return `${inbox.local}+${key}@${inbox.domain}`;
}
