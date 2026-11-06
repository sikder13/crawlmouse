/**
 * Run by __tests__/v2/account-door-sentry.test.ts in a process of its own (the SDK instruments the
 * request path once per process): initialise the real server SDK with the options named by
 * argv[2], handle one request carrying every door cookie and a session cookie, capture a message
 * inside the handler, and print what reached the transport.
 */
import { createRequire } from 'node:module';
import { createServer, request } from 'node:http';
import type { AddressInfo } from 'node:net';
import { COOKIES } from '../../../lib/auth/constants';
import { sentryServerOptions } from '../../../lib/auth/sentry-scrub';

export const TOKEN = 'pkce_LEAKCANARY_77';

type SentryNext = {
  init: (o: Record<string, unknown>) => void;
  requestDataIntegration: (o: { include: { cookies: false } }) => unknown;
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
  const server = createServer((_req, res) => {
    Sentry.captureMessage('auth.landing-failed');
    res.end('ok');
  });
  await new Promise<void>((r) => server.listen(0, r));
  const { port } = server.address() as AddressInfo;
  const otp = encodeURIComponent(
    JSON.stringify({ kind: 'token_hash', value: TOKEN, type: 'magiclink' }),
  );
  const cookie = [
    `${COOKIES.otp}=${otp}`,
    `${COOKIES.next}=%2Fapi%2Fchecks%2F11111111-1111-4111-8111-111111111111%2Fclaim`,
    `${COOKIES.device}=DEVICECANARY`,
    `${COOKIES.signup}=SIGNUPCANARY`,
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
