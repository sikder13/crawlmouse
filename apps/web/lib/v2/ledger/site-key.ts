/**
 * The ledger's site key (docs/specs/v2/06b-data-foundations.md, "Site key"): HMAC-SHA256 of the
 * site's registrable domain (eTLD+1, lowercased) under `RESEARCH_SITE_KEY`, as 64 hex characters, at
 * key version 1. There is no fallback: the writer asks `siteKeySecretOk` first, and with no key, or a
 * key too short to be one, it writes nothing. The registrable domain is read as the worker reads it
 * (packages/worker/src/politeness/site-key.ts: `getDomain` with private domains, else the hostname).
 */
import { createHmac } from 'node:crypto';
import { getDomain } from 'tldts';

export const SITE_KEY_VERSION = 1;

/** `openssl rand -hex 32` gives 64 hex characters; anything shorter than 32 bytes is refused. */
const KEY = /^(?:[0-9a-f]{2}){32,}$/i;

/** True when `raw` is a usable key: at least 32 bytes as hex. */
export function siteKeySecretOk(raw: string | undefined): raw is string {
  return raw !== undefined && KEY.test(raw.trim());
}

export function registrableDomain(host: string): string {
  const h = host
    .trim()
    .toLowerCase()
    .replace(/^\[|\]$/g, '')
    .replace(/\.$/, '');
  return getDomain(h, { allowPrivateDomains: true }) ?? h;
}

/** `secret` is one `siteKeySecretOk` accepted: hex, decoded to the HMAC's key bytes. */
export function siteKeyFor(host: string, secret: string): string {
  return createHmac('sha256', Buffer.from(secret.trim(), 'hex'))
    .update(registrableDomain(host), 'utf8')
    .digest('hex');
}
