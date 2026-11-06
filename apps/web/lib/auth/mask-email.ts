/**
 * The address as the Check-email page shows it: the local part shortened to its first character,
 * the domain whole ("y…@company.com"), so a person can tell which inbox to open while the page shows
 * no more of the address than it needs to.
 */
export function maskEmail(email: string): string | null {
  const at = email.lastIndexOf('@');
  if (at <= 0 || at === email.length - 1) return null;
  const local = email.slice(0, at);
  const domain = email.slice(at + 1);
  return `${local.length > 1 ? `${[...local][0]}…` : local}@${domain}`;
}
