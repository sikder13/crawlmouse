/**
 * The address as the Check-email page shows it: the local part shortened to its first character,
 * the domain whole ("y…@company.com"), so a person can tell which inbox to open while the page shows
 * no more of the address than it needs to.
 */
export function maskEmail(email: string): string | null {
  const parts = /^(.+)@([^@]+)$/.exec(email);
  if (!parts) return null;
  const [, local, domain] = parts as unknown as [string, string, string];
  const [first] = [...local];
  return `${local.length > 1 ? `${first}…` : local}@${domain}`;
}
