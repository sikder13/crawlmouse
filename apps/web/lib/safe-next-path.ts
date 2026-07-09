// SPEC 04.1 R1 — validate a `?next=` return target to a SAME-ORIGIN RELATIVE path before it is ever
// rendered as a link. The param is attacker-reachable (someone can craft
// `/verify/<id>?next=https://evil.com`), so anything that could navigate off-origin must be rejected —
// preventing an open redirect. Returns the normalized relative path, or `null` (→ render no link).
export function safeNextPath(next: string | null | undefined): string | null {
  if (typeof next !== 'string' || next.length === 0) return null;
  // A path-absolute relative ref only: exactly one leading slash (not protocol-relative `//` or a
  // backslash escape `/\`), and no whitespace/backslash anywhere (CR/LF/TAB smuggling, path escapes).
  if (!next.startsWith('/') || next.startsWith('//') || next.startsWith('/\\')) return null;
  if (/[\s\\]/.test(next)) return null;
  try {
    const base = 'https://c.invalid';
    const u = new URL(next, base);
    if (u.origin !== base) return null; // an absolute / off-origin ref parsed through → reject
    const resolved = u.pathname + u.search + u.hash;
    // Dot segments (e.g. `/.//evil.com`, `/foo/../..//evil.com`) can NORMALIZE to a protocol-relative
    // `//evil.com` that a browser treats as OFF-ORIGIN. Re-check the RESOLVED path, not just the raw
    // input, so a normalized `//host` can never reach an `<a href>` (open redirect).
    if (!resolved.startsWith('/') || resolved.startsWith('//')) return null;
    return resolved;
  } catch {
    return null;
  }
}
