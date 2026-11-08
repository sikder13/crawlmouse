/**
 * The trial ledger's values (CC-25, D4 as amended on 2026-11-05). The rule that reads them is SQL:
 * `public.trial_ledger_refusals`, called by `start_trial_with_ledger` (migration 006c,
 * docs/specs/v2/06c-trial-function.md). This module computes what that function is given.
 *
 * Values are stored as HMAC-SHA256 under `TRIAL_LEDGER_PEPPER`, keyed by kind, so a row says nothing
 * readable and a hash of one kind never matches another. The pepper never leaves this process.
 * CC-04 owns the `hostname` and `card_fingerprint` kinds and the 13-month sweep.
 */
import { createHmac } from 'node:crypto';
import { isIP } from 'node:net';
import { normalizeEmail } from './normalize-email';

export type LedgerKind = 'email' | 'device' | 'ip24';
export const LEDGER_KINDS: readonly LedgerKind[] = ['email', 'device', 'ip24'];

export interface LedgerValue {
  kind: LedgerKind;
  value: string;
}

/*
 * The rule's numbers, as spec 25 states them. The SQL holds its own copy, and
 * __tests__/v2-006c-trial-function.test.ts runs vectors built from these through it, so the two
 * cannot differ without that test failing.
 */
/** The window of the email rule, in calendar months. */
export const EMAIL_MONTHS = 12;
/** The window of the device and IP rules. */
export const RECENT_DAYS = 30;
/** Prior trials from one device (or one network) that refuse the next. */
export const RECENT_TRIALS_REFUSED_AT = 2;
/** A pepper shorter than this is treated as unset. */
export const MIN_PEPPER_LENGTH = 32;

export function hashLedgerValue(pepper: string, kind: LedgerKind, value: string): string {
  return createHmac('sha256', pepper).update(`${kind}:${value}`).digest('hex');
}

type Env = Readonly<Record<string, string | undefined>>;

/** The pepper, or null when it is missing or too short to use: the ledger then fails closed. */
export function pepperFrom(env: Env = process.env): string | null {
  const p = env.TRIAL_LEDGER_PEPPER?.trim() ?? '';
  return p.length >= MIN_PEPPER_LENGTH ? p : null;
}

/** The client's network: the /24 of an IPv4 address, the /48 of an IPv6 one, else null. */
export function ip24(ip: string): string | null {
  const mapped = /^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/i.exec(ip);
  const addr = mapped ? mapped[1]! : ip;
  const family = isIP(addr);
  if (family === 4) {
    const [a, b, c] = addr.split('.');
    return `${a}.${b}.${c}.0/24`;
  }
  if (family === 6) {
    const groups = expandIpv6(addr);
    if (!groups) return null;
    const [a, b, c, d, e, f, g, h] = groups;
    // An IPv4 address mapped into IPv6 in hex form (::ffff:cb00:7109) is that IPv4 address.
    if (
      a === '0000' &&
      b === '0000' &&
      c === '0000' &&
      d === '0000' &&
      e === '0000' &&
      f === 'ffff'
    ) {
      const high = parseInt(g!, 16);
      return `${high >> 8}.${high & 255}.${parseInt(h!, 16) >> 8}.0/24`;
    }
    return `${a}:${b}:${c}::/48`;
  }
  return null;
}

/** The eight four-digit groups of an IPv6 address (no embedded IPv4), or null. */
function expandIpv6(addr: string): string[] | null {
  if (addr.includes('.')) return null;
  const [head, tail] = addr.toLowerCase().split('::') as [string, string | undefined];
  const left = head ? head.split(':') : [];
  const right = tail ? tail.split(':') : [];
  const fill = tail === undefined ? 0 : 8 - left.length - right.length;
  const groups = [...left, ...Array<string>(fill).fill('0'), ...right];
  if (groups.length !== 8) return null;
  return groups.map((g) => g.padStart(4, '0'));
}

/** The values a first login is checked against and, when the trial starts, recorded under. */
export function ledgerValues(input: {
  email: string;
  device: string | null;
  ip: string;
}): LedgerValue[] {
  const values: LedgerValue[] = [{ kind: 'email', value: normalizeEmail(input.email) }];
  if (input.device) values.push({ kind: 'device', value: input.device });
  const network = ip24(input.ip);
  if (network) values.push({ kind: 'ip24', value: network });
  return values;
}
