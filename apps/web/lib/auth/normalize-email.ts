/**
 * The trial ledger's email key (SECURITY-DESIGN §3.1): lowercased and trimmed, a `+tag` removed
 * from the local part, and for Gmail the dots removed and googlemail.com folded into gmail.com.
 * It is used for the ledger hash only; mail is delivered to the address as typed.
 *
 * CC-04 imports this for `users.email_normalized`, so ledger rows written now match its lookups.
 */
const GMAIL_DOMAINS = new Set(['gmail.com', 'googlemail.com']);

export function normalizeEmail(email: string): string {
  const lowered = email.trim().toLowerCase();
  const at = lowered.lastIndexOf('@');
  if (at <= 0 || at === lowered.length - 1) throw new RangeError('not an email address');
  let local = lowered.slice(0, at);
  let domain = lowered.slice(at + 1);
  const plus = local.indexOf('+');
  if (plus > 0) local = local.slice(0, plus);
  if (GMAIL_DOMAINS.has(domain)) {
    local = local.replaceAll('.', '');
    domain = 'gmail.com';
  }
  return `${local}@${domain}`;
}
