/**
 * What the first-login hook and the claim read and write, as an interface. `stores.ts` implements it
 * with the service-role supabase-js client for the routes; the tests implement it over PGlite with
 * the applied migrations, so both drive the same SQL.
 */
import type { AccountState } from '@crawlmouse/types/v2';
import type { PaidTier, Tier } from '../entitlement-v2';
import type { TrialVariant } from '../billing/state-machine';
import type { LedgerKind, PriorLedgerRow } from './ledger';
import type { SiteSchedule } from './schedule';

/** A user's default account, with what the door needs of it. */
export interface MemberAccount {
  accountId: string;
  ownerSeatId: string;
  state: AccountState;
  tier: Tier;
  trialVariant: TrialVariant | null;
  trialEndsAt: Date | null;
  trialUsedAt: Date | null;
  pastDueTier: PaidTier | null;
  pastDueSince: Date | null;
  siteLimit: number;
  timezone: string;
}

export interface LedgerHash {
  kind: LedgerKind;
  value_hash: string;
}

export interface NewSite {
  accountId: string;
  ownerSeatId: string;
  host: string;
  schedule: SiteSchedule | null;
}

export interface CheckForClaim {
  checkId: string;
  siteId: string;
  siteAccountId: string | null;
  host: string;
  expiresAt: Date | null;
}

export type TakeSiteResult = 'taken' | 'not_unowned' | 'host_kept';

export interface DoorStore {
  /** The user's default account and its active owner seat, or null when the user has none. */
  loadMember(userId: string): Promise<MemberAccount | null>;
  setTimezone(accountId: string, zone: string): Promise<void>;
  /** Ledger rows of these kinds and hashes created after `since`, from any account. */
  priorLedger(hashes: readonly LedgerHash[], since: Date): Promise<PriorLedgerRow[]>;
  insertLedger(accountId: string, hashes: readonly LedgerHash[]): Promise<void>;
  /** Kept, not removed, primary (not staging) sites of the account. */
  countActiveSites(accountId: string): Promise<number>;
  /** 'exists' when the account already keeps that host (`sites_account_host_uq`). */
  insertSite(site: NewSite): Promise<{ siteId: string } | 'exists'>;
  loadCheck(checkId: string): Promise<CheckForClaim | null>;
  /** Sets the owner where there is none; 'not_unowned' when another claim got there first. */
  takeSite(siteId: string, site: Omit<NewSite, 'host'>): Promise<TakeSiteResult>;
  clearExpiry(checkId: string): Promise<void>;
}

/**
 * Takes the slot named by `key` (stores.ts `gridSerialize`). False when another caller took it within
 * half a slot window, or when the store cannot say: the caller then refuses, never allows.
 */
export type Serialize = (key: string) => Promise<boolean>;

/** A Sentry signal: a name, and ids only (never an email or a ledger value). */
export type Report = (signal: string, extra: Record<string, string>) => void;
