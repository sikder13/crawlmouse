/**
 * The links CC-27b emails: a random token in the link, and only its sha256 in `account_tokens`. A
 * token is looked up by its hash, so no comparison of secrets happens in application code.
 */
import { createHash, randomBytes } from 'node:crypto';

/** 32 random bytes, base64url: 43 characters, no padding. */
export function newToken(): string {
  return randomBytes(32).toString('base64url');
}

/** The shape `newToken` produces; anything else is refused before a database read. */
const TOKEN = /^[A-Za-z0-9_-]{43}$/;

export const isToken = (value: unknown): value is string =>
  typeof value === 'string' && TOKEN.test(value);

/** The stored form: sha256, lowercase hex (`account_tokens.token_hash`). */
export function hashToken(token: string): string {
  return createHash('sha256').update(token, 'utf8').digest('hex');
}
