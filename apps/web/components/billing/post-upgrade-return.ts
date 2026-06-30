const KEY = 'crawlmouse_post_upgrade_return';

// Post-purchase return-to-cure (§7): stash where the user was upgrading FROM (the audit result) so
// that after checkout → /dashboard?upgraded=1 → ActivatingPro can land them back on the now-unlocked
// cure instead of a generic dashboard. Only an internal /audit/<id> path survives the guard — never
// an external/protocol-relative/other path (no open redirect).

/** Validate a stashed return target. Returns the path only if it is an internal /audit/<id>. */
export function safeReturnTo(path: string | null | undefined): string | null {
  if (!path) return null;
  return /^\/audit\/[A-Za-z0-9_-]+$/.test(path) ? path : null;
}

export function stashReturnTo(path: string): void {
  try {
    sessionStorage.setItem(KEY, path);
  } catch {
    // sessionStorage unavailable — degrade to landing on the dashboard.
  }
}

/** Read + consume the stashed return target (validated). */
export function readReturnTo(): string | null {
  try {
    const v = sessionStorage.getItem(KEY);
    sessionStorage.removeItem(KEY);
    return safeReturnTo(v);
  } catch {
    return null;
  }
}
