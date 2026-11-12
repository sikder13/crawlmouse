/**
 * The send ledger as the mailer sees it (D1): `claim_email_send` before the send and
 * `finish_email_send` after it, migration 20261113000001 section A. The port keeps `send.ts` testable
 * without a database; `supabaseMailLedger` is production's, over the service-role client.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import { z } from 'zod';
import type { MailKind } from './types';

export type Claim =
  | { outcome: 'go'; attempt: number }
  | { outcome: 'done' | 'busy' | 'suppressed' | 'exhausted' };

export interface ClaimInput {
  key: string;
  kind: MailKind;
  addressHash: string;
  accountId: string | null;
  now: Date;
}

export interface MailLedger {
  claim(input: ClaimInput): Promise<Claim>;
  /** Records the result of the claimed send; false when the key was not `sending`. */
  finish(input: {
    key: string;
    status: 'sent' | 'failed';
    providerId: string | null;
    errorCode: string | null;
    now: Date;
  }): Promise<boolean>;
}

const ClaimSchema = z.union([
  z.strictObject({ outcome: z.literal('go'), attempt: z.int().min(1).max(3) }),
  z.strictObject({ outcome: z.enum(['done', 'busy', 'suppressed', 'exhausted']) }),
]);

export function supabaseMailLedger(sb: SupabaseClient): MailLedger {
  return {
    async claim(c) {
      const { data, error } = await sb.rpc('claim_email_send', {
        p_key: c.key,
        p_kind: c.kind,
        p_hash: c.addressHash,
        p_account: c.accountId,
        p_now: c.now.toISOString(),
      });
      if (error) throw new Error(`claim_email_send: ${error.code ?? 'error'}`);
      return ClaimSchema.parse(data);
    },
    async finish(f) {
      const { data, error } = await sb.rpc('finish_email_send', {
        p_key: f.key,
        p_status: f.status,
        p_provider_id: f.providerId,
        p_error: f.errorCode,
        p_now: f.now.toISOString(),
      });
      if (error) throw new Error(`finish_email_send: ${error.code ?? 'error'}`);
      return data === true;
    },
  };
}
