/**
 * What the first-login hook and the claim read and write, as an interface. `stores.ts` implements it
 * with the service-role supabase-js client for the routes; the tests implement it over PGlite with
 * the applied migrations, so both drive the same SQL.
 */
import type { AccountState } from '@crawlmouse/types/v2';
import type { PaidTier, Tier } from '../entitlement-v2';
import type { TrialVariant } from '../billing/state-machine';
import type { LedgerKind } from './ledger';
import type { SiteSchedule } from './schedule';
import type { TrialDecision, TrialTransition } from './trial-decision';

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
  /**
   * The user's default account and its active owner seat, or null when the user has none or the
   * account is marked for deletion (`deletion_confirmed_at`, CC-27b).
   */
  loadMember(userId: string): Promise<MemberAccount | null>;
  setTimezone(accountId: string, zone: string): Promise<void>;
  /**
   * `start_trial_with_ledger` (migration 006c): the ledger rule, the trial and its ledger rows in one
   * transaction. Throws with the SQLSTATE as `code` on an error, and MalformedTrialDecisionError on
   * an answer that is not a decision.
   */
  startTrial(
    accountId: string,
    hashes: readonly LedgerHash[],
    transition: TrialTransition,
  ): Promise<TrialDecision>;
  /** Kept, not removed, primary (not staging) sites of the account. */
  countActiveSites(accountId: string): Promise<number>;
  /** 'exists' when the account already keeps that host (`sites_account_host_uq`). */
  insertSite(site: NewSite): Promise<{ siteId: string } | 'exists'>;
  loadCheck(checkId: string): Promise<CheckForClaim | null>;
  /** Sets the owner where there is none; 'not_unowned' when another claim got there first. */
  takeSite(siteId: string, site: Omit<NewSite, 'host'>): Promise<TakeSiteResult>;
  clearExpiry(checkId: string): Promise<void>;
}

/** What a first-audit request did, each with the case that produces it. */
export const FIRST_AUDIT_OUTCOMES = {
  requested: 'a first audit of the site was requested',
  has_check:
    'the site has a check that is queued, running, deferred, finished or partial, or its first audit was requested before',
  paused: 'CRAWL_PAUSED is set',
  capacity: 'the daily ceiling `global:audits:day` is reached, or could not be read',
  domain_limit: 'the host’s hourly bucket is used up',
} as const;

export type FirstAuditOutcome = keyof typeof FIRST_AUDIT_OUTCOMES;

/**
 * Requests a kept site's first audit (lib/v2/pipeline/first-audit.ts), given to the first-login hook
 * and the claim by door-deps.ts under V2_CHECKS_PUBLIC with V2_PIPELINE. Injected, not imported:
 * `requestCheck` loads the engine, which must not reach a client bundle (admit-site.ts).
 */
export type FirstAudit = (input: {
  siteId: string;
  host: string;
  userId: string;
}) => Promise<FirstAuditOutcome>;

/** A Sentry signal: a name, with ids and counts (never an email or a ledger value). */
export type Report = (signal: string, extra: Record<string, string>) => void;
