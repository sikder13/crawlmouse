/**
 * The trial ledger's email key (SECURITY-DESIGN §3.1): lowercased and trimmed, a `+tag` removed
 * from the local part, and for Gmail the dots removed and googlemail.com folded into gmail.com.
 * It is used for the ledger hash only; mail is delivered to the address as typed.
 *
 * CC-04 imports this for `users.email_normalized`, so ledger rows written now match its lookups.
 */
const GMAIL_DOMAINS = new Set(['gmail.com', 'googlemail.com']);

export function normalizeEmail(email: string): string {
  const parts = /^(.+)@([^@]+)$/.exec(email.trim().toLowerCase());
  if (!parts) throw new RangeError('not an email address');
  let [, local, domain] = parts as unknown as [string, string, string];
  // A tag is what follows the first `+`; an address that starts with `+` has none.
  const [untagged] = local.split('+');
  if (untagged) local = untagged;
  if (GMAIL_DOMAINS.has(domain)) {
    local = local.replaceAll('.', '');
    domain = 'gmail.com';
  }
  return `${local}@${domain}`;
}
