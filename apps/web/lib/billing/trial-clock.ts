/**
 * What `crawlmouse.trial.clock` (inngest/trial-clock.ts) reads: no-card Pro trials that have ended,
 * and those inside their last three days whose reminder has not gone. The list only narrows: for each
 * account the entitlement machine decides on the account as it is read in that account's step, and
 * the mailer checks opt-out, deletion and the trial's end again before it sends.
 *
 * A reminder already sent or suppressed is left out by its ledger row, so the hourly run does not
 * re-apply it for the three days it stays in the window.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import type { TrialClockDue } from '../../../../inngest/trial-clock';
import { TRIAL_REMINDER_DAYS_BEFORE_END } from '../auth/constants';
import { trialReminderKey } from '../v2/mail/trial-key';
import type { SweepRow } from './clock';

const DAY_MS = 86_400_000;
/** Rows read at a time when looking for reminders still to send. */
export const REMINDER_PAGE = 200;

export interface TrialClockReads {
  /** No-card Pro trials not marked for deletion that ended at or before `by`, oldest first. */
  ended(by: Date, limit: number): Promise<SweepRow[]>;
  /**
   * No-card Pro trials not marked for deletion, with the reminder on, ending in `[from, to)`, soonest
   * first, the `size` rows after the first `offset`.
   */
  endingBetween(from: Date, to: Date, offset: number, size: number): Promise<SweepRow[]>;
  /** Which of these reminder keys the ledger holds as sent or suppressed. */
  remindersDone(keys: readonly string[]): Promise<ReadonlySet<string>>;
}

/** The accounts due at `at`, at most `limit`: ended trials first, so reminders cannot starve them. */
export async function trialClockDue(
  reads: TrialClockReads,
  at: Date,
  limit: number,
): Promise<TrialClockDue[]> {
  const due: TrialClockDue[] = (await reads.ended(at, limit)).map((r) => ({
    accountId: r.accountId,
    kind: 'expire',
  }));
  const from = new Date(at.getTime() + 1);
  const to = new Date(at.getTime() + TRIAL_REMINDER_DAYS_BEFORE_END * DAY_MS + 1);
  for (let offset = 0; due.length < limit; offset += REMINDER_PAGE) {
    const page = await reads.endingBetween(from, to, offset, REMINDER_PAGE);
    if (page.length === 0) break;
    const done = await reads.remindersDone(page.map((r) => trialReminderKey(r.accountId, r.at)));
    for (const r of page) {
      if (due.length < limit && !done.has(trialReminderKey(r.accountId, r.at))) {
        due.push({ accountId: r.accountId, kind: 'remind' });
      }
    }
    if (page.length < REMINDER_PAGE) break;
  }
  return due;
}

/** The reads through PostgREST; `sb` must be the service-role client. */
export function supabaseTrialClockReads(sb: SupabaseClient): TrialClockReads {
  const trials = () =>
    sb
      .from('accounts')
      .select('id, trial_ends_at')
      .eq('state', 'pro_trial')
      .eq('trial_variant', 'no_card')
      .is('deleted_at', null)
      .is('deletion_confirmed_at', null);
  const rows = (result: {
    data: { id: string; trial_ends_at: string }[] | null;
    error: { message: string } | null;
  }): SweepRow[] => {
    if (result.error) throw new Error(`trial clock read failed: ${result.error.message}`);
    return (result.data ?? []).map((r) => ({ accountId: r.id, at: new Date(r.trial_ends_at) }));
  };
  return {
    async ended(by, limit) {
      return rows(
        await trials()
          .lt('trial_ends_at', new Date(by.getTime() + 1).toISOString())
          .order('trial_ends_at', { ascending: true })
          .order('id', { ascending: true })
          .limit(limit),
      );
    },
    async endingBetween(from, to, offset, size) {
      return rows(
        await trials()
          .eq('email_trial_reminder', true)
          .gte('trial_ends_at', from.toISOString())
          .lt('trial_ends_at', to.toISOString())
          .order('trial_ends_at', { ascending: true })
          .order('id', { ascending: true })
          .range(offset, offset + size - 1),
      );
    },
    async remindersDone(keys) {
      const { data, error } = await sb
        .from('email_sends')
        .select('idempotency_key')
        .in('idempotency_key', [...keys])
        .in('status', ['sent', 'suppressed']);
      if (error) throw new Error(`trial clock ledger read failed: ${error.message}`);
      return new Set(
        ((data ?? []) as { idempotency_key: string }[]).map((r) => r.idempotency_key),
      );
    },
  };
}
