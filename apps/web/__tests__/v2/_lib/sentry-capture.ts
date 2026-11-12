/**
 * Run by __tests__/v2/account-door-sentry.test.ts in a process of its own (the SDK instruments the
 * request path once per process): initialise the real server SDK with the options named by
 * argv[2], handle one request carrying every door cookie, v1's anonymous-session cookie and a
 * session cookie, and a second to the claim route, whose path and Referer hold a check id; inside
 * the handler make an outgoing PostgREST-shaped request (an `id=eq.` filter, which becomes a
 * breadcrumb) and a POST to a Slack-webhook-shaped path, finish a forced transaction, and capture a
 * message; two more requests carry an unsubscribe token in their URLs; then print what reached the
 * transport.
 */
import { createRequire } from 'node:module';
import { createServer, request } from 'node:http';
import type { AddressInfo } from 'node:net';
import { COOKIES } from '../../../lib/auth/constants';
import { sentryServerOptions } from '../../../lib/auth/sentry-scrub';

const CANARY = 'pkce_LEAKCANARY_77';
/** A check id: the right to claim that check. */
const CHECK_ID = 'c4ec4c4e-c4ec-4c4e-8c4e-c4ec4c4ec4ec';
/** An emailed account link's token (43 base64url characters, as `newToken()` makes them). */
const LINK_TOKEN = `LINKCANARY${'A'.repeat(33)}`;

type SentryNext = {
  init: (o: Record<string, unknown>) => void;
  startSpan: (o: { name: string; forceTransaction: boolean }, fn: () => void) => void;
  requestDataIntegration: (o: { include: { cookies: false; data: false } }) => unknown;
  captureMessage: (m: string) => void;
  flush: (ms: number) => Promise<boolean>;
};

async function capturedWith(options: Record<string, unknown>): Promise<string> {
  const sent: unknown[] = [];
  Sentry.init({
    dsn: 'https://public@o0.ingest.sentry.io/0',
    tracesSampleRate: 1,
    ...options,
    transport: () => ({
      send: async (envelope: unknown) => {
        sent.push(envelope);
        return {};
      },
      flush: async () => true,
    }),
  });
  let port = 0;
  const server = createServer((req, res) => {
    if (req.url?.startsWith('/rest/') || req.url?.startsWith('/services/')) {
      res.end('[]');
      return;
    }
    void (async () => {
      await fetch(`http://127.0.0.1:${port}/rest/v1/checks?select=id&id=eq.CHECKIDCANARY`);
      // alertFn's Slack POST: the webhook's secret is in its path (CC-28).
      await fetch(`http://127.0.0.1:${port}/services/T0CANARY/B0CANARY/SLACKCANARY0secret`, {
        method: 'POST',
        body: 'x',
      });
      Sentry.startSpan({ name: 'door-transaction', forceTransaction: true }, () => {});
      Sentry.captureMessage('auth.landing-failed');
      res.end('ok');
    })();
  });
  await new Promise<void>((r) => server.listen(0, r));
  port = (server.address() as AddressInfo).port;
  const otp = encodeURIComponent(
    JSON.stringify({ kind: 'token_hash', value: CANARY, type: 'magiclink' }),
  );
  const cookie = [
    `${COOKIES.otp}=${otp}`,
    `${COOKIES.next}=%2Fapi%2Fchecks%2F11111111-1111-4111-8111-111111111111%2Fclaim`,
    `${COOKIES.device}=DEVICECANARY`,
    `${COOKIES.signup}=SIGNUPCANARY`,
    `${COOKIES.binding}=FORCANARY`,
    'crawlmouse_anon=ANONCANARY',
    'sb-abc-auth-token=SESSIONCANARY',
  ].join('; ');
  await new Promise<void>((resolve) =>
    request(
      { port, path: '/login/verify?token_hash=URLCANARY_55', method: 'POST', headers: { cookie } },
      (res) => {
        res.resume();
        res.on('end', resolve);
      },
    ).end(),
  );
  await new Promise<void>((resolve) =>
    request(
      {
        port,
        path: `/api/checks/${CHECK_ID}/claim`,
        method: 'POST',
        headers: { referer: `http://localhost:${port}/check/${CHECK_ID}` },
      },
      (res) => {
        res.resume();
        res.on('end', resolve);
      },
    ).end(),
  );
  // An unsubscribe link's one-click POST and its page (CC-28 D7): the token is in the URL.
  // Real-shaped tokens: a base64url payload, a dot, a 43-character signature.
  const SIG = 'S'.repeat(43);
  for (const path of [
    `/api/unsubscribe?t=UNSUBCANARYpayload.${SIG}`,
    `/unsubscribe?t=UNSUBPAGECANARYpayload.${SIG}`,
  ]) {
    await new Promise<void>((resolve) =>
      request({ port, path, method: 'POST' }, (res) => {
        res.resume();
        res.on('end', resolve);
      }).end(),
    );
  }
  await new Promise<void>((resolve) =>
    request({ port, path: `/account/delete/${LINK_TOKEN}`, method: 'GET' }, (res) => {
      res.resume();
      res.on('end', resolve);
    }).end(),
  );
  await Sentry.flush(2000);
  server.close();
  return JSON.stringify(sent);
}

const Sentry = createRequire(import.meta.url)('@sentry/nextjs') as SentryNext;
const full = sentryServerOptions(Sentry.requestDataIntegration);
const OPTIONS: Record<string, Record<string, unknown>> = {
  full,
  integration: { integrations: full.integrations },
  scrubber: { beforeSend: full.beforeSend, beforeSendTransaction: full.beforeSendTransaction },
  none: {},
};

const mode = process.argv[2] ?? '';
if (!(mode in OPTIONS)) throw new Error(`unknown mode ${mode}`);
process.stdout.write(await capturedWith(OPTIONS[mode]!));
process.exit(0);
