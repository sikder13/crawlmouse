/**
 * The mailer's Inngest functions as production wires them (inngest/mail.ts over handlers.ts), for
 * the serve route's list (lib/v2/pipeline/functions.ts), which registers them only with
 * V2_CHECKS_PUBLIC=1. Everything is built when a function runs, not when the route loads: with no
 * RESEND_API_KEY or no pepper `send()` claims nothing and logs `mail.unconfigured`.
 */
import { createClient } from '@supabase/supabase-js';
import type { InngestFunction } from 'inngest';
import {
  createAccountMailFn,
  createCheckFinishedEventFn,
  createCheckNotifyFn,
  createFixToDeveloperFn,
  createSeatInviteFn,
  type MailHandlers,
} from '../../../../../inngest/mail';
import { captureServerEvent } from '../../analytics-server';
import { mailPepper } from './address-hash';
import { mailHandlers } from './handlers';
import { supabaseMailLedger } from './ledger';
import type { MailDeps } from './send';
import { supabaseMailStore } from './store';
import { resendTransport } from './transport';

type Env = Readonly<Record<string, string | undefined>>;

/** The mailer's log: one JSON line, with the fields `send()` passes (never an address or a body). */
export const mailLog: MailDeps['log'] = (event, fields) =>
  console.warn(JSON.stringify({ event, ...fields }));

export function productionMailHandlers(env: Env): MailHandlers {
  const sb = createClient(env.NEXT_PUBLIC_SUPABASE_URL ?? '', env.SUPABASE_SERVICE_ROLE_KEY ?? '', {
    auth: { persistSession: false },
  });
  return mailHandlers({
    mail: {
      ledger: supabaseMailLedger(sb),
      transport: resendTransport(env.RESEND_API_KEY),
      pepper: mailPepper(env),
      now: () => new Date(),
      log: mailLog,
    },
    store: supabaseMailStore(sb),
    // A step has no request, so no cookie header: serverCaptureAllowed reads none (CC-26b's known gap).
    capture: (event, distinctId, properties) =>
      captureServerEvent(null, { event, distinctId, properties }),
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
  ];
}
