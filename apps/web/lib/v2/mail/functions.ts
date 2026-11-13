/**
 * The mailer's Inngest functions as production wires them (inngest/mail.ts over handlers.ts), for
 * the serve route's list (lib/v2/pipeline/functions.ts), which registers them only with
 * V2_CHECKS_PUBLIC=1. The last is CC-29's daily deletion of Agency Plus requests. Everything is built when a function runs, not when the route loads: with no
 * RESEND_API_KEY or no pepper `send()` claims nothing and logs `mail.unconfigured`.
 */
import { createClient } from '@supabase/supabase-js';
import type { InngestFunction } from 'inngest';
import {
  createAccountMailFn,
  createCheckFinishedEventFn,
  createCheckNotifyFn,
  createContactPurgeFn,
  createFixToDeveloperFn,
  createClientReportFn,
  createReportConfirmFn,
  createSeatInviteFn,
  type MailHandlers,
  type ReportMailHandlers,
} from '../../../../../inngest/mail';
import { captureServerEvent } from '../../analytics-server';
import { siteUrl } from '../../site-url';
import { agencyCaptureWithoutRequest } from '../agency/events';
import { supabaseCheckReader } from '../pipeline/load';
import { generateReport, supabaseReportBucket, supabaseReportStore } from '../reports/generate-run';
import { supabaseShareFiles } from '../reports/share-store';
import { mailPepper } from './address-hash';
import { mailHandlers, reportMailHandlers } from './handlers';
import { supabaseMailLedger } from './ledger';
import { supabaseReportMailStore } from './report-mail-store';
import type { MailDeps } from './send';
import { supabaseMailStore } from './store';
import { resendTransport } from './transport';
import { linkSecret } from './unsubscribe-token';

type Env = Readonly<Record<string, string | undefined>>;

/** The mailer's log: one JSON line, with the fields `send()` passes (never an address or a body). */
export const mailLog: MailDeps['log'] = (event, fields) =>
  console.warn(JSON.stringify({ event, ...fields }));

const serviceClient = (env: Env) =>
  createClient(env.NEXT_PUBLIC_SUPABASE_URL ?? '', env.SUPABASE_SERVICE_ROLE_KEY ?? '', {
    auth: { persistSession: false },
  });

const mailDeps = (env: Env, sb: ReturnType<typeof serviceClient>): MailDeps => ({
  ledger: supabaseMailLedger(sb),
  transport: resendTransport(env.RESEND_API_KEY),
  pepper: mailPepper(env),
  now: () => new Date(),
  log: mailLog,
});

export function productionMailHandlers(env: Env): MailHandlers {
  const sb = serviceClient(env);
  return mailHandlers({
    mail: mailDeps(env, sb),
    store: supabaseMailStore(sb),
    // A step has no request, so no cookie header: serverCaptureAllowed reads none (CC-26b's known gap).
    capture: (event, distinctId, properties) =>
      captureServerEvent(null, { event, distinctId, properties }),
  });
}

/**
 * The two mails of a client report schedule (CC-31 D8). A report's document is made by the report
 * generator and stored in the reports bucket, as a report a member asks for is; with no
 * `EMAIL_LINK_SECRET` the pause link cannot be made and no report is mailed.
 */
export function productionReportMailHandlers(env: Env): ReportMailHandlers {
  const sb = serviceClient(env);
  const secret = linkSecret(env);
  return reportMailHandlers({
    mail: mailDeps(env, sb),
    store: supabaseReportMailStore({
      admin: sb,
      generate: (reportId) =>
        generateReport(
          {
            store: supabaseReportStore(sb),
            bucket: supabaseReportBucket(sb),
            read: supabaseCheckReader(sb),
            home: siteUrl('/'),
          },
          reportId,
        ),
      files: supabaseShareFiles(sb),
      linkSecret: secret,
    }),
    capture: agencyCaptureWithoutRequest(),
    pauseLinks: secret !== null,
  });
}

export function mailFunctions(env: Env = process.env): InngestFunction.Like[] {
  const handlers = () => productionMailHandlers(env);
  return [
    createAccountMailFn(handlers),
    createCheckNotifyFn(handlers),
    createFixToDeveloperFn(handlers),
    createCheckFinishedEventFn(handlers),
    createSeatInviteFn(handlers),
    createReportConfirmFn(() => productionReportMailHandlers(env)),
    createClientReportFn(() => productionReportMailHandlers(env)),
    // CC-29: an Agency Plus request is deleted 30 days after it was sent, or after it was made when it
    // was not.
    createContactPurgeFn(() =>
      supabaseMailStore(
        createClient(env.NEXT_PUBLIC_SUPABASE_URL ?? '', env.SUPABASE_SERVICE_ROLE_KEY ?? '', {
          auth: { persistSession: false },
        }),
      ).purgeContacts(new Date()),
    ),
  ];
}
