/**
 * The ledger's work as the Inngest functions run it (inngest/ledger.ts), over the service role. With
 * no usable RESEARCH_SITE_KEY nothing is read or written, and that is reported once per process. A
 * write that throws is reported as `ledger-write-failed` and answers `failed`: it never throws into
 * Inngest, so no retry of the function can repeat it out of turn.
 */
import { createClient } from '@supabase/supabase-js';
import type { LedgerWork } from '../../../../../inngest/ledger';
import { reportLedgerFailure, reportLedgerKeyMissing } from './report';
import { siteKeySecretOk } from './site-key';
import { supabaseLedgerStore } from './store';
import { backfillLedger, writeLedger, type LedgerStore } from './write';

type Env = Readonly<Record<string, string | undefined>>;

export function ledgerWork(store: LedgerStore, secret: string | undefined): LedgerWork {
  return {
    async write(checkId) {
      if (!siteKeySecretOk(secret)) {
        await reportLedgerKeyMissing();
        return 'no_key';
      }
      try {
        return await writeLedger({ store, secret }, checkId);
      } catch {
        await reportLedgerFailure('write', checkId);
        return 'failed';
      }
    },
    async backfill(now) {
      if (!siteKeySecretOk(secret)) {
        await reportLedgerKeyMissing();
        return { outcome: 'no_key' };
      }
      const failures: string[] = [];
      const result = await backfillLedger(
        { store, secret, onFailure: (checkId) => failures.push(checkId) },
        now,
      );
      for (const checkId of failures) await reportLedgerFailure('backfill', checkId);
      return { ...result };
    },
  };
}

export function ledgerWorkFromEnv(env: Env): LedgerWork {
  const sb = createClient(env.NEXT_PUBLIC_SUPABASE_URL ?? '', env.SUPABASE_SERVICE_ROLE_KEY ?? '', {
    auth: { persistSession: false },
  });
  return ledgerWork(supabaseLedgerStore(sb), env.RESEARCH_SITE_KEY);
}
