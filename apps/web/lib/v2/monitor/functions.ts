/**
 * The alert and weekly-summary functions as production wires them (CC-28 D5, D6): the service-role
 * client's stores, the mailer over Resend, Slack through `slackPoster`, the product events through
 * `captureServerEvent`. Each function builds its clients when a step runs, not when the serve route
 * loads. The serve route registers these with V2_PIPELINE and V2_CHECKS_PUBLIC both set
 * (lib/v2/pipeline/functions.ts).
 */
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type { InngestFunction } from 'inngest';
import { createAlertFn } from '../../../../../inngest/alerts';
import { createSummarySendFn, createSummaryTickFn } from '../../../../../inngest/summary';
import { captureServerEvent } from '../../analytics-server';
import { mailPepper } from '../mail/address-hash';
import { supabaseMailLedger } from '../mail/ledger';
import type { MailDeps } from '../mail/send';
import { resendTransport } from '../mail/transport';
import { linkSecret } from '../mail/unsubscribe-token';
import { deliverAlert, planAlert, type AlertDeps } from './alerts';
import { supabaseAlertStore } from './alerts-store';
import { slackPoster } from './slack';
import { duePage, sendSummary, type SummaryDeps } from './summary';
import { supabaseSummaryStore } from './summary-store';
import { unsubscribeLinks } from '../mail/links';

type Env = Readonly<Record<string, string | undefined>>;

const serviceClient = (env: Env): SupabaseClient =>
  createClient(env.NEXT_PUBLIC_SUPABASE_URL ?? '', env.SUPABASE_SERVICE_ROLE_KEY ?? '', {
    auth: { persistSession: false },
  });

/** One JSON line per event, with the fields given: ids and codes, never an address or a URL. */
const log = (event: string, fields: Readonly<Record<string, unknown>>) =>
  console.warn(JSON.stringify({ event, ...fields }));

function mailDeps(env: Env, sb: SupabaseClient): MailDeps {
  return {
    ledger: supabaseMailLedger(sb),
    transport: resendTransport(env.RESEND_API_KEY),
    pepper: mailPepper(env),
    now: () => new Date(),
    log,
  };
}

export function alertDeps(env: Env): AlertDeps {
  const sb = serviceClient(env);
  return {
    store: supabaseAlertStore(sb),
    mail: mailDeps(env, sb),
    linkSecret: linkSecret(env),
    unsubscribeLinks: (secret, seatId, now) => unsubscribeLinks(secret, seatId, 'alerts', now),
    postSlack: slackPoster(),
    capture: (accountId, properties) =>
      captureServerEvent(null, {
        event: 'alert_sent',
        distinctId: `account:${accountId}`,
        properties,
      }),
    log,
    now: () => new Date(),
  };
}

export function summaryDeps(env: Env): SummaryDeps {
  const sb = serviceClient(env);
  return {
    store: supabaseSummaryStore(sb, log),
    mail: mailDeps(env, sb),
    linkSecret: linkSecret(env),
    unsubscribeLinks: (secret, seatId, now) => unsubscribeLinks(secret, seatId, 'summary', now),
    capture: (accountId, properties) =>
      captureServerEvent(null, {
        event: 'summary_sent',
        distinctId: `account:${accountId}`,
        properties,
      }),
    log,
    now: () => new Date(),
  };
}

export function monitorFunctions(env: Env = process.env): InngestFunction.Like[] {
  return [
    createAlertFn(
      {
        plan: (checkId) => planAlert(alertDeps(env), checkId),
        deliver: (checkId, channel) => deliverAlert(alertDeps(env), checkId, channel),
      },
      env,
    ),
    createSummaryTickFn({
      due: (now, offset, limit) =>
        duePage(supabaseSummaryStore(serviceClient(env), log), new Date(now), offset, limit),
    }),
    createSummarySendFn({ send: (due) => sendSummary(summaryDeps(env), due) }, env),
  ];
}
