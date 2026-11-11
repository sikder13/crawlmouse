/**
 * The email change's ports in production: the service-role client's `rpc` and Auth admin API,
 * Inngest for the emails, the server's one event sender, the shared rate limiter (fail closed) and
 * Sentry. A route builds them only after it has decided the caller may act.
 */
import 'server-only';
import * as Sentry from '@sentry/nextjs';
import type { SupabaseClient } from '@supabase/supabase-js';
import { inngest } from '../../../../../inngest/client';
import { checkRateLimit } from '../../rate-limit';
import { MAX_RATE_LIMIT_WINDOW_MS } from '../../rate-limit-window';
import { accountCapture } from './account-events';
import type { EmailChangePorts } from './email-change';

export function emailChangePorts(
  admin: SupabaseClient,
  cookieHeader: string | null,
): EmailChangePorts {
  return {
    rpc: (fn, args) => admin.rpc(fn, args),
    auth: {
      async updateEmail(userId, email) {
        const { error } = await admin.auth.admin.updateUserById(userId, {
          email,
          email_confirm: true,
        });
        if (!error) return 'ok';
        if (error.code === 'email_exists') return 'address_taken';
        // Auth's message can quote the address; the code and status say enough.
        throw new Error(`updateUserById: ${error.code ?? 'no code'} ${error.status ?? ''}`);
      },
      async deleteUser(userId) {
        const { error } = await admin.auth.admin.deleteUser(userId);
        if (error && error.status !== 404) {
          throw new Error(`deleteUser: ${error.code ?? 'no code'} ${error.status ?? ''}`);
        }
      },
    },
    sendEmails: async (events) => {
      await inngest.send([...events]);
    },
    capture: accountCapture(cookieHeader),
    rateLimit: async (bucket, limit) =>
      (await checkRateLimit(bucket, limit, MAX_RATE_LIMIT_WINDOW_MS, { failClosed: true })).allowed,
    report: (signal, extra) => {
      Sentry.captureMessage(signal, { level: 'warning', tags: { signal }, extra: { ...extra } });
    },
    now: () => new Date(),
  };
}
