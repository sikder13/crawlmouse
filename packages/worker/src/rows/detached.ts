/**
 * A copy of a string that holds no reference to the string it came from.
 *
 * V8 represents `s.slice(...)` of a long string as a view into it, so a short prefix kept from a
 * 10 MiB body keeps the whole body alive (8 such prefixes held 80 MiB, measured). It builds strings
 * concatenated a character at a time, as toPersistableText does, as a tree of fragments: a
 * 2,000-character anchor text held about 60 KB that way, against 2 KB flat (measured). Every string
 * the worker stores is copied through here by bounded() (rows/bounded.ts); access.ts also copies the
 * start of each response it keeps while a page is read.
 *
 * The copy goes through UTF-8, which keeps a one-byte string one-byte. A lone surrogate does not
 * survive UTF-8, so a string holding one is copied through UTF-16 instead, unchanged.
 */
export function detached(s: string): string {
  const copy = Buffer.from(s, 'utf8').toString('utf8');
  return copy === s ? copy : Buffer.from(s, 'utf16le').toString('utf16le');
}
