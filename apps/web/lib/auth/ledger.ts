/**
 * The trial ledger rule (CC-25, D4 as amended on 2026-11-05).
 *
 * A first login is refused the no-card Pro trial when a `trial_ledger` row with the same hash says:
 * - `email`: a trial on this normalised email in the last 12 months;
 * - `device`: two trials from this browser's `cm_auth_device` id in the last 30 days (this would be the
 *   third, SECURITY-DESIGN §5.3);
 * - `ip24`: two trials from this /24 (IPv4) or /48 (IPv6) in the last 30 days AND at least one from
 *   this device in the same 30 days: the IP never refuses a trial on its own (§5.3, shared networks).
 *
 * Values are stored as HMAC-SHA256 under `TRIAL_LEDGER_PEPPER`, keyed by kind, so a row says nothing
 * readable and a hash of one kind never matches another. CC-04 owns the `hostname` and
 * `card_fingerprint` kinds and the 13-month sweep; rows of those kinds are not read here.
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

export interface PriorLedgerRow {
  kind: LedgerKind;
  created_at: Date;
}

export interface LedgerDecision {
  deny: boolean;
  /** The kinds that refused the trial, in LEDGER_KINDS order; empty when it is allowed. */
  hits: LedgerKind[];
}

const DAY_MS = 86_400_000;
/** The window of the device and IP rules. */
export const RECENT_DAYS = 30;
/** Prior trials from one device (or one network) that refuse the next. */
export const RECENT_TRIALS_REFUSED_AT = 2;
/** A pepper shorter than this is treated as unset. */
export const MIN_PEPPER_LENGTH = 32;

/** The same instant 12 calendar months earlier, clamped to the month's last day (Postgres's rule). */
export function twelveMonthsBefore(now: Date): Date {
  const d = new Date(now.getTime());
  const day = d.getUTCDate();
  d.setUTCDate(1);
  d.setUTCFullYear(d.getUTCFullYear() - 1);
  const lastDay = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate();
  d.setUTCDate(Math.min(day, lastDay));
  return d;
}

/** The earliest `created_at` any rule reads: rows older than this cannot change the decision. */
export function oldestRelevant(now: Date): Date {
  return twelveMonthsBefore(now);
}

export function ledgerDecision(rows: readonly PriorLedgerRow[], now: Date): LedgerDecision {
  const yearStart = twelveMonthsBefore(now).getTime();
  const recentStart = now.getTime() - RECENT_DAYS * DAY_MS;
  const count = (kind: LedgerKind, since: number) =>
    rows.filter((r) => r.kind === kind && r.created_at.getTime() > since).length;

  const email = count('email', yearStart) > 0;
  const devices = count('device', recentStart);
  const device = devices >= RECENT_TRIALS_REFUSED_AT;
  const ip = count('ip24', recentStart) >= RECENT_TRIALS_REFUSED_AT && devices > 0;

  const hits = LEDGER_KINDS.filter((k) => ({ email, device, ip24: ip })[k]);
  return { deny: hits.length > 0, hits };
}

export function hashLedgerValue(pepper: string, kind: LedgerKind, value: string): string {
  return createHmac('sha256', pepper).update(`${kind}:${value}`).digest('hex');
}

/**
 * The name of the one-shot slot a first login takes on a ledger value. A separate HMAC label, so the
 * slot's key (stored in `rate_limits`, and logged if the rate-limit RPC fails) never equals the
 * ledger row's `value_hash`, and the two cannot be joined.
 */
export function slotKey(pepper: string, kind: LedgerKind, valueHash: string): string {
  return `trial:${kind}:${createHmac('sha256', pepper).update(`slot:${kind}:${valueHash}`).digest('hex')}`;
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
